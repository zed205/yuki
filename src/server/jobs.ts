import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getConfig } from './config';

// Strip ANSI escape sequences (PowerShell adds color codes).
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\([B]/g, '');
}

// Background shell jobs: long-running commands started via shell(background: true).
// Jobs are ephemeral — they are child processes of this server and die with it,
// so they are not persisted. Timers are persisted; jobs are not.

export interface JobInfo {
  id: string;
  command: string;
  pid?: number;
  sessionId?: string;
  status: 'running' | 'exited' | 'killed';
  exitCode: number | null;
  startedAt: number;
  endedAt?: number;
  logPath: string;
  tail: string[];
  wakeOnExit: boolean;
  error?: string;
  // Set when the model asked to kill the job, so the eventual close is treated
  // as a kill (no wake) rather than a surprising "exited" notification.
  killRequested?: boolean;
}

const jobsDir = path.join(os.homedir(), '.config', 'yukiweb', 'jobs');
const jobs = new Map<string, JobInfo>();
const procs = new Map<string, ChildProcess>();
let seq = 1;
const MAX_TAIL_LINES = 200;
const MAX_ACTIVE_JOBS = 10;
const KILL_GRACE_MS = 3000;

type ExitListener = (job: JobInfo) => void;
let exitListener: ExitListener | null = null;

export function setJobExitListener(fn: ExitListener): void {
  exitListener = fn;
}

function ensureDir(): void {
  if (!fs.existsSync(jobsDir)) {
    fs.mkdirSync(jobsDir, { recursive: true });
  }
}

// Job logs are never part of any user task once a job ends, so prune anything
// older than a week on each new job start.
function purgeOldLogs(): void {
  try {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const entry of fs.readdirSync(jobsDir)) {
      if (!entry.endsWith('.log')) continue;
      const fp = path.join(jobsDir, entry);
      try {
        const stat = fs.statSync(fp);
        if (stat.isFile() && stat.mtimeMs < cutoff) fs.unlinkSync(fp);
      } catch { /* skip individual file errors */ }
    }
  } catch { /* skip directory errors */ }
}

export function startJob(command: string, opts: { sessionId?: string; wakeOnExit?: boolean } = {}): JobInfo {
  const active = Array.from(jobs.values()).filter(j => j.status === 'running').length;
  if (active >= MAX_ACTIVE_JOBS) {
    const err: JobInfo = {
      id: '',
      command,
      status: 'exited',
      exitCode: null,
      startedAt: Date.now(),
      logPath: '',
      tail: [],
      wakeOnExit: false,
      error: `Cannot start job: ${MAX_ACTIVE_JOBS} background jobs already running. Wait for some to finish or kill one with shell_kill.`,
    };
    return err;
  }

  ensureDir();
  purgeOldLogs();
  const id = `j${seq++}`;
  const logPath = path.join(jobsDir, `${id}.log`);
  fs.writeFileSync(logPath, '', 'utf-8');

  const job: JobInfo = {
    id,
    command,
    sessionId: opts.sessionId,
    status: 'running',
    exitCode: null,
    startedAt: Date.now(),
    logPath,
    tail: [],
    wakeOnExit: opts.wakeOnExit !== false,
  };
  jobs.set(id, job);

  // Use the configured shell engine (default: pwsh on Windows)
  const shellCfg = getConfig().shell;
  let cmd: string, args: string[];
  if (process.platform === 'win32') {
    switch (shellCfg.engine) {
      case 'pwsh':
        cmd = shellCfg.pwshPath || 'pwsh';
        args = ['-NoProfile', '-Command', command];
        break;
      case 'ps5':
        cmd = shellCfg.ps5Path || 'powershell';
        args = ['-NoProfile', '-Command', command];
        break;
      case 'cmd':
      default:
        cmd = shellCfg.cmdPath || 'cmd';
        args = ['/d', '/s', '/c', command];
        break;
    }
  } else {
    cmd = 'sh';
    args = ['-c', command];
  }
  const proc = spawn(cmd, args, { cwd: process.cwd(), windowsHide: true });
  procs.set(id, proc);

  let pending = '';
  const onChunk = (data: Buffer) => {
    pending += stripAnsi(data.toString('utf-8'));
    let idx: number;
    while ((idx = pending.search(/\r?\n/)) !== -1) {
      const line = pending.slice(0, idx).replace(/\r/g, '');
      pending = pending.slice(idx).replace(/^\r?\n/, '');
      job.tail.push(line);
      if (job.tail.length > MAX_TAIL_LINES) job.tail.splice(0, job.tail.length - MAX_TAIL_LINES);
      try { fs.appendFileSync(logPath, line + '\n'); } catch { /* disk errors are non-fatal */ }
    }
  };
  proc.stdout?.on('data', onChunk);
  proc.stderr?.on('data', onChunk);

  proc.on('spawn', () => { job.pid = proc.pid; });
  proc.on('error', (err) => {
    job.error = err.message;
    finishJob(job, null);
  });
  proc.on('close', (code) => {
    finishJob(job, code);
  });

  return job;
}

function finishJob(job: JobInfo, code: number | null): void {
  if (job.status !== 'running') return;
  const wasKillRequested = job.killRequested === true;
  job.status = wasKillRequested ? 'killed' : 'exited';
  job.exitCode = wasKillRequested ? null : code;
  job.endedAt = Date.now();
  procs.delete(job.id);
  console.log(`[jobs] ${job.id} "${job.command.slice(0, 80)}" ${wasKillRequested ? 'killed' : `exited code=${code}`}`);
  // No wake on a model-initiated kill — the model already knows it stopped it.
  if (!wasKillRequested && exitListener) {
    try {
      exitListener(job);
    } catch (err) {
      console.error('[jobs] exit listener failed:', err);
    }
  }
}

export function getJob(id: string): JobInfo | undefined {
  return jobs.get(id);
}

export function killJob(id: string): string {
  const job = jobs.get(id);
  if (!job) return `No background job with id "${id}".`;
  if (job.status !== 'running') {
    return `Job ${id} is not running (status: ${job.status}, exit code: ${job.exitCode ?? 'n/a'}).`;
  }
  const proc = procs.get(id);
  if (!proc) {
    // Process handle already gone (exited between status checks) — mark stopped.
    job.status = 'killed';
    job.endedAt = Date.now();
    return `Job ${id} was not running and has been marked as stopped.`;
  }
  try {
    job.killRequested = true;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
    } else {
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (jobs.get(id)?.status === 'running') {
          try { proc.kill('SIGKILL'); } catch { /* already gone */ }
        }
      }, KILL_GRACE_MS).unref();
    }
    // If the process doesn't report close promptly (Windows taskkill), mark it
    // so the model gets a definite answer instead of a stale "running".
    setTimeout(() => {
      if (jobs.get(id)?.status === 'running') {
        job.status = 'killed';
        job.endedAt = Date.now();
        procs.delete(id);
      }
    }, 2000).unref();
  } catch (err: any) {
    return `Failed to kill job ${id}: ${err.message}`;
  }
  return `Kill signal sent to job ${id} (pid ${proc.pid ?? 'unknown'}). Use shell_status to confirm it stopped.`;
}

export function activeJobCount(): number {
  return Array.from(jobs.values()).filter(j => j.status === 'running').length;
}
