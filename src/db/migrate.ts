/**
 * Migration script: imports all existing file-based data into SQLite.
 *
 * Reads from the existing YukiWeb config directory (~/.config/yukiweb/) and
 * writes into the SQLite database.  The migration is idempotent — running it
 * a second time simply re-imports (upserts) everything.
 *
 * Usage:
 *   import { runMigration } from './db/migrate';
 *   runMigration((step, detail) => console.log(`[${step}] ${detail}`));
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';

import { initDb, get } from './index';
import { normalizeLineEndings } from '../server/utils/line-endings';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const CONFIG_DIR = path.join(os.homedir(), '.config', 'yukiweb');
const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');
const PROJECTS_FILE = path.join(CONFIG_DIR, 'projects', 'projects.json');
const PLANS_DIR = path.join(CONFIG_DIR, 'plans');
const MEMORIES_FILE = path.join(CONFIG_DIR, 'memories.json');
const SKILLS_DIR = path.join(CONFIG_DIR, 'skills');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const LLM_LOG_DIR = path.join(CONFIG_DIR, 'logs');
const LLM_LOG_FILE = path.join(LLM_LOG_DIR, 'llm-raw.log');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert ISO 8601 timestamp to Unix epoch seconds (INTEGER). */
function toUnixTimestamp(iso: string | Date | undefined | null): number {
  if (!iso) return Math.floor(Date.now() / 1000);
  const d = new Date(iso);
  if (isNaN(d.getTime())) return Math.floor(Date.now() / 1000);
  return Math.floor(d.getTime() / 1000);
}

/** Safely read a JSON file; returns null on failure. */
function readJsonFile<T = any>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    // Strip BOM if present
    const content = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/** Progress callback type. */
export type ProgressCallback = (step: string, detail: string) => void;

// ---------------------------------------------------------------------------
// Migration stages
// ---------------------------------------------------------------------------

/**
 * Check whether migration has already been marked complete.
 * Returns true if the database already has migration state records.
 */
function migrationAlreadyRan(db: Database.Database): boolean {
  const row = db.prepare("SELECT COUNT(*) as count FROM _migration_state").get() as { count: number };
  return row.count > 0;
}

/**
 * Import all existing projects from projects.json.
 */
function importProjects(
  db: Database.Database,
  log: ProgressCallback,
): void {
  log('import-projects', 'Reading projects data…');
  const projects = readJsonFile<any[]>(PROJECTS_FILE);
  if (!projects || !Array.isArray(projects) || projects.length === 0) {
    log('import-projects', 'No projects found');
    return;
  }

  const stmt = db.prepare(`
    INSERT INTO projects (id, name, path, created_at, updated_at)
    VALUES (@id, @name, @path, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      path = excluded.path,
      updated_at = excluded.updated_at
  `);

  const insert = db.transaction((p: any) => {
    stmt.run({
      id: p.id,
      name: p.name,
      path: p.path,
      created_at: toUnixTimestamp(p.createdAt),
      updated_at: toUnixTimestamp(p.updatedAt),
    });
  });

  let count = 0;
  for (const project of projects) {
    insert(project);
    count++;
  }

  log('import-projects', `Imported ${count} project(s)`);
}

/**
 * Import all sessions and their messages.
 *
 * Session files are JSON arrays of message objects.  Session metadata
 * (title, summary, project_id, thinkingEnabled, voiceMode, disabledTools,
 * charsPerToken, lastPromptTokens) is derived from the messages themselves
 * or stored inline when present.
 */
