import express from 'express';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { loadConfig, loadSystemPrompt, saveConfig, getConfig, getAgentModel, getNamedModels, getActiveModelName, setActiveModelName, getModelDefaultThinking, getEffectiveThinking, setThinkingOverride, loadEnvFile, getSubAgentConfig } from './config';
import { Agent } from './agent';
import { AudioPipeline } from './audio';
import { BrowserAutomation } from './browser';
import { DesktopAutomation } from './automation';
import { MCPManager } from './mcp';
import { toolNames, subAgentToolNames } from './tools';
import { planGet, loadPlans } from './plan';
import { loadProjects, getProjects, getProject, createProject, renameProject, deleteProject, reorderProjects } from './project';
import { Session, Message, Attachment } from '../shared/types';
import {
  initDb,
  getDb,
  run,
  get as dbGet,
  listSessionsMeta,
  getSessionRow,
  upsertSession,
  upsertMessage,
  deleteMessagesForSession,
  getMessages as dbGetMessages,
  deleteSession as dbDeleteSession,
  saveSession as dbSaveSession,
  getSession as dbGetSession,
  createSession as dbCreateSession,
  loadSessions as dbLoadSessions,
  updateSessionField,
  createForkSession,
  getForksForSession,
} from '../db';
import * as fs from 'fs';
import { normalizeLineEndings } from './utils/line-endings';
import * as os from 'os';

loadEnvFile();

const app = express();
const PORT = parseInt(process.env.PORT || '3210', 10);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Security headers for the SPA (applied to all responses)
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; " +
    "font-src 'self' data:; " +
    "connect-src 'self' ws://localhost:* wss://localhost:*; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Serve built client-v2 (Vite output) first (primary SPA), then legacy client for any remaining assets
app.use(express.static(path.join(__dirname, '..', 'client-v2')));
app.use(express.static(path.join(__dirname, '..', 'client')));

const sessionDataDir = path.join(os.homedir(), '.config', 'yukiweb', 'sessions');
const attachmentsDir = path.join(os.homedir(), '.config', 'yukiweb', 'attachments');

// Decode data URLs for dropped files, write them to disk, and return attachment
// metadata to store on the user message.
function persistAttachments(
  files: Array<{ name: string; type: string; dataUrl: string }>,
  sessionId: string,
  msgId: string,
): Attachment[] {
  const dir = path.join(attachmentsDir, sessionId, msgId);
  fs.mkdirSync(dir, { recursive: true });

  const attachments: Attachment[] = [];
  for (const file of files) {
    try {
      const m = file.dataUrl.match(/^data:([^;]+);base64,(.*)$/s);
      const type = file.type || (m ? m[1] : 'application/octet-stream');
      const safeName = path.basename(file.name || `attachment_${attachments.length + 1}`);
      const targetPath = path.join(dir, safeName);
      let size = 0;

      if (m) {
        const buf = Buffer.from(m[2], 'base64');
        fs.writeFileSync(targetPath, buf);
        size = buf.length;
      } else {
        const content = file.dataUrl;
        fs.writeFileSync(targetPath, content, 'utf-8');
        size = Buffer.byteLength(content);
      }

      attachments.push({
        name: safeName,
        type,
        path: targetPath,
        size,
        isImage: /^image\//i.test(type),
        dataUrl: file.dataUrl,
      });
    } catch (err: any) {
      console.error('Failed to persist attachment:', err);
    }
  }
  return attachments;
}

// Treat pasted images as first-class attachments too, so attachment_list can
// list them and save_attached_file can write them to disk.
function persistImages(images: string[], sessionId: string, msgId: string, startIndex: number): Attachment[] {
  const dir = path.join(attachmentsDir, sessionId, msgId);
  fs.mkdirSync(dir, { recursive: true });

  const attachments: Attachment[] = [];
  for (let i = 0; i < images.length; i++) {
    const dataUrl = images[i];
    try {
      const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/s);
      const type = m ? m[1] : 'image/png';
      const ext = m ? (m[1].split('/')[1] || 'png').replace('jpeg', 'jpg') : 'png';
      const name = `pasted_image_${startIndex + i + 1}.${ext}`;
      const targetPath = path.join(dir, name);
      let size = 0;
      if (m) {
        const buf = Buffer.from(m[2], 'base64');
        fs.writeFileSync(targetPath, buf);
        size = buf.length;
      }
      // dataUrl is intentionally omitted — pasted images are already stored in
      // msg.images (used for vision), and the on-disk file covers save_attached_file.
      attachments.push({ name, type, path: targetPath, size, isImage: true });
    } catch (err: any) {
      console.error('Failed to persist pasted image:', err);
    }
  }
  return attachments;
}

function saveSession(session: Session): void {
  try {
    dbSaveSession(session);
  } catch (err) {
    console.error('Failed to save session:', err);
  }
}

function loadSessions(): void {
  // Migration handled by initDb + dbLoadSessions at startup
}

