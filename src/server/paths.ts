/**
 * Centralized per-instance paths.
 *
 * Behaviour is controlled by an optional `paths.json` sitting in the app root
 * (the directory that contains `dist/` when deployed, or the repo root under
 * ts-node). `__dirname/../..` resolves to that root in both cases.
 *
 * With no `paths.json` present the defaults match the historical behaviour
 * exactly: data lives in `~/.config/yukiweb` and the server listens on 3210.
 *
 * Example paths.json (used by the dev instance in the repo):
 *   { "port": 3211, "dataDir": ".yukiweb-dev" }
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const appRoot: string = path.resolve(__dirname, '..', '..');

interface PathOverrides {
  dataDir?: string;
  port?: number;
}

function loadOverrides(): PathOverrides {
  try {
    const p = path.join(appRoot, 'paths.json');
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8')) as PathOverrides;
    }
  } catch (err) {
    console.error('Failed to read paths.json, using defaults:', err);
  }
  return {};
}

const overrides = loadOverrides();

/** Root of this instance's data (config, DB, prompts, sessions, ...). */
export const dataDir: string = path.resolve(
  appRoot,
  overrides.dataDir ?? path.join(os.homedir(), '.config', 'yukiweb'),
);

/** Port this instance listens on. */
export const port: number = overrides.port ?? 3210;

export const sessionsDir: string = path.join(dataDir, 'sessions');
export const attachmentsDir: string = path.join(dataDir, 'attachments');
export const jobsDir: string = path.join(dataDir, 'jobs');
export const logsDir: string = path.join(dataDir, 'logs');
export const plansDir: string = path.join(dataDir, 'plans');
export const projectsDataDir: string = path.join(dataDir, 'projects');
export const timersPath: string = path.join(dataDir, 'timers.json');
