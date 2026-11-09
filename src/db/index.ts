import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import type { Statement, RunResult } from 'better-sqlite3';
import type { Session, Message } from '../shared/types';
import { normalizeLineEndings } from '../server/utils/line-endings';

const configDir = path.join(os.homedir(), '.config', 'yukiweb');
const dbPath = path.join(configDir, 'yukiweb.db');

let _db: Database.Database | null = null;

function getDbInstance(): Database.Database {
  if (!_db) {
    const fs = require('fs');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    _db = new Database(dbPath);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');

    // Initialize schema
    _db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        path       TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS plans (
        session_id TEXT PRIMARY KEY,
        title      TEXT NOT NULL,
        steps      TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memories (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS skills (
        name TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        instructions TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id                 TEXT PRIMARY KEY,
        title              TEXT,
        summary            TEXT,
        project_id         TEXT DEFAULT 'default',
        created_at         INTEGER NOT NULL,
        updated_at         INTEGER NOT NULL,
        thinking_enabled   INTEGER DEFAULT 0,
        voice_mode         INTEGER DEFAULT 0,
        disabled_tools     TEXT,
        chars_per_token    REAL,
        last_prompt_tokens INTEGER
      );

      CREATE TABLE IF NOT EXISTS messages (
        id                  TEXT PRIMARY KEY,
        session_id          TEXT NOT NULL,
        role                TEXT NOT NULL,
        content             TEXT,
        timestamp           INTEGER NOT NULL,
        tool_calls          TEXT,
        reasoning_content   TEXT,
        images              TEXT,
        attachments         TEXT,
        pruned              INTEGER DEFAULT 0,
        compacted           INTEGER DEFAULT 0,
        synthetic_prefix    TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

      CREATE TABLE IF NOT EXISTS _migration_state (
        key   TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS attachments (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL,
        message_id  TEXT NOT NULL,
        name        TEXT NOT NULL,
        type        TEXT,
        path        TEXT,
        size        INTEGER,
        is_image    INTEGER DEFAULT 0,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS mcp_servers (
        name    TEXT PRIMARY KEY,
        command TEXT NOT NULL,
        args    TEXT,
        env     TEXT,
        enabled INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS llm_logs (
        id               TEXT PRIMARY KEY,
        session_id       TEXT,
        timestamp        INTEGER NOT NULL,
        model            TEXT,
        prompt_tokens    INTEGER,
        response_tokens  INTEGER,
        duration_ms      INTEGER,
        request          TEXT,
        response         TEXT,
        error            TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_llm_logs_session_id_timestamp ON llm_logs(session_id, timestamp);
    `);

    // Additive migrations for databases created by older versions. CREATE TABLE
    // IF NOT EXISTS does not add columns to an existing table.
    const messageColumns = _db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>;
    if (!messageColumns.some(c => c.name === 'synthetic_prefix')) {
      _db.exec('ALTER TABLE messages ADD COLUMN synthetic_prefix TEXT');
    }
  }

  return _db;
}

/**
 * Initialize (or get existing) the database instance.
 * Creates tables if they don't exist.
 */
export function initDb(): Database.Database {
  return getDbInstance();
}

/**
 * Get the database instance. Creates it if it doesn't exist.
 */
export function getDb(): Database.Database {
  return getDbInstance();
}

/**
 * Run a SQL statement (INSERT, UPDATE, DELETE).
 */
export function run(sql: string, ...params: any[]): RunResult {
  return getDb().prepare(sql).run(...params);
}

/**
 * Get a single row from a SQL statement (SELECT).
 */
export function get<T = any>(sql: string, ...params: any[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

/**
 * Close the database connection. Useful for cleanup on shutdown.
 */
export function closeDb(): void {
  if (_db) {
    try {
      _db.close();
    } catch {
      // Ignore errors on close
    }
    _db = null;
  }
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

export interface SessionRow {
  id: string;
  title?: string;
  summary?: string;
  project_id?: string;
  created_at: number;
  updated_at: number;
  thinking_enabled: number;
  voice_mode: number;
  disabled_tools?: string;
  chars_per_token?: number;
  last_prompt_tokens?: number;
}

export interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string | null;
  timestamp: number;
  tool_calls?: string;
  reasoning_content?: string;
  images?: string;
  attachments?: string;
  pruned: number;
  compacted: number;
  synthetic_prefix?: string | null;
}

/**
 * List all sessions as row objects, ordered by most recently updated.
 */
export function listSessions(): SessionRow[] {
  return getDb().prepare(
    'SELECT * FROM sessions ORDER BY updated_at DESC'
  ).all() as SessionRow[];
}

/**
 * Get a single session row by id (metadata only).
 */
export function getSessionRow(sessionId: string): SessionRow | undefined {
  return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
}

/**
 * Create or upsert a session row.
 */
export function upsertSession(
  id: string,
  title: string | null,
  summary: string | null,
  projectId: string | null,
  createdAt: number,
  updatedAt: number,
  thinkingEnabled: boolean,
  voiceMode: boolean,
  disabledTools: string[] | null,
  charsPerToken: number | null,
  lastPromptTokens: number | null,
): void {
  getDb().prepare(`
    INSERT INTO sessions (
      id, title, summary, project_id,
      created_at, updated_at,
      thinking_enabled, voice_mode,
      disabled_tools, chars_per_token, last_prompt_tokens
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  `).run(
    id, title, summary, projectId,
    createdAt, updatedAt,
    thinkingEnabled ? 1 : 0,
    voiceMode ? 1 : 0,
    disabledTools ? JSON.stringify(disabledTools) : null,
    charsPerToken, lastPromptTokens,
  );
}

/**
 * Update a single session field using the prepared statement pattern.
 */
export function updateSessionField(
  sessionId: string,
  updates: Record<string, { value: any; isBoolean?: boolean }>,
): void {
  const pairs = Object.entries(updates).map(([key, { value, isBoolean }]) => {
    if (isBoolean) return `${key} = ${value ? 1 : 0}`;
    return `${key} = ?`;
  });
  const values = Object.entries(updates)
    .filter(([, { isBoolean }]) => !isBoolean)
    .map(([, { value }]) => value);

  getDb().prepare(`UPDATE sessions SET ${pairs.join(', ')}, updated_at = ? WHERE id = ?`).run(
    ...values,
    Math.floor(Date.now() / 1000),
    sessionId,
  );
}

// ---------------------------------------------------------------------------
// Message helpers
// ---------------------------------------------------------------------------

/**
 * Get all messages for a session, ordered by timestamp.
 */
export function getMessages(sessionId: string): MessageRow[] {
  const rows = getDb().prepare(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC'
  ).all(sessionId) as MessageRow[];
  // Normalise line endings at the context boundary. Messages may have been
  // written with CRLF (e.g. user text pasted from a Windows app), and the
  // model context must be LF for consistency.
  for (const row of rows) {
    if (row.content) row.content = normalizeLineEndings(row.content);
    if (row.tool_calls) row.tool_calls = normalizeLineEndings(row.tool_calls);
    if (row.reasoning_content) row.reasoning_content = normalizeLineEndings(row.reasoning_content);
    if (row.synthetic_prefix) row.synthetic_prefix = normalizeLineEndings(row.synthetic_prefix);
  }
  return rows;
}

/**
 * Upsert a single message.
 */
export function upsertMessage(
  id: string,
  sessionId: string,
  role: string,
  content: string | null,
  timestamp: number,
  toolCalls: string | null,
  reasoningContent: string | null,
  images: string | null,
  attachments: string | null,
  pruned: boolean,
  compacted: boolean,
  syntheticPrefix: string | null = null,
): void {
  getDb().prepare(`
    INSERT INTO messages (
      id, session_id, role, content, timestamp,
      tool_calls, reasoning_content, images, attachments,
      pruned, compacted, synthetic_prefix
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      role = excluded.role,
      content = excluded.content,
      timestamp = excluded.timestamp,
      tool_calls = excluded.tool_calls,
      reasoning_content = excluded.reasoning_content,
      images = excluded.images,
      attachments = excluded.attachments,
      pruned = excluded.pruned,
      compacted = excluded.compacted,
      synthetic_prefix = excluded.synthetic_prefix
  `).run(
    id, sessionId, role, content, timestamp,
    toolCalls, reasoningContent, images, attachments,
    pruned ? 1 : 0, compacted ? 1 : 0, syntheticPrefix,
  );
}

/**
 * Delete all messages for a session.
 */
export function deleteMessagesForSession(sessionId: string): void {
  getDb().prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
}

// ---------------------------------------------------------------------------
// Session convenience functions (server-facing)
// ---------------------------------------------------------------------------

/**
 * Delete a session and all its messages.
 */
export function deleteSession(sessionId: string): void {
  getDb().prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

/**
 * Save a session atomically: update metadata and replace all messages.
 * Uses a database transaction for atomicity.
 */
export function saveSession(session: Session): void {
  const db = getDb();
  const txn = db.transaction(() => {
    // Update session metadata
    upsertSession(
      session.id,
      session.title || null,
      session.summary || null,
      session.projectId || null,
      Math.floor(session.createdAt.getTime() / 1000),
      Math.floor(session.updatedAt.getTime() / 1000),
      session.thinkingEnabled ?? false,
      session.voiceMode ?? false,
      session.disabledTools && session.disabledTools.length > 0 ? session.disabledTools : null,
      session.charsPerToken || null,
      session.lastPromptTokens || null,
    );

    // Replace all messages
    deleteMessagesForSession(session.id);
    for (const msg of session.messages) {
      upsertMessage(
        msg.id,
        msg.sessionId,
        msg.role,
        msg.content,
        Math.floor(msg.timestamp.getTime() / 1000),
        msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
        msg.reasoningContent || null,
        msg.images ? JSON.stringify(msg.images) : null,
        msg.attachments ? JSON.stringify(msg.attachments) : null,
        !!msg.pruned,
        !!msg.compacted,
        msg.syntheticPrefix || null,
      );
    }
  });
  txn();
}

/**
 * Get a full session with all messages, converting DB rows to Session type.
 */
export function getSession(sessionId: string): Session | undefined {
  const row = getSessionRow(sessionId);
  if (!row) return undefined;

  const msgRows = getMessages(sessionId);
  const disabledTools = row.disabled_tools ? JSON.parse(row.disabled_tools) : [];

  return {
    id: row.id,
    title: row.title || undefined,
    summary: row.summary || undefined,
    projectId: row.project_id || 'default',
    createdAt: new Date(row.created_at * 1000),
    updatedAt: new Date(row.updated_at * 1000),
    thinkingEnabled: row.thinking_enabled ? true : false,
    voiceMode: row.voice_mode ? true : false,
    disabledTools: disabledTools.length > 0 ? disabledTools : undefined,
    charsPerToken: row.chars_per_token,
    lastPromptTokens: row.last_prompt_tokens,
    messages: msgRows.map(r => ({
      id: r.id,
      role: r.role as Message['role'],
      content: r.content || '',
      timestamp: new Date(r.timestamp * 1000),
      toolCalls: r.tool_calls ? JSON.parse(r.tool_calls) : undefined,
      reasoningContent: r.reasoning_content || undefined,
      sessionId: r.session_id,
      images: r.images ? JSON.parse(r.images) : undefined,
      attachments: r.attachments ? JSON.parse(r.attachments) : undefined,
      pruned: !!r.pruned,
      compacted: !!r.compacted,
      syntheticPrefix: r.synthetic_prefix || undefined,
    })),
  };
}

/**
 * List session metadata only (no messages), for the /api/sessions endpoint.
 * Returns the Session interface shape minus messages.
 */
export function listSessionsMeta(projectIdFilter?: string): Array<{
  id: string;
  title?: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}> {
  const q = projectIdFilter
    ? 'WHERE project_id = ? ORDER BY updated_at DESC'
    : 'ORDER BY updated_at DESC';

  const rows = getDb().prepare(
    `SELECT id, title, summary, project_id, created_at, updated_at FROM sessions ${q}`
  ).all(projectIdFilter) as Array<{
    id: string;
    title?: string;
    summary?: string;
    project_id?: string;
    created_at: number;
    updated_at: number;
  }>;

  return rows.map(r => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    createdAt: new Date(r.created_at * 1000).toISOString(),
    updatedAt: new Date(r.updated_at * 1000).toISOString(),
    messageCount: (getDb().prepare('SELECT COUNT(*) as c FROM messages WHERE session_id = ? AND role != \'system\'').get(r.id) as { c: number }).c,
  }));
}

/**
 * Create a new session in the database with a system message.
 */
export function createSession(
  systemPrompt: string,
  projectId: string,
  disabledTools: string[],
): Session {
  const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const now = new Date();
  const nowTs = Math.floor(now.getTime() / 1000);

  upsertSession(
    id,
    null,
    null,
    projectId,
    nowTs,
    nowTs,
    false,
    false,
    disabledTools.length > 0 ? disabledTools : null,
    null,
    null,
  );

  const systemMsgId = `${id}-system`;
  upsertMessage(
    systemMsgId,
    id,
    'system',
    systemPrompt,
    nowTs,
    null,
    null,
    null,
    null,
    false,
    false,
  );

  return {
    id,
    title: undefined,
    summary: undefined,
    projectId,
    createdAt: now,
    updatedAt: now,
    thinkingEnabled: undefined,
    voiceMode: undefined,
    disabledTools: disabledTools.length > 0 ? disabledTools : undefined,
    messages: [{
      id: systemMsgId,
      role: 'system',
      content: systemPrompt,
      timestamp: now,
      sessionId: id,
    }],
  };
}

/**
 * Load sessions from the database. If the DB is empty, migrate from the
 * legacy JSON file store (~/.config/yukiweb/sessions/*.json).
 *
 * Returns the most recently updated session ID (for setting activeSessionId), or null.
 */
export function loadSessions(sessionDataDir: string): string | null {
  // If DB already has sessions, return the most recent one
  try {
    const count = getDb().prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number };
    if (count.c > 0) {
      const row = getDb().prepare(
        'SELECT id FROM sessions ORDER BY updated_at DESC LIMIT 1'
      ).get() as { id: string } | undefined;
      return row?.id || null;
    }
  } catch {
    // Table doesn't exist yet — proceed to migrate
  }

  // Migrate from legacy files
  const fs = require('fs');
  if (!fs.existsSync(sessionDataDir)) return null;

  const files = fs.readdirSync(sessionDataDir).filter((f: string) => f.endsWith('.json'));
  if (files.length === 0) return null;

  let latestId: string | null = null;
  let latestUpdated = 0;

  for (const file of files) {
    try {
      const filePath = path.join(sessionDataDir, file);
      const raw = normalizeLineEndings(fs.readFileSync(filePath, 'utf-8'));
      const data = JSON.parse(raw);

      const createdAt = Math.floor(new Date(data.createdAt).getTime() / 1000);
      const updatedAt = Math.floor(new Date(data.updatedAt).getTime() / 1000);

      upsertSession(
        data.id,
        data.title || null,
        data.summary || null,
        data.projectId || 'default',
        createdAt,
        updatedAt,
        data.thinkingEnabled ?? false,
        data.voiceMode ?? false,
        data.disabledTools || null,
        typeof data.charsPerToken === 'number' ? data.charsPerToken : null,
        typeof data.lastPromptTokens === 'number' ? data.lastPromptTokens : null,
      );

      if (data.messages && Array.isArray(data.messages)) {
        for (const msg of data.messages) {
          const msgTs = Math.floor(new Date(msg.timestamp).getTime() / 1000);
          upsertMessage(
            msg.id,
            msg.sessionId || data.id,
            msg.role || 'system',
            msg.content || '',
            msgTs,
            msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
            msg.reasoningContent || null,
            msg.images ? JSON.stringify(msg.images) : null,
            msg.attachments ? JSON.stringify(msg.attachments) : null,
            msg.pruned ? true : false,
            msg.compacted ? true : false,
          );
        }
      }

      if (updatedAt > latestUpdated) {
        latestUpdated = updatedAt;
        latestId = data.id;
      }
    } catch (err) {
      console.error(`[db] failed to migrate session ${file}:`, err);
    }
  }

  return latestId;
}
