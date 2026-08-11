import express from 'express';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { loadConfig, loadSystemPrompt, saveConfig, getConfig, getAgentModel, getNamedModels, getActiveModelName, setActiveModelName, getModelDefaultThinking, getEffectiveThinking, setThinkingOverride, loadEnvFile } from './config';
import { Agent } from './agent';
import { AudioPipeline } from './audio';
import { BrowserAutomation } from './browser';
import { DesktopAutomation } from './automation';
import { MCPManager } from './mcp';
import { toolNames } from './tools';
import { planGet, loadPlans } from './plan';
import { loadProjects, getProjects, getProject, createProject, renameProject, deleteProject, reorderProjects } from './project';
import { Session, Message, Attachment } from '../shared/types';
import * as fs from 'fs';
import * as os from 'os';

loadEnvFile();

const app = express();
const PORT = parseInt(process.env.PORT || '3210', 10);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'client')));

const sessions: Map<string, Session> = new Map();
const sessionDataDir = path.join(os.homedir(), '.config', 'yukiweb', 'sessions');
const attachmentsDir = path.join(os.homedir(), '.config', 'yukiweb', 'attachments');

function ensureSessionDir(): void {
  if (!fs.existsSync(sessionDataDir)) {
    fs.mkdirSync(sessionDataDir, { recursive: true });
  }
}

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
    ensureSessionDir();
    const filePath = path.join(sessionDataDir, `${session.id}.json`);
    const serialized = {
      ...session,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      messages: session.messages.map((m) => ({
        ...m,
        timestamp: m.timestamp.toISOString(),
      })),
    };
    fs.writeFileSync(filePath, JSON.stringify(serialized));
  } catch (err) {
    console.error('Failed to save session:', err);
  }
}

function loadSessions(): void {
  try {
    ensureSessionDir();
    const files = fs.readdirSync(sessionDataDir).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      const filePath = path.join(sessionDataDir, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      const session: Session = {
        id: data.id,
        title: data.title,
        projectId: data.projectId || 'default',
        thinkingEnabled: data.thinkingEnabled,
        voiceMode: data.voiceMode,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
        messages: data.messages.map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp),
        })),
      };

      sessions.set(session.id, session);
    }

    if (files.length > 0) {
      const lastFile = files.sort().pop()!;
      const lastData = JSON.parse(fs.readFileSync(path.join(sessionDataDir, lastFile), 'utf-8'));
      activeSessionId = lastData.id;
    }
  } catch (err) {
    console.error('Failed to load sessions:', err);
  }
}

function createSession(projectId?: string): Session {
  const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const session: Session = {
    id,
    messages: [],
    projectId: projectId || 'default',
    createdAt: new Date(),
    updatedAt: new Date(),
    thinkingEnabled: undefined,
  };

  const systemPrompt = loadSystemPrompt();
  if (systemPrompt) {
    session.messages.push({
      id: `${id}-system`,
      role: 'system',
      content: systemPrompt,
      timestamp: new Date(),
      sessionId: id,
    });
  }

  sessions.set(id, session);
  return session;
}

let activeSessionId: string | null = null;

loadConfig();
loadSessions();
loadPlans();
loadProjects();

const audioPipeline = new AudioPipeline();
const browserAutomation = new BrowserAutomation();
const desktopAutomation = new DesktopAutomation();
const mcpManager = new MCPManager(loadConfig().mcpServers || []);
const agent = new Agent();

agent.setServices(audioPipeline, browserAutomation, desktopAutomation, mcpManager);
agent.initToolDefaults();

// --- Session API ---
app.get('/api/sessions', (req, res) => {
  const projectId = req.query.projectId as string || 'default';
  const sessionList = Array.from(sessions.values())
    .filter(s => (s.projectId || 'default') === projectId)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      messageCount: s.messages.filter((m) => m.role !== 'system').length,
    }));
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
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q) {
    res.json([]);
    return;
  }
  const results: any[] = [];
  for (const s of sessions.values()) {
    const title = s.title || '';
    const titleMatch = title.toLowerCase().includes(q);
    let snippet = '';
    let matchCount = 0;
    for (const m of s.messages) {
      const content = m.content || '';
      if (content.toLowerCase().includes(q)) {
        matchCount++;
        if (!snippet) snippet = makeSnippet(content, q);
      }
    }
    if (!titleMatch && matchCount === 0) continue;
    results.push({
      id: s.id,
      title: title || `${s.messages.filter((m) => m.role !== 'system').length} messages`,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      messageCount: s.messages.filter((m) => m.role !== 'system').length,
      snippet,
      matchCount,
    });
  }
  results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json(results);
});

