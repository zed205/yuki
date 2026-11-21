/**
 * BrowserExtension — server-side bridge to one or more "Yuki Browser Control"
 * browser extensions.
 *
 * Each extension is a WebSocket client on `/ws/browser-ext`. This class keeps a
 * socket registry, correlates request/response frames by id, and exposes
 * `dispatch(action, params, browserId?)` which returns a **string** — the exact
 * tool result the LLM sees (matching how the Playwright `BrowserAutomation`
 * tools behave in tools.ts / agent.ts).
 *
 * Protocol: see extension/PROTOCOL.md.
 */
import { WebSocket } from 'ws';

interface Conn {
  ws: WebSocket;
  browserId: string | null;
  connectedAt: number;
  userAgent?: string;
}

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export interface ExtStatus {
  connected: boolean;
  count: number;
  connections: Array<{ browserId: string | null; connectedAt: number; userAgent?: string }>;
}

const DEFAULT_TIMEOUT_MS = 30000;
const SCREENSHOT_TIMEOUT_MS = 60000;
/** Hard cap on non-image tool results so a runaway page read cannot flood context. */
const MAX_RESULT_CHARS = 40000;

let idSeq = 0;
function nextId(): string {
  idSeq = (idSeq + 1) & 0xffffff;
  return 'ext' + idSeq.toString(36) + Math.random().toString(36).slice(2, 8);
}

