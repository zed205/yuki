import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import { getConfig } from './config';

const pythonDir = path.join(__dirname, '..', '..', 'python');

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

// Persistent JSON-lines sidecar (python/uiad.py) that speaks the Windows
// UI Automation API. One process, many fast calls — unlike the desktop.py
// one-shot spawns, COM/UIA init happens only once. Element handles issued by
// the sidecar are only valid while this process is alive.
export class UiaAutomation {
  private proc: ChildProcess | null = null;
  private ready = false;
  private starting: Promise<void> | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private buffer = '';

  isEnabled(): boolean {
    return getConfig().uiAutomation?.enabled !== false;
  }

  private async ensureRunning(): Promise<void> {
    if (this.ready && this.proc && this.proc.exitCode === null) return;
    if (this.starting) {
      await this.starting;
      return;
    }
    await this.spawnProc();
  }

  private spawnProc(): Promise<void> {
    this.starting = new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (err: Error) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      const proc = spawn('python', [path.join(pythonDir, 'uiad.py')], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.proc = proc;
      this.ready = false;

      const kill = () => {
        try { proc.kill(); } catch { /* already gone */ }
      };

      proc.on('error', (err) => {
        if (this.proc === proc) { this.proc = null; this.ready = false; }
        kill();
        this.failAll(new Error(`failed to start UIA sidecar: ${err.message}`));
        fail(new Error(`failed to start UIA sidecar: ${err.message}`));
      });

      proc.on('exit', (code) => {
        if (this.proc === proc) { this.proc = null; this.ready = false; }
        this.failAll(new Error(
          `UIA sidecar exited (code ${code ?? 'unknown'}) — element handles are now invalid; ` +
          're-run ui_list_windows or ui_tree to get fresh handles'
        ));
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString().trim();
        if (text) console.error('[uiad]', text);
      });

      proc.stdout.on('data', (data) => {
        this.buffer += data.toString();
        let idx: number;
        while ((idx = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, idx).trim();
          this.buffer = this.buffer.slice(idx + 1);
          if (!line) continue;
          let msg: { id?: number; ready?: boolean; result?: unknown; error?: string };
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.ready) {
            this.ready = true;
            if (!settled) {
              settled = true;
              resolve();
            }
            continue;
          }
          if (msg.id === undefined) continue;
          const p = this.pending.get(msg.id);
          if (!p) continue;
          this.pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.error) p.reject(new Error(msg.error));
          else p.resolve(msg.result);
        }
      });

      const readyTimer = setTimeout(() => {
        if (!this.ready) {
          fail(new Error('UIA sidecar did not become ready within 20s (is `pip install uiautomation` complete?)'));
          kill();
        }
      }, 20000);
      readyTimer.unref?.();
    });

    this.starting.finally(() => { this.starting = null; });
    return this.starting;
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  // Call a sidecar method; resolves with the result string.
  async call(method: string, params: Record<string, unknown> = {}, timeoutMs = 60000): Promise<string> {
    if (!this.isEnabled()) {
      throw new Error('UI automation is disabled in config (uiAutomation.enabled)');
    }
    await this.ensureRunning();
    const proc = this.proc;
    if (!proc || proc.exitCode !== null || !proc.stdin) {
      throw new Error('UIA sidecar is not running');
    }

    const id = this.nextId++;
    const result = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`UIA call "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        proc.stdin!.write(JSON.stringify({ id, method, params }) + '\n');
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err as Error);
      }
    });
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  shutdown(): void {
    if (this.proc && this.proc.exitCode === null) {
      try { this.proc.stdin?.end(); } catch { /* ignore */ }
      try { this.proc.kill(); } catch { /* ignore */ }
    }
    this.failAll(new Error('server shutting down'));
    this.proc = null;
    this.ready = false;
  }
}
