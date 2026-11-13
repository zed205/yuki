import { getSubAgentConfig } from './config';

/**
 * Background sub-agent registry.
 *
 * Sub-agents are decoupled from the parent's turn: `spawn_agent` starts a job
 * and returns an id immediately, the parent keeps working, and results are
 * either delivered automatically as context or collected with `agent_result`.
 *
 * The registry owns:
 *   - slot accounting (running sub-agents, not counting the main agent),
 *   - a FIFO admission queue when every slot is busy,
 *   - cancellation via a per-job AbortController,
 *   - completion waiters and the undelivered-result queue.
 *
 * Jobs are in-memory and die with the server (like background shell jobs).
 */

export type SubAgentStatus = 'queued' | 'running' | 'completed' | 'error' | 'cancelled';

export interface SubAgentJob {
  id: string;
  sessionId: string;
  description: string;
  task: string;
  model: string;
  /** Project directory captured at spawn time; children never read live state. */
  projectPath: string;
  status: SubAgentStatus;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  report?: string;
  error?: string;
  /** True once the report has entered the parent's context (or was read). */
  delivered: boolean;
  /** Per-job cancellation. Never shared with the parent turn. */
  abort: AbortController;
  /** Completion callbacks (internal). */
  waiters: Array<() => void>;
}

/** Emitted so the agent can push UI events without the registry knowing about sockets. */
export type SubAgentChange = 'queued' | 'started' | 'done';
export type SubAgentListener = (change: SubAgentChange, job: SubAgentJob) => void;

type Starter = (job: SubAgentJob) => Promise<string>;

const jobs = new Map<string, SubAgentJob>();
const starters = new Map<string, Starter>();
const queue: string[] = [];

const DEFAULT_MAX_QUEUED = 8;
const KEEP_TERMINAL_PER_SESSION = 20;

let running = 0;
let listener: SubAgentListener | null = null;

export function setSubAgentListener(fn: SubAgentListener): void {
  listener = fn;
}

function notify(change: SubAgentChange, job: SubAgentJob): void {
  try {
    listener?.(change, job);
  } catch (err) {
    console.error('[subagent] listener error:', err);
  }
}

export function isTerminal(job: SubAgentJob): boolean {
  return job.status === 'completed' || job.status === 'error' || job.status === 'cancelled';
}

export function runningSubAgentCount(): number {
  return running;
}

export function queuedSubAgentCount(): number {
  return queue.length;
}

export function maxSubAgentSlots(): number {
  return Math.max(1, Math.floor(getSubAgentConfig().maxAgentSlots || 1));
}

/** Position in the admission queue (1-based), or 0 when not queued. */
export function subAgentQueuePosition(id: string): number {
  const idx = queue.indexOf(id);
  return idx >= 0 ? idx + 1 : 0;
}

export function getSubAgent(id: string): SubAgentJob | undefined {
  return jobs.get(id);
}

