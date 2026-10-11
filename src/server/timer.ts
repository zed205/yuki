import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Timer service: time-based wakes for the agent. Timers persist across server
// restarts (unlike jobs). Kinds:
//   once  — fire at an absolute time (relative "30m" or ISO), then consumed
//   every — repeat at a fixed interval ("15m")
//   daily — repeat at a local wall-clock time ("09:00")
// On fire the engine invokes the registered callback, which (in index.ts)
// queues a synthetic user turn in the timer's session.

export type TimerKind = 'once' | 'every' | 'daily';

export interface Timer {
  id: string;
  name: string;
  note: string;
  sessionId: string;
  kind: TimerKind;
  atMs?: number;      // once: original absolute fire time
  everyMs?: number;   // every: interval
  dailyAt?: string;   // daily: "HH:MM" local
  nextFireAt: number;
  createdAt: number;
  jobIds: string[];
  lastFiredAt?: number;
  // Transient (not persisted): the scheduled time that was missed while the
  // server was down, so the wake message can say so.
  missedAt?: number;
}

export interface FiredRecord {
  id: string;
  name: string;
  note: string;
  sessionId: string;
  firedAt: number;
  scheduledAt: number;
  jobIds: string[];
  missed: boolean;
}

const timersPath = path.join(os.homedir(), '.config', 'yukiweb', 'timers.json');
const timers = new Map<string, Timer>();
let firedHistory: FiredRecord[] = [];
let seq = 1;
let tickTimer: NodeJS.Timeout | null = null;

const MAX_ACTIVE_TIMERS = 20;
const MIN_EVERY_MS = 10 * 1000;
const MAX_DELAY_MS = 30 * 24 * 60 * 60 * 1000;

type FireCb = (rec: FiredRecord, timer: Timer) => void;
type UpdatedCb = () => void;
let onFireCb: FireCb | null = null;
let onUpdatedCb: UpdatedCb | null = null;

// --- Parsing helpers ---

export function parseDuration(str: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([smhd])\s*$/i.exec(str);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60000 : unit === 'h' ? 3600000 : 86400000;
  return n * mult;
}

// Accepts a relative duration ("30m", "2h", "45s") or an absolute date/time
// (ISO 8601 or "YYYY-MM-DD HH:MM"). Returns epoch ms or null.
export function parseAt(str: string): number | null {
  const dur = parseDuration(str);
  if (dur !== null) return Date.now() + dur;
  const t = Date.parse(str);
  if (Number.isNaN(t)) return null;
  return t;
}

export function parseDailyAt(str: string): string | null {
  const m = /^\s*([01]\d|2[0-3]):([0-5]\d)\s*$/.exec(str);
  if (!m) return null;
  return `${m[1]}:${m[2]}`;
}

export function nextDailyOccurrence(hhmm: string, from: number): number {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(from);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= from) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function lastDailyOccurrence(hhmm: string, before: number): number {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(before);
  d.setHours(h, m, 0, 0);
  if (d.getTime() >= before) d.setDate(d.getDate() - 1);
  return d.getTime();
}

// --- Formatting helpers (used by tools + environment context) ---

function fmtLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtIn(ms: number): string {
  if (ms < 90 * 1000) return `in ${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 90 * 60 * 1000) return `in ${Math.round(ms / 60000)}m`;
  if (ms < 36 * 3600 * 1000) {
    const h = Math.floor(ms / 3600000);
    const m = Math.round((ms % 3600000) / 60000);
    return `in ${h}h ${String(m).padStart(2, '0')}m`;
  }
  return `in ${Math.round(ms / 86400000)}d`;
}

export function describeTimer(t: Timer): string {
  const when = t.kind === 'daily'
    ? `daily at ${t.dailyAt}`
    : t.kind === 'every'
      ? `every ${fmtDuration(t.everyMs || 0)}`
      : `once at ${fmtLocal(t.atMs || t.nextFireAt)}`;
  return `${t.id} "${t.name}" — ${when}, next fire ${fmtLocal(t.nextFireAt)} (${fmtIn(t.nextFireAt - Date.now())})${t.jobIds.length ? `, jobs: ${t.jobIds.join(', ')}` : ''}`;
}

function fmtDuration(ms: number): string {
  if (ms < 90 * 1000) return `${Math.round(ms / 1000)}s`;
  if (ms < 90 * 60 * 1000) return `${Math.round(ms / 60000)}m`;
  if (ms < 36 * 3600 * 1000) return `${Math.floor(ms / 3600000)}h ${Math.round((ms % 3600000) / 60000)}m`;
  return `${Math.round(ms / 86400000)}d`;
}

// --- Persistence ---

function serializeTimers(): any {
  return {
    seq,
    fired: firedHistory,
    timers: Array.from(timers.values()).map(t => ({
      id: t.id,
      name: t.name,
      note: t.note,
      sessionId: t.sessionId,
      kind: t.kind,
      atMs: t.atMs,
      everyMs: t.everyMs,
      dailyAt: t.dailyAt,
      nextFireAt: t.nextFireAt,
      createdAt: t.createdAt,
      jobIds: t.jobIds,
      lastFiredAt: t.lastFiredAt,
    })),
  };
}

function saveTimers(): void {
  try {
    if (!fs.existsSync(path.dirname(timersPath))) {
      fs.mkdirSync(path.dirname(timersPath), { recursive: true });
    }
    fs.writeFileSync(timersPath, JSON.stringify(serializeTimers(), null, 2));
  } catch (err) {
    console.error('Failed to save timers:', err);
  }
}

function loadTimers(): void {
  timers.clear();
  firedHistory = [];
  seq = 1;
  try {
    if (!fs.existsSync(timersPath)) return;
    const data = JSON.parse(fs.readFileSync(timersPath, 'utf-8'));
    const now = Date.now();
    for (const t of data.timers || []) {
      const timer: Timer = { ...t, jobIds: t.jobIds || [] };
      timers.set(timer.id, timer);
      const n = parseInt(timer.id.replace(/\D/g, ''), 10);
      if (!Number.isNaN(n) && n >= seq) seq = n + 1;

      if (timer.kind === 'once' && timer.nextFireAt < now) {
        // Overdue while the server was down — fire on the first tick, flagged.
        timer.missedAt = timer.nextFireAt;
        timer.nextFireAt = now;
      } else if (timer.kind === 'daily' && timer.dailyAt) {
        const last = lastDailyOccurrence(timer.dailyAt, now);
        // A scheduled occurrence passed while the server was down: fire once now
        // (flagged as missed), then resume from the next future occurrence. The
        // lastFiredAt ?? createdAt guard stops a timer whose first fire is still
        // in the future (created, say, the previous evening) from false-firing.
        const ref = timer.lastFiredAt ?? timer.createdAt;
        if (last > ref && timer.nextFireAt < now) {
          timer.missedAt = last;
          timer.nextFireAt = now;
        }
      } else if (timer.kind === 'every' && timer.nextFireAt < now) {
        // Catch up exactly once, then keep cadence from the actual fire.
        timer.nextFireAt = now;
      }
    }
    firedHistory = Array.isArray(data.fired) ? data.fired : [];
    if (typeof data.seq === 'number' && data.seq >= seq) seq = data.seq;
  } catch (err) {
    console.error('Failed to load timers:', err);
  }
}

// --- Engine ---

export function initTimerEngine(onFire: FireCb, onUpdated?: UpdatedCb): void {
  if (tickTimer) return;
  onFireCb = onFire;
  onUpdatedCb = onUpdated || null;
  loadTimers();
  tickTimer = setInterval(tick, 1000);
  console.log(`[timers] engine started with ${timers.size} pending timer(s)`);
}

function tick(): void {
  const now = Date.now();
  const due = Array.from(timers.values()).filter(t => t.nextFireAt <= now);
  for (const t of due) {
    const rec: FiredRecord = {
      id: t.id,
      name: t.name,
      note: t.note,
      sessionId: t.sessionId,
      firedAt: now,
      scheduledAt: t.missedAt ?? t.nextFireAt,
      jobIds: t.jobIds,
      missed: t.missedAt !== undefined,
    };
    t.lastFiredAt = now;
    delete t.missedAt;
    if (t.kind === 'once') {
      timers.delete(t.id);
      firedHistory.push(rec);
      if (firedHistory.length > 20) firedHistory.shift();
    } else if (t.kind === 'every') {
      t.nextFireAt = now + (t.everyMs || MIN_EVERY_MS);
    } else if (t.dailyAt) {
      t.nextFireAt = nextDailyOccurrence(t.dailyAt, now);
    } else {
      timers.delete(t.id);
    }
    saveTimers();
    onUpdatedCb?.();
    console.log(`[timers] fired ${t.id} "${t.name}" (missed=${rec.missed})`);
    try {
      onFireCb?.(rec, t);
    } catch (err) {
      console.error('[timers] fire callback failed:', err);
    }
  }
}

// --- Tool-facing API ---

export function timerSet(opts: {
  name?: string;
  note?: string;
  sessionId: string;
  at?: string;
  every?: string;
  dailyAt?: string;
  jobIds?: string[];
}): { timer?: Timer; error?: string } {
  if (timers.size >= MAX_ACTIVE_TIMERS) {
    return { error: `Cannot set timer: ${MAX_ACTIVE_TIMERS} timers already pending. Cancel one with timer_cancel first.` };
  }

  const name = (opts.name || '').trim() || 'timer';
  const note = (opts.note || '').trim();
  const jobIds = Array.isArray(opts.jobIds) ? opts.jobIds.map(j => String(j).trim()).filter(Boolean) : [];

  const scheds = [opts.at, opts.every, opts.dailyAt].filter(v => v && String(v).trim());
  if (scheds.length === 0) {
    return { error: 'Provide exactly one schedule: at (e.g. "30m", "2h", ISO time), every (e.g. "15m"), or dailyAt (e.g. "09:00").' };
  }
  if (scheds.length > 1) {
    return { error: 'Provide only ONE of at / every / dailyAt, not multiple.' };
  }

  const now = Date.now();
  let kind: TimerKind;
  let nextFireAt: number;
  let atMs: number | undefined;
  let everyMs: number | undefined;
  let dailyAt: string | undefined;

  if (opts.at) {
    const t = parseAt(String(opts.at));
    if (t === null) return { error: `Could not parse at="${opts.at}". Use a relative duration ("30m", "2h", "45s") or an absolute time (ISO 8601).` };
    if (t <= now) return { error: `at="${opts.at}" is in the past. Use a future time or a relative duration.` };
    if (t - now > MAX_DELAY_MS) return { error: `at="${opts.at}" is more than 30 days out. Max delay is 30 days.` };
    kind = 'once';
    atMs = t;
    nextFireAt = t;
  } else if (opts.every) {
    const ms = parseDuration(String(opts.every));
    if (ms === null) return { error: `Could not parse every="${opts.every}". Use e.g. "15m", "1h", "30s".` };
    if (ms < MIN_EVERY_MS) return { error: `every="${opts.every}" is too short. Minimum interval is 10s.` };
    if (ms > MAX_DELAY_MS) return { error: `every="${opts.every}" is more than 30 days. Max interval is 30 days.` };
    kind = 'every';
    everyMs = ms;
    nextFireAt = now + ms;
  } else {
    const hhmm = parseDailyAt(String(opts.dailyAt));
    if (!hhmm) return { error: `Could not parse dailyAt="${opts.dailyAt}". Use 24h "HH:MM" local time, e.g. "09:00".` };
    kind = 'daily';
    dailyAt = hhmm;
    nextFireAt = nextDailyOccurrence(hhmm, now);
  }

  const timer: Timer = {
    id: `t${seq++}`,
    name,
    note,
    sessionId: opts.sessionId,
    kind,
    atMs,
    everyMs,
    dailyAt,
    nextFireAt,
    createdAt: now,
    jobIds,
  };
  timers.set(timer.id, timer);
  saveTimers();
  onUpdatedCb?.();
  return { timer };
}

export function timerCancel(ref: string): { timer?: Timer; error?: string } {
  const key = String(ref || '').trim();
  if (!key) return { error: 'Provide a timer id (e.g. "t1") or name.' };
  let t = timers.get(key);
  if (!t) {
    t = Array.from(timers.values()).find(x => x.name.toLowerCase() === key.toLowerCase());
  }
  if (!t) {
    const any = Array.from(timers.values()).find(x => x.id.toLowerCase() === key.toLowerCase() || x.name.toLowerCase().includes(key.toLowerCase()));
    return { error: any
      ? `No timer "${key}" — did you mean ${any.id} "${any.name}"?`
      : `No pending timer matches "${key}". Use timer_list to see pending timers.` };
  }
  timers.delete(t.id);
  saveTimers();
  onUpdatedCb?.();
  return { timer: t };
}

export function timerList(): string {
  if (timers.size === 0) return 'No pending timers.';
  const lines: string[] = [];
  for (const t of Array.from(timers.values()).sort((a, b) => a.nextFireAt - b.nextFireAt)) {
    lines.push(describeTimer(t));
    if (t.note) lines.push(`   note: ${t.note}`);
  }
  return lines.join('\n');
}

export function getTimersForUI(): Array<{
  id: string; name: string; kind: TimerKind; nextFireAt: number;
  note: string; sessionId: string; jobIds: string[];
  dailyAt?: string; everyMs?: number;
}> {
  return Array.from(timers.values())
    .sort((a, b) => a.nextFireAt - b.nextFireAt)
    .map(t => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      nextFireAt: t.nextFireAt,
      note: t.note,
      sessionId: t.sessionId,
      jobIds: t.jobIds,
      dailyAt: t.dailyAt,
      everyMs: t.everyMs,
    }));
}

export function cancelTimersForSession(sessionId: string): number {
  const ids = Array.from(timers.values()).filter(t => t.sessionId === sessionId).map(t => t.id);
  for (const id of ids) timers.delete(id);
  if (ids.length > 0) {
    saveTimers();
    onUpdatedCb?.();
  }
  return ids.length;
}

// One-line pending-timer summary for the environment context block.
export function getTimersSummary(): string {
  const all = Array.from(timers.values()).sort((a, b) => a.nextFireAt - b.nextFireAt);
  if (all.length === 0) return '';
  const shown = all.slice(0, 5).map(t => {
    const what = t.kind === 'daily' ? `daily ${t.dailyAt}` : t.kind === 'every' ? `every ${fmtDuration(t.everyMs || 0)}` : 'once';
    return `${t.id} "${t.name}" ${what} ${fmtIn(t.nextFireAt - Date.now())}`;
  });
  const extra = all.length > 5 ? ` (+${all.length - 5} more)` : '';
  return `Pending timers: ${shown.join('; ')}${extra}. Use timer_list for details; a timer firing restarts your turn automatically.`;
}