function createSession(projectId?: string): Session {
  const project = projectId || 'default';
  const disabledTools = [
    'browser_navigate', 'browser_click', 'browser_fill', 'browser_screenshot', 'browser_get_content', 'browser_get_links',
    'browser_evaluate_js', 'browser_xpath', 'browser_scroll', 'browser_wait_for', 'browser_select',
    'browser_get_visible_elements', 'browser_get_ax_tree', 'browser_get_react_tree', 'browser_hover',
    'browser_click_xpath', 'browser_extract_content', 'browser_get_page_structure', 'browser_scroll_to', 'browser_wait_for_selector',
  ];

  const systemPrompt = loadSystemPrompt();
  const session = dbCreateSession(systemPrompt, project, disabledTools);
  return session;
}

let activeSessionId: string | null = null;

initDb();
activeSessionId = dbLoadSessions(sessionDataDir) || null;
loadConfig();
loadPlans();
loadProjects();

const audioPipeline = new AudioPipeline();
const browserAutomation = new BrowserAutomation();
const desktopAutomation = new DesktopAutomation();
const mcpManager = new MCPManager(loadConfig().mcpServers || []);
const agent = new Agent();

agent.setServices(audioPipeline, browserAutomation, desktopAutomation, mcpManager);
agent.initToolDefaults();

/** Latest session per socket, used to route background agent events + wakes. */
const sessionSockets = new Map<WebSocket, string>();

/**
 * Background agents always alert the main agent.
 *
 * If a turn is running, the reports are injected at its next iteration. If the
 * agent is idle, a wake turn starts so the model can review them straight away.
 * Completions are debounced briefly, so a burst of parallel agents produces one
 * wake turn instead of one per agent. Reports are injected by Agent.chat() from
 * the undelivered-results queue; the wake prompt is only a notice.
 */
const WAKE_DEBOUNCE_MS = 2000;
const wakeTimers = new Map<string, NodeJS.Timeout>();

function startSubAgentWakeTurn(sessionId: string): void {
  // Mid-turn: the running loop injects the reports at its next iteration.
  if (agent.isRunning) return;
  const pending = agent.pendingSubAgentResults(sessionId);
  // Nothing new: a turn already consumed them, or they were collected with
  // agent_result. Never wake the model with nothing to review.
  if (pending.length === 0) return;

  const session = dbGetSession(sessionId);
  if (!session) return;
  const ws = Array.from(sessionSockets.entries()).find(([, sid]) => sid === sessionId)?.[0];
  if (!ws || ws.readyState !== 1) return; // no viewer — the report waits for the next turn

  for (const job of pending) {
    try {
      ws.send(JSON.stringify({
        type: 'subagent:wake',
        data: { sessionId, agentId: job.id, description: job.description, status: job.status },
      }));
    } catch { /* client may be gone */ }
  }

  const list = pending.map(j => `- "${j.description}" (${j.status})${j.error ? `: ${j.error}` : ''}`).join('\n');
  const prompt = [
    `[System notice] ${pending.length} background sub-agent(s) just finished:`,
    list,
    'Their reports are attached to this turn as context.',
    'Treat each report as a claim: read the files that were changed, inspect the diff, or re-run the command/test it cites before you accept the work.',
    'Then give the user a short update covering what the sub-agent did, what you verified yourself, and anything that still needs attention.',
    'Do not spawn an identical sub-agent again.',
  ].join('\n');

  console.log(`[subagent] waking session ${sessionId} for ${pending.length} finished agent(s)`);
  agent.chat(prompt, session, ws)
    .then(() => saveSession(session))
    .catch(err => console.error('[subagent] wake turn failed:', err));
}

function scheduleSubAgentWake(sessionId: string): void {
  const existing = wakeTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  wakeTimers.set(sessionId, setTimeout(() => {
    wakeTimers.delete(sessionId);
    startSubAgentWakeTurn(sessionId);
  }, WAKE_DEBOUNCE_MS));
}

agent.setSubAgentWakeHandler((job) => {
  if (!agent.hasPendingSubAgentResults(job.sessionId)) return;
  scheduleSubAgentWake(job.sessionId);
});

{
  const subCfg = getSubAgentConfig();
  const rawSlots = Math.floor(subCfg.maxAgentSlots || 0);
  const maxSlots = Math.max(1, rawSlots);
  const childModel = subCfg.model && subCfg.model !== 'Default' ? subCfg.model : getActiveModelName();
  const declared = getAgentModel(childModel).contextWindow || 64000;
  const slotTokens = typeof subCfg.perSlotContextTokens === 'number' && subCfg.perSlotContextTokens > 0
    ? Math.floor(subCfg.perSlotContextTokens)
    : Math.floor(declared * 0.5);
  console.log(
    `[tools] spawn_agent ${subCfg.enabled ? 'ENABLED' : 'disabled'} ` +
    `(model=${subCfg.model || 'active'}, maxAgentSlots=${rawSlots}, perSlotContext=${slotTokens} tokens)`,
  );
  if (subCfg.enabled) {
    const background = subCfg.background !== false;
    console.log(
      `[tools] sub-agent mode: ${background ? 'background (spawn returns immediately; reports auto-delivered)' : 'blocking'} ` +
      `maxQueued=${subCfg.maxQueued ?? 8}`,
    );
    if (rawSlots < 1) {
      console.log('[tools] maxAgentSlots=0 → sub-agents run one at a time (no parallel capacity beyond the main agent)');
    }
    console.log(
      `[tools] server sizing: llama.cpp --parallel should cover main + maxAgentSlots (= ${1 + maxSlots}); ` +
      `each child may use ${slotTokens} tokens, so worst-case KV is ${maxSlots} x ${slotTokens} = ${maxSlots * slotTokens}`,
    );
  }
}