export function listSubAgents(sessionId?: string): SubAgentJob[] {
  const all = Array.from(jobs.values());
  return all
    .filter(j => !sessionId || j.sessionId === sessionId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function elapsedMs(job: SubAgentJob): number {
  const end = job.endedAt ?? Date.now();
  return Math.max(0, end - (job.startedAt ?? job.createdAt));
}

/**
 * Create and (if a slot is free) start a background sub-agent.
 * Throws a model-readable error when the queue is full.
 */
export function createSubAgent(
  opts: {
    sessionId: string;
    description: string;
    task: string;
    model: string;
    projectPath: string;
  },
  starter: Starter,
): SubAgentJob {
  const cfg = getSubAgentConfig();
  const maxQueued = Number.isFinite(cfg.maxQueued as number)
    ? Math.max(0, Math.floor(cfg.maxQueued as number))
    : DEFAULT_MAX_QUEUED;

  if (queue.length >= maxQueued && running >= maxSubAgentSlots()) {
    throw new Error(
      `sub-agent limit reached (${running}/${maxSubAgentSlots()} running, ${queue.length}/${maxQueued} queued). ` +
      `Wait for a running sub-agent to finish, or cancel one with agent_kill.`,
    );
  }

  const id = `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const job: SubAgentJob = {
    id,
    sessionId: opts.sessionId,
    description: opts.description,
    task: opts.task,
    model: opts.model,
    projectPath: opts.projectPath,
    status: 'queued',
    createdAt: Date.now(),
    delivered: false,
    abort: new AbortController(),
    waiters: [],
  };

  jobs.set(id, job);
  starters.set(id, starter);

  if (running < maxSubAgentSlots() && queue.length === 0) {
    launch(job);
  } else {
    // Preserve FIFO: a new job never overtakes agents already waiting.
    queue.push(id);
    notify('queued', job);
    drainQueue();
  }
  return job;
}

function launch(job: SubAgentJob): void {
  const starter = starters.get(job.id);
  if (!starter) return;

  job.status = 'running';
  job.startedAt = Date.now();
  running++;
  notify('started', job);

  starter(job).then(
    (report) => {
      if (job.abort.signal.aborted) {
        finish(job, 'cancelled', undefined, 'cancelled');
      } else {
        finish(job, 'completed', report);
      }
    },
    (err) => {
      const message = err?.message || String(err);
      if (job.abort.signal.aborted) {
        finish(job, 'cancelled', undefined, 'cancelled');
      } else {
        finish(job, 'error', undefined, message);
      }
    },
  );
}

function finish(
  job: SubAgentJob,
  status: Exclude<SubAgentStatus, 'queued' | 'running'>,
  report?: string,
  error?: string,
): void {
  if (isTerminal(job)) return;

  // Only a job that actually occupied a slot may release one. Queued jobs are
  // finished here too (cancelled before launch) and must not decrement.
  const wasRunning = job.status === 'running';

  job.status = status;
  job.endedAt = Date.now();
  job.report = report;
  job.error = error;
  starters.delete(job.id);
  if (wasRunning) running = Math.max(0, running - 1);

  for (const wake of job.waiters.splice(0)) {
    try { wake(); } catch { /* ignore */ }
  }

  notify('done', job);
  drainQueue();
  prune();
}

function drainQueue(): void {
  while (running < maxSubAgentSlots() && queue.length > 0) {
    const id = queue.shift()!;
    const job = jobs.get(id);
    if (!job || job.status !== 'queued') continue;
    if (job.abort.signal.aborted) {
      finish(job, 'cancelled', undefined, 'cancelled before it started');
      continue;
    }
    launch(job);
  }
}

function prune(): void {
  const perSession = new Map<string, SubAgentJob[]>();
  for (const job of jobs.values()) {
    if (!isTerminal(job)) continue;
    const list = perSession.get(job.sessionId) || [];
    list.push(job);
    perSession.set(job.sessionId, list);
  }
  for (const list of perSession.values()) {
    list.sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));
    for (const old of list.slice(KEEP_TERMINAL_PER_SESSION)) {
      // Never prune a report the parent has not seen yet.
      if (!old.delivered) continue;
      jobs.delete(old.id);
    }
  }
}

/**
 * Wait for a job to reach a terminal state. `timeoutMs = 0` waits indefinitely.
 * Resolves with the current job state (which may still be running on timeout).
 */
export function waitForSubAgent(
  id: string,
  timeoutMs = 0,
  signal?: AbortSignal,
): Promise<SubAgentJob | undefined> {
  const job = jobs.get(id);
  if (!job || isTerminal(job)) return Promise.resolve(job);

  return new Promise<SubAgentJob | undefined>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(jobs.get(id));
    };
    const onAbort = () => done();
    const timer = timeoutMs > 0 ? setTimeout(done, timeoutMs) : null;

    job.waiters.push(done);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) done();
  });
}

/** Mark a report as consumed so it is not injected twice. */
export function markSubAgentDelivered(id: string): void {
  const job = jobs.get(id);
  if (job) job.delivered = true;
}

/** All finished-but-unseen results for a session, oldest first. */
export function takeUndeliveredResults(sessionId: string): SubAgentJob[] {
  const out: SubAgentJob[] = [];
  for (const job of jobs.values()) {
    if (job.sessionId !== sessionId || !isTerminal(job) || job.delivered) continue;
    job.delivered = true;
    out.push(job);
  }
  return out.sort((a, b) => (a.endedAt || 0) - (b.endedAt || 0));
}

export function hasUndeliveredResults(sessionId?: string): boolean {
  for (const job of jobs.values()) {
    if (isTerminal(job) && !job.delivered && (!sessionId || job.sessionId === sessionId)) return true;
  }
  return false;
}

/** Finished-but-unseen results for a session without consuming them. */
export function listUndeliveredResults(sessionId: string): SubAgentJob[] {
  return Array.from(jobs.values())
    .filter(j => j.sessionId === sessionId && isTerminal(j) && !j.delivered)
    .sort((a, b) => (a.endedAt || 0) - (b.endedAt || 0));
}

/** Cancel one job. Returns false when it is unknown or already finished. */
export function cancelSubAgent(id: string, reason = 'cancelled by the parent agent'): boolean {
  const job = jobs.get(id);
  if (!job || isTerminal(job)) return false;

  job.abort.abort();
  if (job.status === 'queued') {
    const idx = queue.indexOf(id);
    if (idx >= 0) queue.splice(idx, 1);
    finish(job, 'cancelled', undefined, reason);
  }
  // Running jobs settle through their starter promise; finish() is idempotent.
  return true;
}

export function cancelSubAgentsForSession(sessionId: string, reason = 'session closed'): number {
  let n = 0;
  for (const job of jobs.values()) {
    if (job.sessionId === sessionId && !isTerminal(job)) {
      if (cancelSubAgent(job.id, reason)) n++;
    }
  }
  return n;
}

export function cancelAllSubAgents(reason = 'cancelled by user'): number {
  let n = 0;
  for (const job of jobs.values()) {
    if (!isTerminal(job)) {
      if (cancelSubAgent(job.id, reason)) n++;
    }
  }
  return n;
}

/** Compact JSON snapshot for the model-facing `agent_list` tool. */
export function describeSubAgent(job: SubAgentJob): Record<string, any> {
  return {
    agentId: job.id,
    description: job.description,
    status: job.status,
    model: job.model,
    elapsedSeconds: Math.round(elapsedMs(job) / 1000),
    queuePosition: job.status === 'queued' ? subAgentQueuePosition(job.id) : undefined,
    reportReady: job.status === 'completed' && !job.delivered,
    error: job.error,
  };
}

/** The context block injected into the parent when background results land. */
export function formatSubAgentResults(jobs: SubAgentJob[], totalSpawned: number): string {
  const finishedCount = jobs.length;
  const pendingCount = totalSpawned - finishedCount;
  const sections = jobs.map(job => {
    const head = `### ${job.description} (${job.id}) — ${job.status} in ${Math.round(elapsedMs(job) / 1000)}s`;
    const body = job.status === 'completed'
      ? (job.report || '[no report]')
      : (job.error || `[${job.status}]`);
    return `${head}\n${body}`;
  });
  return [
    '## Background Sub-Agent Results',
    `${finishedCount} of ${totalSpawned} sub-agent(s) have finished so far. ${pendingCount > 0 ? pendingCount + ' agent(s) still running.' : 'All agents complete.'}`,
    'Treat each report as a claim, not as fact: before relying on it or telling the user it is done, validate the parts that matter — read the files it changed, inspect the diff, re-run the command or test it cites. State clearly what you verified and what you did not. Use agent_result with an id if you need the report again.',
    '',
    sections.join('\n\n'),
  ].join('\n');
}