app.get('/api/sessions/:id', (req, res) => {
  const session = sessions.get(req.params.id);
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
  if (!sessions.has(id)) return;
  sessions.delete(id);
  try {
    const filePath = path.join(sessionDataDir, `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error('Failed to delete session file:', err);
  }
  if (activeSessionId === id) {
    activeSessionId = sessions.size > 0 ? Array.from(sessions.keys())[0] : null;
  }
}

app.delete('/api/sessions/:id', (req, res) => {
  const id = req.params.id;
  if (!sessions.has(id)) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  deleteSessionById(id);
  res.json({ success: true });
});

app.post('/api/sessions/:id/rename', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  session.title = req.body.title;
  session.updatedAt = new Date();
  saveSession(session);
  res.json({ success: true });
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
    for (const session of Array.from(sessions.values())) {
      if ((session.projectId || 'default') === req.params.id) {
        deleteSessionById(session.id);
      }
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tree', (_req, res) => {
  const tree = getProjects().map(p => ({
    id: p.id,
    name: p.name,
    sessions: Array.from(sessions.values())
      .filter(s => (s.projectId || 'default') === p.id)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(s => ({
        id: s.id,
        title: s.title,
        updatedAt: s.updatedAt.toISOString(),
        messageCount: s.messages.filter(m => m.role !== 'system').length,
        projectId: p.id,
      })),
  }));
  res.json({ projects: tree, activeProjectId: activeSessionId ? (sessions.get(activeSessionId)?.projectId || 'default') : 'default' });
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
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`YukiWeb server running at http://0.0.0.0:${PORT}`);
});

// Periodic cleanup of temp output files older than 15 minutes
const tempOutputDir = path.join(os.tmpdir(), 'yukiweb-outputs');
setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
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

function getSession(id?: string): Session {
  if (id && sessions.has(id)) {
    activeSessionId = id;
    return sessions.get(id)!;
  }

  if (activeSessionId && sessions.has(activeSessionId)) {
    return sessions.get(activeSessionId)!;
  }

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
        model: agentCfg.model,
        endpoint: agentCfg.endpoint,
        contextWindow: agentCfg.contextWindow,
      },
      models: allModels,
      activeModel: getActiveModelName(),
    },
  }));

  ws.send(JSON.stringify({
    type: 'tools:list',
    data: { tools: toolNames.map(name => ({ name, enabled: !(loadConfig().disabledTools || []).includes(name) })).filter(t => t.enabled) },
  }));

  ws.send(JSON.stringify({
    type: 'mcp:list',
    data: { servers: mcpManager.getStatus() },
  }));

  sendPlanUpdate(ws, session.id);
  sendContextUpdate(ws, session);

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      const session = getSession();

      if (message.type === 'chat:message') {
        const userMsg = message.data.message;
        const images: string[] = message.data.images || [];
        const files: Array<{ name: string; type: string; dataUrl: string }> = message.data.files || [];

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

        if (!session.title || session.title === '') {
          session.title = userMsg.substring(0, 50) + (userMsg.length > 50 ? '...' : '');
          saveSession(session);
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
        const id = message.data.sessionId;
        if (id && sessions.has(id)) {
          activeSessionId = id;
          const switchedSession = sessions.get(id)!;
          ws.send(JSON.stringify({
            type: 'session:switched',
            data: { sessionId: id, projectId: switchedSession.projectId, thinkingEnabled: getEffectiveThinking(), voiceMode: switchedSession.voiceMode === true },
          }));
          sendPlanUpdate(ws, id);
          sendContextUpdate(ws, switchedSession);
        }
      }

      if (message.type === 'project:switch') {
        const projectId = message.data.projectId;
        if (projectId && getProject(projectId)) {
          // Switch to first session in this project, or create one
          const projectSessions = Array.from(sessions.values())
            .filter(s => (s.projectId || 'default') === projectId)
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

          let targetSession: Session;
          if (projectSessions.length > 0) {
            targetSession = projectSessions[0];
          } else {
            targetSession = createSession();
            targetSession.projectId = projectId;
            saveSession(targetSession);
          }

          activeSessionId = targetSession.id;
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

      if (message.type === 'thinking:toggle') {
        const enabled = message.data.enabled;
        setThinkingOverride(enabled);
        saveConfig({ ...getConfig(), thinkingEnabled: enabled });
        ws.send(JSON.stringify({
          type: 'thinking:toggled',
          data: { enabled, sessionId: session.id },
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
        const targetSession = sid && sessions.has(sid) ? sessions.get(sid)! : session;
        const idx = targetSession.messages.findIndex((m) => m.id === msgId);
        if (idx !== -1) {
          const revertedText = targetSession.messages[idx].content;
          targetSession.messages = targetSession.messages.slice(0, idx);
          targetSession.updatedAt = new Date();
          saveSession(targetSession);
          ws.send(JSON.stringify({
            type: 'message:reverted',
            data: { messageId: msgId, text: revertedText },
          }));
        }
      }

      if (message.type === 'message:prune') {
        const msgId = message.data.messageId;
        const sid = message.data.sessionId;
        const targetSession = sid && sessions.has(sid) ? sessions.get(sid)! : session;
        const idx = targetSession.messages.findIndex((m) => m.id === msgId);
        if (idx !== -1) {
          let prevUserIdx = -1;
          for (let i = idx - 1; i >= 0; i--) {
            if (targetSession.messages[i].role === 'user') {
              prevUserIdx = i;
              break;
            }
          }
          const startIdx = prevUserIdx !== -1 ? prevUserIdx : 0;
          for (let i = startIdx; i <= idx; i++) {
            targetSession.messages[i].pruned = true;
          }
          targetSession.updatedAt = new Date();
          saveSession(targetSession);
          ws.send(JSON.stringify({
            type: 'message:pruned',
            data: { messageId: msgId, fromIdx: startIdx, toIdx: idx },
          }));
        }
      }

      if (message.type === 'message:unprune') {
        const msgId = message.data.messageId;
        const sid = message.data.sessionId;
        const targetSession = sid && sessions.has(sid) ? sessions.get(sid)! : session;
        const idx = targetSession.messages.findIndex((m) => m.id === msgId);
        if (idx !== -1) {
          let prevUserIdx = -1;
          for (let i = idx - 1; i >= 0; i--) {
            if (targetSession.messages[i].role === 'user') {
              prevUserIdx = i;
              break;
            }
          }
          const startIdx = prevUserIdx !== -1 ? prevUserIdx : 0;
          for (let i = startIdx; i <= idx; i++) {
            targetSession.messages[i].pruned = false;
          }
          targetSession.updatedAt = new Date();
          saveSession(targetSession);
          ws.send(JSON.stringify({
            type: 'message:unpruned',
            data: { messageId: msgId },
          }));
        }
      }

      if (message.type === 'tools:toggle') {
        agent.setToolEnabled(message.data.toolName, message.data.enabled);
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

      if (message.type === 'session:rename') {
        const id = message.data.sessionId;
        const title = message.data.title;
        if (id && title && sessions.has(id)) {
          const s = sessions.get(id)!;
          s.title = title;
          s.updatedAt = new Date();
          saveSession(s);
          ws.send(JSON.stringify({
            type: 'session:renamed',
            data: { sessionId: id, title },
          }));
        }
      }

      if (message.type === 'session:move') {
        const sessionId = message.data.sessionId;
        const projectId = message.data.projectId;
        const target = sessions.get(sessionId);
        if (target && projectId && getProject(projectId) && target.projectId !== projectId) {
          target.projectId = projectId;
          target.updatedAt = new Date();
          saveSession(target);
          ws.send(JSON.stringify({
            type: 'session:moved',
            data: { sessionId, projectId },
          }));
        }
      }
    } catch (err) {
      console.error('Failed to parse message:', err);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
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