// --- Session API ---
app.get('/api/sessions', (req, res) => {
  const projectId = (req.query.projectId as string) || 'default';
  const sessionList = listSessionsMeta(projectId);
  res.json(sessionList);
});

function makeSnippet(content: string, query: string, maxLen = 160): string {
  const idx = content.toLowerCase().indexOf(query);
  if (idx < 0) return content.slice(0, maxLen);
  const start = Math.max(0, idx - 40);
  const end = Math.min(content.length, start + maxLen);
  const pre = start > 0 ? '…' : '';
  const post = end < content.length ? '…' : '';
  return pre + content.slice(start, end).replace(/\s+/g, ' ').trim() + post;
}

app.get('/api/sessions/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) {
    res.json([]);
    return;
  }
  const lowerQ = q.toLowerCase();

  // Search in session titles
  const titleResults = getDb().prepare(
    `SELECT s.id, s.title, s.summary, s.project_id, s.created_at, s.updated_at,
            (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id AND m.role != 'system') as msg_count
     FROM sessions s WHERE s.title IS NOT NULL AND lower(s.title) LIKE ?
     ORDER BY s.updated_at DESC`,
  ).all(`%${lowerQ}%`) as Array<{
    id: string; title?: string; summary?: string; project_id?: string;
    created_at: number; updated_at: number; msg_count: number;
  }>;

  // Search in message content (distinct sessions)
  const contentResults = getDb().prepare(
    `SELECT DISTINCT s.id, s.title, s.summary, s.project_id, s.created_at, s.updated_at
     FROM messages m
     JOIN sessions s ON m.session_id = s.id
     WHERE lower(m.content) LIKE ?
     ORDER BY s.updated_at DESC`,
  ).all(`%${lowerQ}%`) as Array<{
    id: string; title?: string; summary?: string; project_id?: string;
    created_at: number; updated_at: number;
  }>;

  // Deduplicate and build results
  const seen = new Set<string>();
  const results: any[] = [];

  const addResult = (row: any) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    const msgCount = row.msg_count || (dbGetMessages(row.id) || []).filter((m: any) => m.role !== 'system').length;
    const snippet = row.title ? makeSnippet(row.title, q) : '';
    results.push({
      id: row.id,
      title: row.title || `${msgCount} messages`,
      createdAt: new Date(row.created_at * 1000).toISOString(),
      updatedAt: new Date(row.updated_at * 1000).toISOString(),
      messageCount: msgCount,
      snippet,
    });
  };

  for (const row of titleResults) addResult(row);
  for (const row of contentResults) addResult(row);

  results.sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  res.json(results);
});

app.get('/api/sessions/:id', (req, res) => {
  const session = dbGetSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json(session);
});

app.post('/api/sessions', (req, res) => {
  const projectId = req.query.projectId as string || req.body?.projectId || 'default';
  const session = createSession(projectId);
  activeSessionId = session.id;
  res.json({ id: session.id, projectId: session.projectId });
});

