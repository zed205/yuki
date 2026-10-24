import { ContextManagementConfig, Message, Session } from '../shared/types';

/**
 * Context budget accounting.
 *
 * The previous heuristic (chars / 4) undercounted real prompt tokens by ~68% on
 * research-heavy sessions full of punctuation-dense HTML/markdown, code and
 * fetched pages. Conversations therefore sailed past the model window long before
 * compaction was considered. Estimates here are deliberately pessimistic and are
 * calibrated at runtime against the provider's reported prompt_tokens, which is
 * the only ground truth available.
 */

// Deliberately pessimistic: compacting a little early is free, a 400 is not.
export const DEFAULT_CHARS_PER_TOKEN = 3.0;
const MIN_CHARS_PER_TOKEN = 1.5;
const MAX_CHARS_PER_TOKEN = 6;
const PER_MESSAGE_OVERHEAD_TOKENS = 8;
const PER_TOOL_CALL_OVERHEAD_TOKENS = 6;
const CALIBRATION_WEIGHT = 0.3;

export type BudgetConfig = Partial<ContextManagementConfig> & {
  imageTokensPerImage?: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function resolveCharsPerToken(session?: Partial<Session> | null, cfg?: BudgetConfig | null): number {
  const configured = session?.charsPerToken ?? cfg?.charsPerToken;
  if (typeof configured === 'number' && configured > 0) {
    return clamp(configured, MIN_CHARS_PER_TOKEN, MAX_CHARS_PER_TOKEN);
  }
  return DEFAULT_CHARS_PER_TOKEN;
}

export function textTokens(text: string | undefined | null, cpt: number): number {
  if (!text) return 0;
  return Math.ceil(text.length / cpt);
}

/** Token cost of an OpenAI-style content field (plain string or multimodal array). */
export function contentTokens(content: unknown, cpt: number, imageTokensPerImage: number): number {
  if (typeof content === 'string') return textTokens(content, cpt);
  if (Array.isArray(content)) {
    let total = 0;
    for (const part of content as any[]) {
      if (!part || typeof part !== 'object') {
        total += textTokens(String(part), cpt);
      } else if (part.type === 'image_url') {
        total += imageTokensPerImage;
      } else if (typeof part.text === 'string') {
        total += textTokens(part.text, cpt);
      } else {
        total += textTokens(JSON.stringify(part), cpt);
      }
    }
    return total;
  }
  if (content == null) return 0;
  return textTokens(String(content), cpt);
}

/**
 * Token cost of a stored session message as it will be replayed on the next turn.
 *
 * Stored images are intentionally not counted: history replay only forwards
 * `content` (agent.ts rebuild), so old base64 blobs never re-enter the prompt.
 */
export function sessionMessageTokens(msg: Message, cpt: number, imageTokensPerImage: number): number {
  let total = contentTokens(msg.content, cpt, imageTokensPerImage) + PER_MESSAGE_OVERHEAD_TOKENS;
  if (msg.reasoningContent) total += textTokens(msg.reasoningContent, cpt);
  for (const tc of msg.toolCalls || []) {
    total += textTokens(JSON.stringify(tc.parameters ?? {}), cpt) + PER_TOOL_CALL_OVERHEAD_TOKENS;
    if (tc.result) total += textTokens(tc.result, cpt);
  }
  return total;
}

/** Projected cost of the next request built from the stored session. */
export function estimateSessionTokens(
  session: Session,
  cfg?: BudgetConfig | null,
  overheadChars = 0,
): number {
  const cpt = resolveCharsPerToken(session, cfg);
  const imageTokens = cfg?.imageTokensPerImage || 1024;
  let total = Math.ceil(overheadChars / cpt);
  for (const msg of session.messages) {
    // Compacted turns are kept in the log but no longer replayed to the model,
    // so they are excluded from the projected prompt cost.
    if (!msg.compacted) total += sessionMessageTokens(msg, cpt, imageTokens);
  }
  return total;
}

/** Projected cost of an in-flight request array (the shape actually sent). */
export function estimateRequestTokens(
  messages: Array<Record<string, any>>,
  session?: Partial<Session> | null,
  cfg?: BudgetConfig | null,
): number {
  const cpt = resolveCharsPerToken(session, cfg);
  const imageTokens = cfg?.imageTokensPerImage || 1024;
  let total = 0;
  for (const msg of messages) {
    total += contentTokens(msg.content, cpt, imageTokens) + PER_MESSAGE_OVERHEAD_TOKENS;
    if (msg.reasoning_content) total += textTokens(msg.reasoning_content, cpt);
    for (const tc of msg.tool_calls || []) {
      total += textTokens(JSON.stringify(tc.function?.arguments ?? tc.arguments ?? {}), cpt)
        + textTokens(tc.function?.name ?? tc.name ?? '', cpt)
        + PER_TOOL_CALL_OVERHEAD_TOKENS;
    }
  }
  return total;
}

/** Raw character weight of a request array — the numerator used for calibration. */
export function requestChars(messages: Array<Record<string, any>>): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content as any[]) {
        if (part && typeof part.text === 'string') total += part.text.length;
        else if (part && part.type !== 'image_url') total += JSON.stringify(part).length;
      }
    } else if (msg.content != null) {
      total += String(msg.content).length;
    }
    if (msg.reasoning_content) total += msg.reasoning_content.length;
    for (const tc of msg.tool_calls || []) {
      total += JSON.stringify(tc.function?.arguments ?? tc.arguments ?? {}).length;
      total += (tc.function?.name ?? tc.name ?? '').length;
    }
  }
  return total;
}

