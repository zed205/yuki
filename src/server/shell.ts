import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { getConfig } from './config';

/**
 * Shell execution via the latest PowerShell (`pwsh`).
 *
 * The command is passed as a *single argv element* to `pwsh -Command`, so
 * PowerShell is the only thing that parses it. Shell syntax (quotes, `&&`,
 * `|`, `>` …) therefore works with no manual quoting or escaping, and no
 * extra `cmd.exe` layer is involved.
 */

/** Strip ANSI escape sequences (PowerShell emits colour codes even when piped). */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\([B]/g, '');
}

/** Executable + argv used to run a raw command string under PowerShell. */
export function getShellInvocation(command: string): { file: string; args: string[] } {
  const file = getConfig().shell.pwshPath || 'pwsh';
  return { file, args: ['-NoProfile', '-NonInteractive', '-Command', command] };
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** The command's working directory *after* it ran, for durable `cd`. */
  cwd: string;
  /** Set when PowerShell could not be spawned or the command timed out. */
  error?: string;
}

/**
 * Run one command in a fresh `pwsh` process and capture the resulting working
 * directory (so `cd` can be persisted across calls). Fresh processes avoid the
 * lifecycle and line-buffering problems of a long-lived shell.
 */
export function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs = 30000,
): Promise<ShellResult> {
  // Append a probe that prints the final cwd, tagged with a unique marker so
  // it can never be confused with the command's real output.
  const marker = `__YUKI_CWD_${randomUUID()}__`;
  const probe = `${command}\nWrite-Output ("${marker}" + (Get-Location).Path)`;
  const inv = getShellInvocation(probe);

  return new Promise<ShellResult>((resolve) => {
    execFile(
      inv.file,
      inv.args,
      {
        cwd,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      },
      (err, stdoutRaw, stderrRaw) => {
        const exitCode = err ? (typeof err.code === 'number' ? err.code : null) : 0;

        let stdout = stripAnsi(stdoutRaw || '');
        const stderr = stripAnsi(stderrRaw || '');
        let newCwd = cwd;

        // Extract the marker line and remove it from the visible output.
        const idx = stdout.indexOf(marker);
        if (idx >= 0) {
          const nl = stdout.indexOf('\n', idx);
          const line = nl >= 0 ? stdout.slice(idx, nl) : stdout.slice(idx);
          const value = line.slice(marker.length).trim();
          if (value) newCwd = value;
          stdout = stdout.slice(0, idx) + (nl >= 0 ? stdout.slice(nl + 1) : '');
        }

        // Surface spawn failures / timeouts. A plain non-zero exit is reported
        // via `exitCode` (plus stderr), so we deliberately avoid exec's
        // `err.message` there — it would duplicate the command (including the
        // internal cwd probe) into the output.
        let error: string | undefined;
        if (err) {
          if (err.killed) {
            error = `Command timed out after ${timeoutMs}ms`;
          } else if (typeof err.code !== 'number') {
            // Spawn/exec failure, e.g. ENOENT for a missing executable.
            error = err.message;
          }
        }

        resolve({
          stdout: stdout.replace(/\r/g, '').replace(/\s+$/, ''),
          stderr: stderr.replace(/\r/g, '').replace(/\s+$/, ''),
          exitCode,
          cwd: newCwd,
          error,
        });
      },
    );
  });
}
