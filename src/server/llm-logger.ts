import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getConfig } from './config';

const LOG_DIR = path.join(os.homedir(), '.config', 'yukiweb', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'llm-raw.log');
const SEP = '\n' + '='.repeat(80) + '\n';

function ensureDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function truncateImageUrls(obj: unknown): unknown {
  if (typeof obj === 'string') {
    const match = obj.match(/^data:image\/[^;]+;base64,/);
    if (match) {
      const header = match[0];
      const totalLen = Buffer.byteLength(obj, 'utf-8');
      return `${header}[base64 data: ${totalLen} bytes]`;
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(truncateImageUrls);
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = truncateImageUrls(v);
    }
    return result;
  }
  return obj;
}

function maxBytes(): number {
  return (getConfig().rawLLMLog?.maxSizeMB ?? 25) * 1024 * 1024;
}

function rollIfNeeded(): void {
  try {
    const max = maxBytes();
    const stat = fs.statSync(LOG_FILE);
    if (stat.size <= max) return;
    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    const bytes = Buffer.byteLength(content, 'utf-8');
    if (bytes <= max) return;
    const keepBytes = Math.floor(max * 0.45);
    const targetLen = content.length;
    let cut = 0;
    for (let i = targetLen - 1; i >= 0; i--) {
      if (targetLen - i > keepBytes && content[i] === '=' && content.substring(i, i + SEP.length) === SEP) {
        cut = i + SEP.length;
        break;
      }
    }
    if (cut === 0) {
      cut = Math.max(0, targetLen - Math.floor(max * 0.6));
    }
    fs.writeFileSync(LOG_FILE, content.substring(cut));
  } catch {
    // File may not exist yet
  }
}

function append(text: string): void {
  ensureDir();
  fs.appendFileSync(LOG_FILE, text + SEP);
  rollIfNeeded();
}

export function logLLMRequestResponse(
  requestBody: unknown,
  response: { content: string; reasoningContent?: string; toolCalls?: unknown[]; usage?: unknown },
  durationMs: number,
  error?: string,
  meta?: { modelName?: string; openaiClientModel?: string; sessionId?: string; projectId?: string },
): void {
  const cfg = getConfig().rawLLMLog;
  if (!cfg?.enabled) return;
  const ts = new Date().toISOString();
  const safeReq = truncateImageUrls(requestBody);
  const metaLine = meta && Object.values(meta).some(v => v !== undefined)
    ? `META: ${JSON.stringify(meta)}`
    : undefined;
  const lines: string[] = [
    `--- ${ts} (${durationMs}ms)${error ? ' ERROR: ' + error : ''} ---`,
    ...(metaLine ? [metaLine] : []),
    'REQUEST:',
    JSON.stringify(safeReq, null, 2),
    'RESPONSE:',
    JSON.stringify(response, null, 2),
  ];
  append(lines.join('\n'));
}