function deleteSessionById(id: string): void {
  const row = getSessionRow(id);
  if (!row) return;

  // Background sub-agents belong to the session that spawned them.
  const cancelled = agent.cancelSessionSubAgents(id);
  if (cancelled > 0) console.log(`[subagent] cancelled ${cancelled} agent(s) for deleted session ${id}`);
  const timer = wakeTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    wakeTimers.delete(id);
  }

  dbDeleteSession(id);

  // Clean up the legacy file if it still exists
  try {
    const filePath = path.join(sessionDataDir, `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error('Failed to delete session file:', err);
  }

  if (activeSessionId === id) {
    const recent = getDb().prepare(
      'SELECT id FROM sessions ORDER BY updated_at DESC LIMIT 1'
    ).get() as { id: string } | undefined;
    activeSessionId = recent?.id || null;
  }
}

app.delete('/api/sessions/:id', (req, res) => {
  const id = req.params.id;
  if (!getSessionRow(id)) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  deleteSessionById(id);
  res.json({ success: true });
});

app.post('/api/sessions/:id/rename', (req, res) => {
  const id = req.params.id;
  if (!getSessionRow(id)) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  updateSessionField(id, { title: { value: req.body.title } });
  res.json({ success: true });
});

// --- Fork API ---

app.get('/api/sessions/:id/forks', (req, res) => {
  const id = req.params.id;
  if (!getSessionRow(id)) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const forks = getForksForSession(id);
  res.json(forks);
});

app.post('/api/sessions/:id/fork', async (req, res) => {
  const id = req.params.id;
  const sessionId = id;
  const messageIndex = parseInt(req.body.messageIndex, 10);

  const parentSession = dbGetSession(sessionId);
  if (!parentSession) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (isNaN(messageIndex) || messageIndex < 0 || messageIndex >= parentSession.messages.length) {
    return res.status(400).json({ error: 'Invalid message index' });
  }

  const forkMessage = parentSession.messages[messageIndex];
  if (forkMessage.role !== 'assistant') {
    return res.status(400).json({ error: 'Can only fork from assistant messages' });
  }

  const projectId = parentSession.projectId || 'default';
  try {
    const forkSession = createForkSession(parentSession, forkMessage.id, projectId);

    // Notify all connected clients about the new fork session
    const forkPayload = {
      sessionId: forkSession.id,
      parentSessionId: parentSession.id,
      parentMessageId: forkMessage.id,
    };

    for (const client of wss.clients) {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: 'session:forked', data: forkPayload }));
      }
    }

    res.json({
      id: forkSession.id,
      sessionId: forkSession.id,
      parentSessionId: parentSession.id,
      parentMessageId: forkMessage.id,
    });
  } catch (err: any) {
    console.error('[fork] failed to create fork:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Config API ---
app.post('/api/config', (req, res) => {
  try {
    saveConfig(req.body);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/config', (_req, res) => {
  const config = loadConfig();
  const agentCfg = getAgentModel();
  const sanitized = { ...config, agentModel: { ...agentCfg, apiKey: agentCfg.apiKey ? '***' : '' } };
  delete (sanitized as any).apiKey;
  delete (sanitized as any).model;
  delete (sanitized as any).endpoint;
  delete (sanitized as any).contextWindow;
  delete (sanitized as any).maxTokens;
  res.json(sanitized);
});

// --- Project API ---
app.get('/api/projects', (_req, res) => {
  res.json(getProjects().map(p => ({
    id: p.id,
    name: p.name,
    path: p.path,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  })));
});

app.post('/api/projects', (req, res) => {
  try {
    const project = createProject(req.body.name);
    res.json({ id: project.id, name: project.name });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/reorder', (req, res) => {
  try {
    reorderProjects(Array.isArray(req.body?.ids) ? req.body.ids : []);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id', (req, res) => {
  try {
    const project = renameProject(req.params.id, req.body.name);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({ id: project.id, name: project.name });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id', (req, res) => {
  try {
    if (req.params.id === 'default') return res.status(400).json({ error: 'Cannot delete Default project' });
    const success = deleteProject(req.params.id);
    if (!success) return res.status(404).json({ error: 'Project not found' });
    // Delete all sessions belonging to the project
    const projectSessions = getDb().prepare(
      'SELECT id FROM sessions WHERE project_id = ?',
    ).all(req.params.id) as Array<{ id: string }>;
    for (const row of projectSessions) {
      deleteSessionById(row.id);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tree', (_req, res) => {
  const tree = getProjects().map(p => {
    const sessionRows = getDb().prepare(
      `SELECT s.id, s.title, s.summary, s.updated_at,
              (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id AND m.role != 'system') as msg_count
       FROM sessions s WHERE s.project_id = ?
       ORDER BY s.updated_at DESC`
    ).all([p.id]) as Array<{
      id: string; title?: string; summary?: string; updated_at: number; msg_count: number;
    }>;
    return {
      id: p.id,
      name: p.name,
      sessions: sessionRows.map((row: any) => ({
        id: row.id,
        title: row.title,
        summary: row.summary,
        updatedAt: new Date(row.updated_at * 1000).toISOString(),
        messageCount: row.msg_count,
        projectId: p.id,
      })),
    };
  });
  const activeSession = activeSessionId ? getSessionRow(activeSessionId) : undefined;
  res.json({
    projects: tree,
    activeProjectId: activeSession?.project_id || 'default',
  });
});

// --- Audio API ---
app.post('/api/audio/transcribe', async (req, res) => {
  try {
    const audioBuffer = Buffer.from(req.body.audioBase64, 'base64');
    const text = await audioPipeline.transcribe(audioBuffer);
    res.json({ text });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/audio/synthesize', async (req, res) => {
  try {
    const audioBuffer = await audioPipeline.synthesize(req.body.text);
    res.set('Content-Type', 'audio/wav');
    res.send(audioBuffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Voice global toggle (from tray global hotkey / tray menu) ---
app.post('/api/voice/global-toggle', (_req, res) => {
  const payload = JSON.stringify({ type: 'voice:global-toggle', data: {} });
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
  res.json({ success: true });
});

// --- Desktop screenshot ---
app.get('/api/desktop/screenshot', async (_req, res) => {
  try {
    const screenshotPath = await desktopAutomation.screenshot();
    const data = fs.readFileSync(screenshotPath);
    res.set('Content-Type', 'image/png');
    res.send(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Browser screenshot ---
app.get('/api/browser/screenshot', async (_req, res) => {
  try {
    const base64 = await browserAutomation.screenshot();
    res.json({ screenshot: base64 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client-v2', 'index.html'));
});

// SPA fallback: serve index.html for all non-API, non-static routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client-v2', 'index.html'));
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`YukiWeb server running at http://0.0.0.0:${PORT}`);
});