function jstr(v: any): string {
  try {
    if (typeof v === 'string') return v;
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** Mirror of isImageResult in context-budget.ts (raw PNG base64 is protected). */
function isImagePayload(s: string): boolean {
  const head = s.slice(0, 32);
  return head.startsWith('data:image/') || head.startsWith('iVBORw0KGgo') || head.startsWith('/9j/');
}

export class BrowserExtension {
  private conns = new Map<WebSocket, Conn>();
  private pending = new Map<string, Pending>();
  private onConnectionChange: ((status: ExtStatus) => void) | null = null;

  setConnectionChangeHandler(cb: (status: ExtStatus) => void): void {
    this.onConnectionChange = cb;
  }

  private emitChange(): void {
    if (this.onConnectionChange) {
      try { this.onConnectionChange(this.status()); } catch { /* ignore */ }
    }
  }

  status(): ExtStatus {
    const connections = Array.from(this.conns.values())
      .filter((c) => c.ws.readyState === 1 /* OPEN */)
      .map((c) => ({ browserId: c.browserId, connectedAt: c.connectedAt, userAgent: c.userAgent }));
    return { connected: connections.length > 0, count: connections.length, connections };
  }

  isConnected(): boolean {
    return this.status().connected;
  }

  /** Register a freshly-upgraded socket. It is "connected" until it closes. */
  handleSocket(ws: WebSocket): void {
    const conn: Conn = { ws, browserId: null, connectedAt: Date.now() };
    this.conns.set(ws, conn);
    ws.on('message', (data: any) => this.handleMessage(conn, data));
    ws.on('close', () => this.handleClose(conn));
    ws.on('error', (e: any) => console.warn('[browser-ext] socket error:', e?.message || e));
    console.log('[browser-ext] socket connected (awaiting hello)...');
    this.emitChange();
  }

  private handleMessage(conn: Conn, data: any): void {
    let msg: any;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'response') {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok === false) p.reject(new Error(typeof msg.error === 'string' && msg.error ? msg.error : 'Browser extension command failed'));
        else p.resolve(msg.result);
      }
      return;
    }

    if (msg.type === 'event') {
      if (msg.method === 'hello') {
        const payload = msg.payload || {};
        conn.browserId = payload.browserId || 'anon-' + Math.random().toString(36).slice(2, 10);
        conn.userAgent = typeof payload.browser === 'string' ? payload.browser : undefined;
        console.log('[browser-ext] browser connected: ' + conn.browserId + ' (total ' + this.status().count + ')');
        this.emitChange();
      } else if (msg.method === 'pong') {
        // heartbeat reply — nothing to do
      }
      // (tabsChanged and other events are ignored for now; a future UI may use them.)
    }
  }

  private handleClose(conn: Conn): void {
    if (this.conns.get(conn.ws) === conn) {
      this.conns.delete(conn.ws);
      console.log('[browser-ext] browser disconnected: ' + (conn.browserId || 'pending') + ' (total ' + this.status().count + ')');
      this.emitChange();
    }
  }

  private resolveWs(browserId?: string): WebSocket {
    const open = Array.from(this.conns.values()).filter((c) => c.ws.readyState === 1);
    if (!open.length) {
      throw new Error('No browser extension is connected. Load the "Yuki Browser Control" extension in a Chromium browser (Chrome/Edge/Brave) and make sure the Yuki server is running on port 3210.');
    }
    if (browserId) {
      const conn = open.find((c) => c.browserId === browserId);
      if (conn) return conn.ws;
      const ids = open.map((c) => c.browserId).filter(Boolean).join(', ');
      throw new Error('No connected browser with id "' + browserId + '". Connected browsers: ' + (ids || 'none identified yet'));
    }
    if (open.length === 1) return open[0].ws;
    const ids = open.map((c) => c.browserId).filter(Boolean).join(', ');
    throw new Error('Multiple browsers are connected (' + (ids || 'unknown') + '). Re-run the action with the browserId parameter to pick one.');
  }

  /** Send a request to the extension and resolve with the structured result. */
  rawCommand(method: string, params: any, browserId?: string, timeoutMs?: number): Promise<any> {
    const ws = this.resolveWs(browserId);
    const id = nextId();
    const timeout = timeoutMs || DEFAULT_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Timed out after ' + Math.round(timeout / 1000) + 's waiting for the browser extension (' + method + ').'));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        ws.send(JSON.stringify({ id, type: 'request', method, params: params || {} }));
      } catch (e: any) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('Failed to send command to the browser extension: ' + (e?.message || e)));
      }
    });
  }

  /**
   * Dispatch an `ext_browser` action and return the string the LLM sees.
   * `action` maps 1:1 to a protocol method; `params` is the action's parameter object.
   */
  async dispatch(action: string, params: any, browserId?: string): Promise<string> {
    if (!action) return 'Error: ext_browser requires an "action". See the tool description for the list of actions.';
    const method = action;
    const timeoutMs = action === 'screenshot' ? SCREENSHOT_TIMEOUT_MS : undefined;
    const result = await this.rawCommand(method, params || {}, browserId, timeoutMs);
    return this.formatResult(action, result);
  }

  private formatResult(action: string, result: any): string {
    if (result === null || result === undefined) return '(no result)';

    // Screenshot → raw base64 (no data: prefix) so agent.ts wraps it as an image.
    if (action === 'screenshot') {
      const b64 = typeof result === 'string' ? result : (result && typeof result.data === 'string' ? result.data : null);
      if (b64) return b64;
      return 'Screenshot failed: ' + jstr(result);
    }

    let text: string;
    switch (action) {
      case 'status':
        text = jstr(result);
        break;
      case 'listTabs':
        text = Array.isArray(result?.tabs) && result.tabs.length
          ? result.tabs.map((t: any) => `#${t.id} ${t.active ? '[active] ' : ''}"${t.title || ''}" — ${t.url}`).join('\n')
          : '(no tabs)';
        break;
      case 'getActiveTab':
        text = result && result.id != null ? `active tab #${result.id}: "${result.title || ''}" — ${result.url || ''}` : jstr(result);
        break;
      case 'eval':
        if (result && result.exception) text = 'JavaScript exception: ' + (result.text || 'unknown');
        else if (result && result.value !== undefined) text = typeof result.value === 'string' ? result.value : jstr(result.value);
        else text = jstr(result);
        break;
      case 'links':
        text = Array.isArray(result?.links) && result.links.length
          ? result.links.map((l: any) => `${l.text || '(no text)'} → ${l.href}`).join('\n')
          : '(no links)';
        break;
      case 'text':
        text = typeof result?.text === 'string' ? (result.text || '(no text)') : jstr(result);
        break;
      case 'html':
        text = typeof result?.html === 'string' ? (result.html || '(no html)') : jstr(result);
        break;
      case 'axTree':
        text = typeof result?.tree === 'string' ? result.tree : jstr(result);
        break;
      case 'visibleElements':
        text = Array.isArray(result?.elements) && result.elements.length
          ? result.elements.map((e: any) => `<${e.tag}> "${e.text || ''}" @ (${e.x},${e.y}) ${e.width}x${e.height}${e.href ? ' ' + e.href : ''}`).join('\n')
          : '(no interactive elements)';
        break;
      case 'pageStructure':
        if (result && (result.title || Array.isArray(result.headings))) {
          const lines = [
            `Title: ${result.title || '(none)'}`,
            `URL: ${result.url || ''}`,
            `Ready: ${result.readyState || '?'} · links: ${result.linkCount ?? '?'} · forms: ${result.formCount ?? '?'} · captcha: ${result.captcha ? 'yes' : 'no'}`,
            Array.isArray(result.headings) && result.headings.length
              ? 'Headings:\n' + result.headings.map((h: any) => `  ${h.t}: ${h.text}`).join('\n')
              : '',
          ].filter(Boolean);
          text = lines.join('\n');
        } else {
          text = jstr(result);
        }
        break;
      case 'network':
        text = Array.isArray(result?.requests) && result.requests.length
          ? result.requests.map((r: any) => `${r.method || ''} ${r.status != null ? r.status : '—'} ${r.url}`).join('\n')
          : '(no captured requests yet)';
        break;
      case 'console':
        text = Array.isArray(result?.messages) && result.messages.length
          ? result.messages.map((m: any) => `[${m.level || 'log'}] ${m.text}`).join('\n')
          : '(no console messages yet)';
        break;
      default:
        text = jstr(result);
    }

    // Never cap image payloads (screenshots are already handled above; be safe anyway).
    if (isImagePayload(text)) return text;
    if (text.length > MAX_RESULT_CHARS) {
      return text.slice(0, MAX_RESULT_CHARS) + `\n…[truncated ${text.length - MAX_RESULT_CHARS} of ${text.length} chars — narrow the query (e.g. use a selector or smaller limit)]`;
    }
    return text;
  }

  /** Tear down all extension connections (server shutdown). */
  close(): void {
    for (const conn of this.conns.values()) {
      try { conn.ws.close(); } catch { /* ignore */ }
    }
    this.conns.clear();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Server shutting down'));
    }
    this.pending.clear();
  }
}