function importSessions(
  db: Database.Database,
  log: ProgressCallback,
): void {
  log('import-sessions', 'Reading session files…');

  if (!fs.existsSync(SESSIONS_DIR)) {
    log('import-sessions', 'Sessions directory not found, skipping');
    return;
  }

  const sessionFiles = fs.readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(SESSIONS_DIR, f));

  if (sessionFiles.length === 0) {
    log('import-sessions', 'No session files found');
    return;
  }

  // Prepared statements for batch inserts
  const sessionUpsert = db.prepare(`
    INSERT INTO sessions (
      id, title, summary, project_id,
      created_at, updated_at,
      thinking_enabled, voice_mode,
      disabled_tools, chars_per_token, last_prompt_tokens
    ) VALUES (@id, @title, @summary, @project_id, @created_at, @updated_at,
              @thinking_enabled, @voice_mode, @disabled_tools, @chars_per_token, @last_prompt_tokens)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      summary = excluded.summary,
      project_id = excluded.project_id,
      updated_at = excluded.updated_at,
      thinking_enabled = excluded.thinking_enabled,
      voice_mode = excluded.voice_mode,
      disabled_tools = excluded.disabled_tools,
      chars_per_token = excluded.chars_per_token,
      last_prompt_tokens = excluded.last_prompt_tokens
  `);

  const messageUpsert = db.prepare(`
    INSERT INTO messages (
      id, session_id, role, content, timestamp,
      tool_calls, reasoning_content, images, attachments,
      pruned, compacted
    ) VALUES (@id, @session_id, @role, @content, @timestamp,
              @tool_calls, @reasoning_content, @images, @attachments,
              @pruned, @compacted)
    ON CONFLICT(id) DO UPDATE SET
      role = excluded.role,
      content = excluded.content,
      timestamp = excluded.timestamp,
      tool_calls = excluded.tool_calls,
      reasoning_content = excluded.reasoning_content,
      images = excluded.images,
      attachments = excluded.attachments,
      pruned = excluded.pruned,
      compacted = excluded.compacted
  `);

  let sessionCount = 0;
  let messageCount = 0;

  for (const file of sessionFiles) {
    const fileName = path.basename(file, '.json');
    try {
      const data = readJsonFile(file);
      if (!data) continue;

      // Determine if this is a wrapper object or a direct array of messages
      // Session wrapper pattern: { "sessionId": "...", "messages": [...] }
      // or { "sessions": [ {...messages...} ] }
      let sessionId: string = fileName;
      let messages: any[] = [];
      let sessionMeta: any = {};

      if (Array.isArray(data)) {
        // Direct array of messages — use filename as session id
        sessionId = fileName;
        messages = data;
        sessionMeta = { _sessionId: sessionId };
      } else if (data.messages && Array.isArray(data.messages)) {
        // Session wrapper with messages array
        sessionId = data.sessionId || fileName;
        messages = data.messages;
        // Extract session-level metadata
        sessionMeta = {
          id: data.id,
          title: data.title,
          summary: data.summary,
          projectId: data.projectId,
          projectId_field: data.project_id,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          thinkingEnabled: data.thinkingEnabled,
          voiceMode: data.voiceMode,
          disabledTools: data.disabledTools,
          charsPerToken: data.charsPerToken,
          lastPromptTokens: data.lastPromptTokens,
          _sessionId: sessionId,
        };
      } else if (data.sessions && Array.isArray(data.sessions)) {
        // Nested sessions structure
        for (const sess of data.sessions) {
          const sId = sess.id || fileName;
          const sessMessages = Array.isArray(sess.messages) ? sess.messages : [];
          sessMessages.forEach((m: any) => { m._sessionId = sId; });

          // Insert session metadata
          sessionUpsert.run({
            id: sess.id,
            title: sess.title || null,
            summary: sess.summary || null,
            project_id: sess.projectId || sess.project_id || null,
            created_at: toUnixTimestamp(sess.createdAt),
            updated_at: toUnixTimestamp(sess.updatedAt),
            thinking_enabled: sess.thinkingEnabled ? 1 : 0,
            voice_mode: sess.voiceMode ? 1 : 0,
            disabled_tools: sess.disabledTools && sess.disabledTools.length > 0
              ? JSON.stringify(sess.disabledTools) : null,
            chars_per_token: sess.charsPerToken || null,
            last_prompt_tokens: sess.lastPromptTokens || null,
          });

          for (const msg of sessMessages) {
            const role = msg.role || 'system';
            const msgId = msg.id || `${sId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            messageUpsert.run({
              id: msgId,
              session_id: sId,
              role: ['user', 'assistant', 'system', 'tool'].includes(role) ? role : 'system',
              content: msg.content || null,
              timestamp: toUnixTimestamp(msg.timestamp),
              tool_calls: msg.tool_calls || msg.toolCalls ? JSON.stringify(msg.tool_calls || msg.toolCalls) : null,
              reasoning_content: msg.reasoning_content || msg.reasoningContent || null,
              images: msg.images ? JSON.stringify(msg.images) : null,
              attachments: msg.attachments ? JSON.stringify(msg.attachments) : null,
              pruned: msg.pruned ? 1 : 0,
              compacted: msg.compacted ? 1 : 0,
            });
          }
          sessionCount++;
          messageCount += sessMessages.length;
        }
        continue;
      } else if (typeof data === 'object') {
        // Unknown object structure — treat as single session with unknown messages
        sessionId = fileName;
        messages = [];
        sessionMeta = { ...data, _sessionId: fileName };
      }

      // Insert session metadata
      if (Object.keys(sessionMeta).length > 0) {
        sessionUpsert.run({
          id: sessionMeta.id || sessionId,
          title: sessionMeta.title || null,
          summary: sessionMeta.summary || null,
          project_id: sessionMeta.projectId || sessionMeta.projectId_field || null,
          created_at: toUnixTimestamp(sessionMeta.createdAt),
          updated_at: toUnixTimestamp(sessionMeta.updatedAt),
          thinking_enabled: sessionMeta.thinkingEnabled ? 1 : 0,
          voice_mode: sessionMeta.voiceMode ? 1 : 0,
          disabled_tools: sessionMeta.disabledTools && sessionMeta.disabledTools.length > 0
            ? JSON.stringify(sessionMeta.disabledTools) : null,
          chars_per_token: sessionMeta.charsPerToken || null,
          last_prompt_tokens: sessionMeta.lastPromptTokens || null,
        });
      }

      // Insert messages
      for (const msg of messages) {
        let role = msg.role || 'system';
        if (!['user', 'assistant', 'system', 'tool'].includes(role)) {
          role = 'system';
        }
        const msgId = msg.id || `${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        messageUpsert.run({
          id: msgId,
          session_id: sessionId,
          role,
          content: msg.content || null,
          timestamp: toUnixTimestamp(msg.timestamp),
          tool_calls: msg.tool_calls || msg.toolCalls ? JSON.stringify(msg.tool_calls || msg.toolCalls) : null,
          reasoning_content: msg.reasoning_content || msg.reasoningContent || null,
          images: msg.images ? JSON.stringify(msg.images) : null,
          attachments: msg.attachments ? JSON.stringify(msg.attachments) : null,
          pruned: msg.pruned ? 1 : 0,
          compacted: msg.compacted ? 1 : 0,
        });
      }
      sessionCount++;
      messageCount += messages.length;
    } catch (err: any) {
      console.error(`Failed to read session file ${fileName}: ${err.message}`);
    }
  }

  log('import-sessions', `Imported ${sessionCount} session(s) with ${messageCount} message(s)`);
}

/**
 * Import plans from the plans directory.
 * Each file is named after the session_id (without -plan suffix).
 */
function importPlans(
  db: Database.Database,
  log: ProgressCallback,
): void {
  log('import-plans', 'Reading plan files…');

  if (!fs.existsSync(PLANS_DIR)) {
    log('import-plans', 'Plans directory not found, skipping');
    return;
  }

  const planFiles = fs.readdirSync(PLANS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(PLANS_DIR, f));

  if (planFiles.length === 0) {
    log('import-plans', 'No plan files found');
    return;
  }

  const stmt = db.prepare(`
    INSERT INTO plans (session_id, title, steps, created_at, updated_at)
    VALUES (@session_id, @title, @steps, @created_at, @updated_at)
    ON CONFLICT(session_id) DO UPDATE SET
      title = excluded.title,
      steps = excluded.steps,
      updated_at = excluded.updated_at
  `);

  let count = 0;
  for (const file of planFiles) {
    try {
      const data = readJsonFile(file);
      if (!data || !data.title || !data.steps) continue;

      // The session_id is the filename without -plan suffix
      const sessionId = path.basename(file, '.json');
      // But actual plan files might be named with -plan suffix
      const baseName = path.basename(file, '.json');
      const planSessionId = baseName.endsWith('-plan') ? baseName.slice(0, -5) : baseName;

      stmt.run({
        session_id: planSessionId,
        title: data.title,
        steps: JSON.stringify(data.steps),
        created_at: toUnixTimestamp(data.createdAt),
        updated_at: toUnixTimestamp(data.updatedAt),
      });
      count++;
    } catch (err: any) {
      console.error(`Failed to read plan file ${path.basename(file)}: ${err.message}`);
    }
  }

  log('import-plans', `Imported ${count} plan(s)`);
}

/**
 * Import memories from memories.json (key-value store).
 */
function importMemories(
  db: Database.Database,
  log: ProgressCallback,
): void {
  log('import-memories', 'Reading memories…');

  const memories = readJsonFile<Record<string, string>>(MEMORIES_FILE);
  if (!memories || typeof memories !== 'object' || Object.keys(memories).length === 0) {
    log('import-memories', 'No memories found');
    return;
  }

  const stmt = db.prepare('INSERT OR REPLACE INTO memories (key, value) VALUES (?, ?)');

  let count = 0;
  for (const [key, value] of Object.entries(memories)) {
    stmt.run(key, value);
    count++;
  }

  log('import-memories', `Imported ${count} memory(ies)`);
}

/**
 * Import skills from .md files in the skills directory.
 */
function importSkills(
  db: Database.Database,
  log: ProgressCallback,
): void {
  log('import-skills', 'Reading skills…');

  if (!fs.existsSync(SKILLS_DIR)) {
    log('import-skills', 'Skills directory not found, skipping');
    return;
  }

  const skillFiles = fs.readdirSync(SKILLS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(SKILLS_DIR, f));

  if (skillFiles.length === 0) {
    log('import-skills', 'No skill files found');
    return;
  }

  const stmt = db.prepare(
    'INSERT INTO skills (name, description, instructions) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET description = excluded.description, instructions = excluded.instructions'
  );

  let count = 0;
  for (const file of skillFiles) {
    try {
      // Normalise line endings so stored skill text is canonical LF,
      // regardless of the source file's on-disk style.
      const content = normalizeLineEndings(fs.readFileSync(file, 'utf-8'));
      const name = path.basename(file, '.md');

      // Parse skill metadata from the markdown content
      // Skills follow this pattern:
      // # name
      //
      // **Description:** ...
      //
      // ## Instructions
      //
      // ...instructions...
      let description = '';
      let instructions = content;

      // Extract description
      const descMatch = content.match(/\*\*Description:\*\*\s*(.+?)(?:\n\n|$)/);
      if (descMatch) {
        description = descMatch[1].trim();
      }

      // Extract instructions (everything after ## Instructions)
      const instrMatch = content.match(/## Instructions\s*\n([\s\S]*)/);
      if (instrMatch) {
        instructions = instrMatch[1].trim();
      }

      // For skills without explicit Description field, use first lines as description
      if (!description && content.trim()) {
        const firstLine = content.trim().split('\n')[0];
        description = firstLine.replace(/^#\s+/, '').slice(0, 200);
      }

      stmt.run(name, description || null, instructions);
      count++;
    } catch (err: any) {
      console.error(`Failed to read skill file ${path.basename(file)}: ${err.message}`);
    }
  }

  log('import-skills', `Imported ${count} skill(s)`);
}

/**
 * Import MCP servers from the config file.
 */
function importMcpServers(
  db: Database.Database,
  log: ProgressCallback,
): void {
  log('import-mcp', 'Reading MCP server configs…');

  const configData = readJsonFile<any>(CONFIG_FILE);
  if (!configData) {
    log('import-mcp', 'No config.json found');
    return;
  }

  const servers = configData.mcpServers;
  if (!servers || !Array.isArray(servers) || servers.length === 0) {
    log('import-mcp', 'No MCP servers found');
    return;
  }

  const stmt = db.prepare(`
    INSERT INTO mcp_servers (name, command, args, env, enabled)
    VALUES (@name, @command, @args, @env, @enabled)
    ON CONFLICT(name) DO UPDATE SET
      command = excluded.command,
      args = excluded.args,
      env = excluded.env,
      enabled = excluded.enabled
  `);

  let count = 0;
  for (const server of servers) {
    if (!server.name || !server.command) continue;

    stmt.run({
      name: server.name,
      command: server.command,
      args: server.args && Array.isArray(server.args) ? JSON.stringify(server.args) : null,
      env: server.env && typeof server.env === 'object' ? JSON.stringify(server.env) : null,
      enabled: server.enabled !== false ? 1 : 0,  // default to enabled
    });
    count++;
  }

  log('import-mcp', `Imported ${count} MCP server(s)`);
}

/**
 * Import model definitions from the config file into the models / model_variants
 * tables. Each config entry becomes a `models` row (connection identity) plus a
 * single default `model_variants` row (generation params).
 *
 * Idempotent: models/variants that already exist (by name) are left untouched so
 * the migration never clobbers edits made through the UI. A legacy top-level
 * `reasoningEffort` is applied to entries that don't set their own (matches the
 * normalisation in config.ts).
 */
function importModels(
  db: Database.Database,
  log: ProgressCallback,
): number {
  log('import-models', 'Reading model configs…');

  const configData = readJsonFile<any>(CONFIG_FILE);
  if (!configData) {
    log('import-models', 'No config.json found');
    return 0;
  }

  const models = configData.models;
  if (!Array.isArray(models) || models.length === 0) {
    log('import-models', 'No models found');
    return 0;
  }

  const legacyReasoning = configData.reasoningEffort;

  const findModel = db.prepare('SELECT id FROM models WHERE name = ?');
  const findVariant = db.prepare('SELECT id FROM model_variants WHERE model_id = ? AND name = ?');
  const insertModel = db.prepare(`
    INSERT INTO models (id, name, model, endpoint, api_key, context_window, max_tokens, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertVariant = db.prepare(`
    INSERT INTO model_variants (id, model_id, name, temperature, thinking_enabled, preserve_thinking, reasoning_effort, is_default, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)
  `);
  const upsertSetting = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );

  const now = Math.floor(Date.now() / 1000);
  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    if (!m || !m.name) continue;

    const existing = findModel.get(m.name) as { id: string } | undefined;
    if (existing) { skipped++; continue; }  // already migrated / edited via UI

    const modelId = randomUUID();
    insertModel.run(
      modelId,
      m.name,
      m.model || '',
      m.endpoint || '',
      m.apiKey || null,
      typeof m.contextWindow === 'number' ? m.contextWindow : null,
      typeof m.maxTokens === 'number' ? m.maxTokens : null,
      i,
      now,
      now,
    );

    const reasoningEffort = m.reasoningEffort !== undefined
      ? m.reasoningEffort
      : (legacyReasoning !== undefined ? legacyReasoning : null);
    insertVariant.run(
      randomUUID(),
      modelId,
      'Default',
      typeof m.temperature === 'number' ? m.temperature : null,
      m.thinkingEnabled == null ? null : (m.thinkingEnabled ? 1 : 0),
      m.preserveThinking == null ? null : (m.preserveThinking ? 1 : 0),
      reasoningEffort || null,
    );
    imported++;
  }

  if (configData.activeModel) upsertSetting.run('activeModel', configData.activeModel);

  log('import-models', `Imported ${imported} model(s)${skipped ? `, skipped ${skipped} existing` : ''}`);
  return imported + skipped;
}

/**
 * Parse and import LLM logs from the raw log file.
 *
 * The log file format is:
 *   --- ISO_TIMESTAMP (durationMs) [ERROR: errorMsg] ---
 *   META: JSON
 *   REQUEST:
 *   JSON_REQUEST
 *   RESPONSE:
 *   JSON_RESPONSE
 *   ========= (separator)
 */
function importLlmLogs(
  db: Database.Database,
  log: ProgressCallback,
): void {
  log('import-llm-logs', 'Reading LLM logs…');

  if (!fs.existsSync(LLM_LOG_FILE)) {
    log('import-llm-logs', 'LLM log file not found, skipping');
    return;
  }

  const content = fs.readFileSync(LLM_LOG_FILE, 'utf-8');
  if (!content.trim()) {
    log('import-llm-logs', 'LLM log file is empty');
    return;
  }

  // Split by separator line
  const entries = content.split(/^\n={80}\n?$/m).filter(e => e.trim());

  if (entries.length === 0) {
    log('import-llm-logs', 'No log entries found');
    return;
  }

  const insert = db.prepare(`
    INSERT INTO llm_logs (session_id, timestamp, model, prompt_tokens, response_tokens, duration_ms, request, response, error)
    VALUES (@session_id, @timestamp, @model, @prompt_tokens, @response_tokens, @duration_ms, @request, @response, @error)
  `);

  let count = 0;
  let errors = 0;

  for (const entry of entries) {
    try {
      const lines = entry.trim().split('\n');
      if (lines.length < 2) continue;

      // Parse header: --- 2026-07-05T04:44:08.755Z (1234ms) ERROR: Some error ---
      const headerLine = lines[0];
      const headerMatch = headerLine.match(/^---\s+(.+?)\s+\((\d+)ms\)(?:\s+ERROR:\s+(.+?))?\s*---$/);
      if (!headerMatch) continue;

      const timestampStr = headerMatch[1];
      const durationMs = parseInt(headerMatch[2], 10);
      const error = headerMatch[3]?.trim();
      const timestamp = toUnixTimestamp(timestampStr);

      // Extract metadata (model, session_id)
      let model: string | null = null;
      let sessionId: string | null = null;
      let requestJson: string | null = null;
      let responseJson: string | null = null;

      let inRequest = false;
      let inResponse = false;
      let requestLines: string[] = [];
      let responseLines: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];

        // Check for META line
        const metaMatch = line.match(/^META:\s+(.+)$/);
        if (metaMatch) {
          try {
            const meta = JSON.parse(metaMatch[1]);
            if (meta.modelName) model = meta.modelName;
            if (meta.openaiClientModel && !model) model = meta.openaiClientModel;
            if (meta.sessionId) sessionId = meta.sessionId;
          } catch {
            // Ignore malformed META
          }
          continue;
        }

        if (line === 'REQUEST:') {
          inRequest = true;
          continue;
        }
        if (line === 'RESPONSE:') {
          inRequest = false;
          inResponse = true;
          continue;
        }

        if (inRequest) {
          requestLines.push(line);
        } else if (inResponse) {
          responseLines.push(line);
        }
      }

      // Parse request JSON
      try {
        requestJson = requestLines.length > 0 ? requestLines.join('\n') : null;
        if (requestJson) JSON.parse(requestJson); // Validate
      } catch {
        requestJson = null;
      }

      // Parse response JSON
      let promptTokens: number | null = null;
      let responseTokens: number | null = null;

      try {
        responseJson = responseLines.length > 0 ? responseLines.join('\n') : null;
        if (responseJson) {
          const respObj = JSON.parse(responseJson);
          // Extract token counts from usage
          if (respObj.usage) {
            if (respObj.usage.prompt_tokens !== undefined) {
              promptTokens = respObj.usage.prompt_tokens;
            }
            if (respObj.usage.completion_tokens !== undefined) {
              responseTokens = respObj.usage.completion_tokens;
            }
            // Also check promptTokens field
            if (respObj.usage.promptTokens !== undefined) {
              promptTokens = respObj.usage.promptTokens;
            }
          }
        }
      } catch {
        responseJson = null;
      }

      insert.run({
        session_id: sessionId,
        timestamp,
        model,
        prompt_tokens: promptTokens,
        response_tokens: responseTokens,
        duration_ms: durationMs,
        request: requestJson,
        response: responseJson,
        error,
      });
      count++;
    } catch (err: any) {
      errors++;
    }
  }

  log('import-llm-logs', `Imported ${count} log entry/entries (${errors} errors)`);
}

/**
 * Mark migration as complete by recording state in the database.
 */
function markMigrationComplete(db: Database.Database, version: number): void {
  db.prepare(`
    INSERT OR REPLACE INTO _migration_state (key, value)
    VALUES ('version', ?)
  `).run(String(version));

  db.prepare(`
    INSERT OR REPLACE INTO _migration_state (key, value)
    VALUES ('migrated_at', ?)
  `).run(String(Date.now()));

  db.prepare(`
    INSERT OR REPLACE INTO _migration_state (key, value)
    VALUES ('migration_version', ?)
  `).run(String(version));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the full migration from file-based storage to SQLite.
 *
 * @param onProgress Optional callback for progress reporting.
 *   Called with (step, detail) pairs throughout the migration.
 * @returns Object with migration results (counts of imported items).
 */
export function runMigration(onProgress?: ProgressCallback): {
  projects: number;
  sessions: number;
  messages: number;
  plans: number;
  memories: number;
  skills: number;
  mcpServers: number;
  models: number;
  llmLogs: number;
  alreadyMigrated: boolean;
} {
  const log: ProgressCallback = onProgress || ((_step, detail) => console.log(`[migration] ${detail}`));

  // Initialise database
  const db = initDb();

  // Check if migration already ran
  if (migrationAlreadyRan(db)) {
    log('status', 'Migration already completed — re-importing data (idempotent)');
  }

  let projectCount = 0;
  let sessionCount = 0;
  let messageCount = 0;
  let planCount = 0;
  let memoryCount = 0;
  let skillCount = 0;
  let mcpCount = 0;
  let modelCount = 0;
  let llmLogCount = 0;

  const startTime = Date.now();

  log('status', 'Starting migration from file-based storage to SQLite…');

  // 1. Projects
  try {
    importProjects(db, log);
    projectCount = (db.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number }).count;
  } catch (err: any) {
    log('error', `Project import failed: ${err.message}`);
  }

  // 2. Sessions & Messages (combined due to inter-dependency)
  try {
    importSessions(db, log);
    sessionCount = (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;
    messageCount = (db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number }).count;
  } catch (err: any) {
    log('error', `Session import failed: ${err.message}`);
  }

  // 3. Plans
  try {
    importPlans(db, log);
    planCount = (db.prepare('SELECT COUNT(*) as count FROM plans').get() as { count: number }).count;
  } catch (err: any) {
    log('error', `Plan import failed: ${err.message}`);
  }

  // 4. Memories
  try {
    importMemories(db, log);
    memoryCount = (db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number }).count;
  } catch (err: any) {
    log('error', `Memory import failed: ${err.message}`);
  }

  // 5. Skills
  try {
    importSkills(db, log);
    skillCount = (db.prepare('SELECT COUNT(*) as count FROM skills').get() as { count: number }).count;
  } catch (err: any) {
    log('error', `Skill import failed: ${err.message}`);
  }

  // 6. MCP servers
  try {
    importMcpServers(db, log);
    mcpCount = (db.prepare('SELECT COUNT(*) as count FROM mcp_servers').get() as { count: number }).count;
  } catch (err: any) {
    log('error', `MCP server import failed: ${err.message}`);
  }

  // 6.5 Models (connection identity + generation presets)
  try {
    modelCount = importModels(db, log);
  } catch (err: any) {
    log('error', `Model import failed: ${err.message}`);
  }

  // 7. LLM logs
  try {
    importLlmLogs(db, log);
    llmLogCount = (db.prepare('SELECT COUNT(*) as count FROM llm_logs').get() as { count: number }).count;
  } catch (err: any) {
    log('error', `LLM log import failed: ${err.message}`);
  }

  // Mark migration complete
  const MIGRATION_VERSION = 2;
  markMigrationComplete(db, MIGRATION_VERSION);

  const elapsed = Date.now() - startTime;
  log('status', `Migration complete in ${elapsed}ms`);
  log('status', [
    `  Projects:         ${projectCount}`,
    `  Sessions:         ${sessionCount}`,
    `  Messages:         ${messageCount}`,
    `  Plans:            ${planCount}`,
    `  Memories:         ${memoryCount}`,
    `  Skills:           ${skillCount}`,
    `  MCP Servers:      ${mcpCount}`,
    `  Models:           ${modelCount}`,
    `  LLM Logs:         ${llmLogCount}`,
  ].join('\n'));

  return {
    projects: projectCount,
    sessions: sessionCount,
    messages: messageCount,
    plans: planCount,
    memories: memoryCount,
    skills: skillCount,
    mcpServers: mcpCount,
    models: modelCount,
    llmLogs: llmLogCount,
    alreadyMigrated: migrationAlreadyRan(db),
  };
}