// Periodic cleanup of temp output files older than 15 minutes
const tempOutputDir = path.join(os.tmpdir(), 'yukiweb-outputs');
setInterval(() => {
  const ttlMinutes = (getConfig().tempOutputCleanupTTLMinutes || 60);
  const cutoff = Date.now() - ttlMinutes * 60 * 1000;
  try {
    if (fs.existsSync(tempOutputDir)) {
      const entries = fs.readdirSync(tempOutputDir);
      for (const entry of entries) {
        const filePath = path.join(tempOutputDir, entry);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile() && stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
          }
        } catch { /* skip individual file errors */ }
      }
    }
  } catch { /* skip directory errors */ }
}, 15 * 60 * 1000);

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '/', `http://${request.headers.host}`);

  if (url.pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

function sendContextUpdate(ws: WebSocket, session: Session): void {
  try {
    const config = loadConfig();
    let totalTokens = 0;
    for (const msg of session.messages) {
      const content = msg.content || '';
      totalTokens += Math.ceil(content.length / 4) + 10;
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          totalTokens += Math.ceil(JSON.stringify(tc.parameters).length / 4) + 5;
          if (tc.result) totalTokens += Math.ceil(tc.result.length / 4) + 5;
        }
      }
      if (msg.images) totalTokens += (msg.images.length * (config.imageTokensPerImage || 1024));
    }
    const agentCfg = getAgentModel();
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'context:update',
        data: { promptTokens: totalTokens, maxTokens: agentCfg.contextWindow || 64000 },
      }));
    }
  } catch { /* ignore */ }
}

function sendPlanUpdate(ws: WebSocket, sessionId: string): void {
  const plan = planGet(sessionId);
  try {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'plan:updated',
        data: {
          plan: plan ? { title: plan.title, steps: plan.steps.map(s => ({ id: s.id, description: s.description, status: s.status })) } : null,
        },
      }));
    }
  } catch { /* ignore */ }
}

function getEnabledToolsForSession(session: Session): Array<{ name: string; enabled: boolean }> {
  const cfg = loadConfig();
  const configDisabled = new Set(cfg.disabledTools || []);
  const sessionDisabled = new Set(session.disabledTools || []);
  const subAgentsEnabled = getSubAgentConfig().enabled === true;
  return toolNames.map(name => ({
    name,
    enabled: (!subAgentToolNames.includes(name) || subAgentsEnabled) && !configDisabled.has(name) && !sessionDisabled.has(name),
  }));
}

function getSessionDisabledToolsForSession(session: Session): string[] {
  const configDisabled = loadConfig().disabledTools || [];
  const sessionDisabled = session.disabledTools || [];
  return sessionDisabled.filter(t => !configDisabled.includes(t));
}

function getSession(id?: string): Session {
  // Explicit session ID requested
  if (id) {
    const session = dbGetSession(id);
    if (session) {
      activeSessionId = id;
      return session;
    }
  }

  // Use active session if set and valid
  if (activeSessionId) {
    const session = dbGetSession(activeSessionId);
    if (session) return session;
  }

  // Fallback: most recent session or create new
  const recentRow = getDb().prepare(
    'SELECT id FROM sessions ORDER BY updated_at DESC LIMIT 1'
  ).get() as { id: string } | undefined;
  if (recentRow) {
    activeSessionId = recentRow.id;
    const session = dbGetSession(recentRow.id);
    if (session) return session;
  }

  // Create new session
  const session = createSession();
  activeSessionId = session.id;
  return session;
}