/**
 * Fold the provider's reported prompt token count back into the session so the
 * next estimate starts from reality rather than a character heuristic.
 */
export function calibrateFromUsage(
  session: Session,
  actualPromptTokens: number,
  measuredChars: number,
): void {
  if (!actualPromptTokens || actualPromptTokens <= 0 || !measuredChars || measuredChars <= 0) return;
  const observed = clamp(measuredChars / actualPromptTokens, MIN_CHARS_PER_TOKEN, MAX_CHARS_PER_TOKEN);
  const prev = session.charsPerToken;
  session.charsPerToken = prev
    ? prev * (1 - CALIBRATION_WEIGHT) + observed * CALIBRATION_WEIGHT
    : observed;
  session.lastPromptTokens = actualPromptTokens;
}

/**
 * Context size to trust for a request: the larger of the live estimate and the
 * last provider-confirmed count (grown by a safety margin). Growth inside a
 * single tool loop happens faster than any estimator can track.
 */
export function projectedPromptTokens(session: Session, estimate: number, margin = 1.15): number {
  const last = session.lastPromptTokens || 0;
  return Math.max(estimate, last > 0 ? Math.ceil(last * margin) : 0);
}

const READ_SHOWING_RE = /\[Showing lines (\d+)-(\d+) of (\d+)\]\s*$/;
const IMAGE_RESULT_PREFIXES = ['data:image/', 'iVBORw0KGgo', '/9j/'];

/** Inline image payloads must never be truncated — they are vision input. */
export function isImageResult(result: string | undefined): boolean {
  if (!result) return false;
  const head = result.slice(0, 32);
  return IMAGE_RESULT_PREFIXES.some(p => head.startsWith(p));
}

/**
 * Cap what a tool result costs the conversation forever.
 *
 * Results stay complete on disk and in the request that produced them (the UI
 * still shows the full text); only the copy retained in history — and therefore
 * replayed on every later turn — is capped.
 */
export function capToolResult(
  name: string,
  params: Record<string, any> | undefined,
  result: string | undefined,
  maxChars: number,
): string {
  if (!result || maxChars <= 0 || result.length <= maxChars) return result || '';
  if (isImageResult(result)) return result;
  return name === 'read'
    ? capReadResult(params, result, maxChars)
    : capGenericResult(name, result, maxChars);
}

function capGenericResult(name: string, result: string, maxChars: number): string {
  const dropped = result.length - maxChars;
  const marker =
    `\n\n[Context budget: this ${name} result was truncated to ${maxChars} of ${result.length} characters ` +
    `(~${dropped} dropped). Re-run the tool, or read the saved output file it names, if you need the rest.]`;
  const room = Math.max(0, maxChars - marker.length);
  return result.slice(0, room) + marker;
}

/**
 * `read` results are line-numbered and end with a "[Showing lines a-b of n]"
 * marker, so the cap can hand back an exact resume offset instead of a vague
 * "output truncated" note.
 */
function capReadResult(
  params: Record<string, any> | undefined,
  result: string,
  maxChars: number,
): string {
  const showing = READ_SHOWING_RE.exec(result);
  const total = showing ? Number(showing[3]) : null;
  const lines = result.split('\n');
  const kept: string[] = [];
  let length = 0;
  let numberedKept = 0;

  for (const line of lines) {
    if (kept.length > 0 && length + line.length + 1 > maxChars) break;
    kept.push(line);
    length += line.length + 1;
    if (/^\d+: /.test(line)) numberedKept++;
  }

  const startOffset = Number.isFinite(params?.offset) ? Number(params?.offset) : 0;
  const nextOffset = startOffset + numberedKept;
  const filePath = typeof params?.filePath === 'string' ? params.filePath : 'the file';
  const of = total ? ` of ${total}` : '';
  const marker =
    `\n\n[Context budget: showing ${numberedKept} line(s)${of}. ` +
    `Continue with read(filePath="${filePath}", offset=${nextOffset}, limit=...)]`;

  return kept.join('\n') + marker;
}