wss.on('connection', (ws) => {
  console.log('Client connected');

  const session = getSession();

  const agentCfg = getAgentModel();
  const allModels = getNamedModels().map(m => ({ name: m.name || '', model: m.model, endpoint: m.endpoint }));
  ws.send(JSON.stringify({
    type: 'session:connected',
    data: {
      sessionId: session.id,
      activeProjectId: session.projectId || 'default',
      thinkingEnabled: getEffectiveThinking(),
      voiceMode: session.voiceMode === true,
      projects: getProjects().map(p => ({ id: p.id, name: p.name })),
      config: {
        enableImagePaste: loadConfig().ui.enableImagePaste,
        expandThinking: loadConfig().ui.expandThinking,
        expandToolOutputs: loadConfig().ui.expandToolOutputs,
        collapseThinkingTools: loadConfig().ui.collapseThinkingTools,
        desktopNotifications: loadConfig().ui.desktopNotifications !== false,
        model: agentCfg.model,
        endpoint: agentCfg.endpoint,
        contextWindow: agentCfg.contextWindow,
      },
      models: allModels,
      activeModel: getActiveModelName(),
    },
  }));

  sessionSockets.set(ws, session.id);
  agent.bindClient(session.id, ws);
  ws.send(JSON.stringify({
    type: 'subagent:list',
    data: { ...agent.getSubAgentSnapshot(session.id), sessionId: session.id },
  }));

  ws.send(JSON.stringify({
    type: 'tools:list',
    data: { tools: getEnabledToolsForSession(session) },
  }));

  ws.send(JSON.stringify({
    type: 'mcp:list',
    data: { servers: mcpManager.getStatus() },
  }));

  sendPlanUpdate(ws, session.id);
  sendContextUpdate(ws, session);

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(normalizeLineEndings(data.toString()));
      const session = getSession();

      if (message.type === 'chat:message') {
        const userMsg = message.data.message;
        const images: string[] = message.data.images || [];
        const files: Array<{ name: string; type: string; dataUrl: string }> = message.data.files || [];

        // Steering: a message sent while the model is already working is
        // queued onto the in-flight turn instead of starting a new one.
        // Steers are text-only — images/files are dropped in steer mode.
        if (agent.isRunning) {
          const steerMsgId = `${session.id}-${Date.now()}`;
          if (images.length > 0 || files.length > 0) {
            console.log(`[index] steer received with ${images.length} image(s)/${files.length} file(s) — attachments dropped in steer mode`);
          }
          agent.steer(userMsg);
          ws.send(JSON.stringify({
            type: 'chat:message',
            data: {
              message: userMsg,
              messageId: steerMsgId,
              sessionId: session.id,
              steer: true,
            },
          }));
          return;
        }

        const msgId = `${session.id}-${Date.now()}`;
        const userMessage: Message = {
          id: msgId,
          role: 'user',
          content: userMsg,
          timestamp: new Date(),
          sessionId: session.id,
          images: images.length > 0 ? images : undefined,
        };

        if (files.length > 0 || images.length > 0) {
          const allAttachments: Attachment[] = [];
          if (files.length > 0) {
            allAttachments.push(...persistAttachments(files, session.id, msgId));
          }
          if (images.length > 0) {
            allAttachments.push(...persistImages(images, session.id, msgId, allAttachments.length));
          }
          userMessage.attachments = allAttachments;
        }

        session.messages.push(userMessage);
        session.updatedAt = new Date();
        saveSession(session);

        // Reserve empty title so it falls back to message count until auto-title lands
        if (!session.title || session.title === '') {
          session.title = '';
        }

        ws.send(JSON.stringify({
          type: 'chat:message',
          data: {
            message: userMsg,
            messageId: userMessage.id,
            sessionId: session.id,
          },
        }));

        agent.chat(userMsg, session, ws, images, userMessage.attachments)
        .then(() => saveSession(session))
        .then(async () => {
          // Auto-generate label + summary after first turn
          if (!session.title || session.title === '') {
            try {
              const firstAssistant = session.messages.find((m) => m.role === 'assistant');
              const result = await agent.suggestSessionSummary(userMsg, firstAssistant?.content);
              const label = result.label || userMsg.substring(0, 50) + (userMsg.length > 50 ? '...' : '');
              session.title = label;
              if (result.summary) {
                session.summary = result.summary;
              }
              session.updatedAt = new Date();
              saveSession(session);
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({
                  type: 'session:renamed',
                  data: { sessionId: session.id, title: label },
                }));
                if (result.summary) {
                  ws.send(JSON.stringify({
                    type: 'session:summary',
                    data: { sessionId: session.id, summary: result.summary },
                  }));
                }
              }
            } catch (e) {
              console.error('[index] auto-summary failed:', e);
            }
          }
        })
        .catch((err) => {
          console.error('Agent error:', err);
          ws.send(JSON.stringify({
            type: 'chat:response',
            data: {
              message: `Error: ${err.message}`,
              sessionId: session.id,
            },
          }));
        });
      }

      if (message.type === 'session:switch') {
        // Safety net: the client blocks switching while the model is working,
        // but refuse here too so a stray request can't orphan the active turn.
        if (agent.isRunning) {
          ws.send(JSON.stringify({
            type: 'switch:blocked',
            data: { reason: 'The model is still working — wait for it to finish or stop it first.' },
          }));
          return;
        }
        const id = message.data.sessionId;
        if (id && getSessionRow(id)) {
          activeSessionId = id;
          const switchedSession = dbGetSession(id)!;
          sessionSockets.set(ws, id);
          agent.bindClient(id, ws);
          ws.send(JSON.stringify({
            type: 'session:switched',
            data: { sessionId: id, projectId: switchedSession.projectId, thinkingEnabled: getEffectiveThinking(), voiceMode: switchedSession.voiceMode === true },
          }));
          ws.send(JSON.stringify({
            type: 'subagent:list',
            data: { ...agent.getSubAgentSnapshot(id), sessionId: id },
          }));
          sendPlanUpdate(ws, id);
          sendContextUpdate(ws, switchedSession);
        }
      }

      if (message.type === 'project:switch') {
        // Same safety net as session:switch — never swap projects mid-turn.
        if (agent.isRunning) {
          ws.send(JSON.stringify({
            type: 'switch:blocked',
            data: { reason: 'The model is still working — wait for it to finish or stop it first.' },
          }));
          return;
        }
        const projectId = message.data.projectId;
        if (projectId && getProject(projectId)) {
          // Switch to first session in this project, or create one
          const projectRows = getDb().prepare(
            'SELECT id FROM sessions WHERE project_id = ? ORDER BY updated_at DESC',
          ).all(projectId) as Array<{ id: string }>;

          let targetSession: Session;
          if (projectRows.length > 0) {
            targetSession = dbGetSession(projectRows[0].id)!;
          } else {
            targetSession = createSession(projectId);
            activeSessionId = targetSession.id;
          }

          ws.send(JSON.stringify({
            type: 'project:switched',
            data: {
              projectId,
              sessionId: targetSession.id,
              thinkingEnabled: getEffectiveThinking(),
              voiceMode: targetSession.voiceMode === true,
              projects: getProjects().map(p => ({ id: p.id, name: p.name })),
            },
          }));
          sendPlanUpdate(ws, targetSession.id);
          sendContextUpdate(ws, targetSession);
        }
      }

      if (message.type === 'chat:stop') {
        agent.stop();
        saveSession(session);
        ws.send(JSON.stringify({
          type: 'chat:stopped',
          data: { sessionId: session.id },
        }));
      }

      if (message.type === 'subagent:kill') {
        const agentId = String(message.data?.agentId || '');
        const ok = agent.cancelSubAgentById(agentId);
        ws.send(JSON.stringify({
          type: 'subagent:kill-result',
          data: { agentId, ok, sessionId: session.id },
        }));
        return;
      }

      if (message.type === 'thinking:toggle') {
        const enabled = message.data.enabled;
        setThinkingOverride(enabled);
        saveConfig({ ...getConfig(), thinkingEnabled: enabled });
        ws.send(JSON.stringify({
          type: 'thinking:toggled',
          data: { enabled, sessionId: session.id },
        }));
      }

      if (message.type === 'notifications:toggle') {
        const enabled = !!message.data.enabled;
        const cfg = getConfig();
        saveConfig({ ...cfg, ui: { ...cfg.ui, desktopNotifications: enabled } });
        ws.send(JSON.stringify({
          type: 'notifications:toggled',
          data: { enabled },
        }));
      }

      if (message.type === 'voice:toggle') {
        const enabled = !!message.data.enabled;
        session.voiceMode = enabled;
        session.updatedAt = new Date();
        saveSession(session);
        ws.send(JSON.stringify({
          type: 'voice:status',
          data: { enabled, sessionId: session.id },
        }));
      }

      if (message.type === 'session:clear') {
        session.messages = session.messages.filter((m) => m.role === 'system');
        session.updatedAt = new Date();
        saveSession(session);

        ws.send(JSON.stringify({
          type: 'session:cleared',
          data: { sessionId: session.id },
        }));

        sendPlanUpdate(ws, session.id);
        sendContextUpdate(ws, session);
      }

      if (message.type === 'message:revert') {
        const msgId = message.data.messageId;
        const sid = message.data.sessionId;
        const targetSession = sid ? dbGetSession(sid) : undefined;
        const actualSession = targetSession || session;
        const idx = actualSession.messages.findIndex((m) => m.id === msgId);
        if (idx !== -1) {
          const revertedText = actualSession.messages[idx].content;
          actualSession.messages = actualSession.messages.slice(0, idx);
          actualSession.updatedAt = new Date();
          saveSession(actualSession);
          ws.send(JSON.stringify({
            type: 'message:reverted',
            data: { messageId: msgId, text: revertedText },
          }));
        }
      }

      if (message.type === 'tools:toggle') {
        // Update session-level disabled tools (affects only this session)
        if (!session.disabledTools) session.disabledTools = [];
        const idx = session.disabledTools.indexOf(message.data.toolName);
        if (message.data.enabled && idx !== -1) {
          session.disabledTools.splice(idx, 1);
        } else if (!message.data.enabled && idx === -1) {
          session.disabledTools.push(message.data.toolName);
        }
        session.updatedAt = new Date();
        saveSession(session);
        ws.send(JSON.stringify({
          type: 'tools:toggled',
          data: { toolName: message.data.toolName, enabled: message.data.enabled },
        }));
        ws.send(JSON.stringify({
          type: 'tools:list',
          data: { tools: getEnabledToolsForSession(session) },
        }));
      }

      if (message.type === 'mcp:toggle') {
        const serverName = message.data.serverName;
        const enabled = !!message.data.enabled;
        const result = await mcpManager.setEnabled(serverName, enabled);
        ws.send(JSON.stringify({
          type: 'mcp:toggled',
          data: { serverName, enabled, success: result.success, error: result.error },
        }));
        ws.send(JSON.stringify({
          type: 'mcp:list',
          data: { servers: mcpManager.getStatus() },
        }));
      }

      if (message.type === 'mcp:refresh') {
        ws.send(JSON.stringify({
          type: 'mcp:list',
          data: { servers: mcpManager.getStatus() },
        }));
      }

      if (message.type === 'model:switch') {
        const modelName = message.data.modelName;
        const cfg = setActiveModelName(modelName);
        if (cfg) {
          agent.resetClient();
          agent.currentModelName = modelName;
          const agentCfg = getAgentModel(modelName);
          ws.send(JSON.stringify({
            type: 'model:switched',
            data: {
              activeModel: modelName,
              model: agentCfg.model,
              endpoint: agentCfg.endpoint,
              contextWindow: agentCfg.contextWindow,
              thinkingEnabled: getEffectiveThinking(),
              preserveThinking: agentCfg.preserveThinking ?? true,
            },
          }));
          sendContextUpdate(ws, session);
        }
      }

      // Handle session:summary events (auto-generated topic summaries)
      // Note: this handler is for when the client sends a session:summary event.
      // The server sends session:summary events via ws.send() when auto-summary completes.
      // No handler needed here — the server just sends, the client receives.

      if (message.type === 'session:rename') {
        const id = message.data.sessionId;
        const title = message.data.title;
        if (id && title && getSessionRow(id)) {
          updateSessionField(id, { title: { value: title } });
          ws.send(JSON.stringify({
            type: 'session:renamed',
            data: { sessionId: id, title },
          }));
        }
      }

      if (message.type === 'session:delete') {
        const id = message.data.sessionId;
        if (id && getSessionRow(id)) {
          deleteSessionById(id);
          ws.send(JSON.stringify({
            type: 'session:deleted',
            data: { sessionId: id },
          }));
          // If this was the active session, switch to recent
          if (activeSessionId === id) {
            const recent = getDb().prepare(
              'SELECT id FROM sessions ORDER BY updated_at DESC LIMIT 1'
            ).get() as { id: string } | undefined;
            activeSessionId = recent?.id || null;
          }
        }
      }

      if (message.type === 'session:create') {
        const projectId = message.data.projectId || 'default';
        const newSession = createSession(projectId);
        activeSessionId = newSession.id;
        ws.send(JSON.stringify({
          type: 'session:created',
          data: { sessionId: newSession.id, projectId: newSession.projectId },
        }));
        ws.send(JSON.stringify({
          type: 'session:switched',
          data: { sessionId: newSession.id, projectId: newSession.projectId, thinkingEnabled: getEffectiveThinking(), voiceMode: false },
        }));
      }

      if (message.type === 'context:compact') {
        console.log('[server] context:compact received, session has', session.messages.length, 'messages');
        await agent.triggerCompaction(session, getConfig(), ws);
        saveSession(session);
      }

      if (message.type === 'session:move') {
        const sessionId = message.data.sessionId;
        const projectId = message.data.projectId;
        const target = getSessionRow(sessionId);
        if (target && projectId && getProject(projectId) && (target.project_id || 'default') !== projectId) {
          updateSessionField(sessionId, { project_id: { value: projectId } });
          ws.send(JSON.stringify({
            type: 'session:moved',
            data: { sessionId, projectId },
          }));
        }
      }

      if (message.type === 'session:fork') {
        const targetSessionId = message.data.sessionId;
        const messageIndex = parseInt(message.data.messageIndex, 10);
        const target = dbGetSession(targetSessionId);

        if (!target) {
          ws.send(JSON.stringify({
            type: 'session:fork-result',
            data: { ok: false, error: 'Session not found' },
          }));
          return;
        }

        if (isNaN(messageIndex) || messageIndex < 0 || messageIndex >= target.messages.length) {
          ws.send(JSON.stringify({
            type: 'session:fork-result',
            data: { ok: false, error: 'Invalid message index' },
          }));
          return;
        }

        const forkMsg = target.messages[messageIndex];
        if (forkMsg.role !== 'assistant') {
          ws.send(JSON.stringify({
            type: 'session:fork-result',
            data: { ok: false, error: 'Can only fork from assistant messages' },
          }));
          return;
        }

        const projectId = target.projectId || 'default';
        try {
          const forkSession = createForkSession(target, forkMsg.id, projectId);

          ws.send(JSON.stringify({
            type: 'session:fork-result',
            data: {
              ok: true,
              sessionId: forkSession.id,
              parentSessionId: target.id,
              parentMessageId: forkMsg.id,
            },
          }));

          // Notify all clients about the fork
          for (const client of wss.clients) {
            if (client.readyState === 1) {
              client.send(JSON.stringify({
                type: 'session:forked',
                data: {
                  sessionId: forkSession.id,
                  parentSessionId: target.id,
                  parentMessageId: forkMsg.id,
                },
              }));
            }
          }
        } catch (err: any) {
          console.error('[fork] failed to create fork:', err);
          ws.send(JSON.stringify({
            type: 'session:fork-result',
            data: { ok: false, error: err.message },
          }));
        }
      }
    } catch (err) {
      console.error('Failed to parse message:', err);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    // Drop only the session mapping still pointing at this socket; background
    // agents keep running and their reports wait for the next client/turn.
    for (const [socket, sessionId] of sessionSockets.entries()) {
      if (socket === ws) sessionSockets.delete(socket);
    }
  });
});

process.on('SIGINT', async () => {
  await mcpManager.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await mcpManager.shutdown();
  process.exit(0);
});
