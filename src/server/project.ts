import * as fs from 'fs';
import * as path from 'path';
import type Database from 'better-sqlite3';
import { Project } from '../shared/types';
import { getDb } from '../db';
import { dataDir, projectsDataDir, appRoot } from './paths';

const configDir = projectsDataDir;

/**
 * Folder where projects land when no explicit path is given (e.g. auto-created
 * projects such as "Voice"). Lives inside this instance's data dir so dev and
 * live instances don't collide.
 */
function defaultProjectDir(name: string): string {
  return path.join(projectsDataDir, slugify(name));
}

function ensureConfigDir(): void {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

/**
 * Validate a user-supplied project folder. Must be an absolute path outside
 * of this instance's data dir and install root (project folders are real
 * user files, not app data).
 */
function validateProjectFolder(folder: string): string {
  const resolved = path.resolve(folder);
  if (!path.isAbsolute(resolved)) {
    throw new Error('Project folder must be an absolute path');
  }
  const insideDataDir = resolved === dataDir || resolved.startsWith(dataDir + path.sep);
  const insideAppRoot = resolved === appRoot || resolved.startsWith(appRoot + path.sep);
  if (insideDataDir || insideAppRoot) {
    throw new Error('Project folder must be outside the YukiWeb data and install directories');
  }
  return resolved;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'project';
}

function toProject(row: { id: string; name: string; path: string; created_at: number; updated_at: number }): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function loadProjects(): void {
  ensureConfigDir();
  const db: Database.Database = getDb();

  // Check if table is empty (first load)
  const count = db.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number };
  if (Number(count.count) === 0) {
    // Seed default project
    const defaultDir = path.join(projectsDataDir, 'Default');
    if (!fs.existsSync(defaultDir)) {
      fs.mkdirSync(defaultDir, { recursive: true });
    }
    const now = Date.now();
    db.prepare(
      'INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run('default', 'Default', defaultDir, now, now);
    return;
  }

  // Migrate old relative paths to absolute
  const rows = db.prepare('SELECT * FROM projects').all() as { id: string; name: string; path: string; created_at: number; updated_at: number }[];
  let migrated = false;
  for (const row of rows) {
    if (!path.isAbsolute(row.path)) {
      const slug = row.id === 'default' ? 'Default' : (slugify(row.name) || row.path);
      row.path = path.join(projectsDataDir, slug);
      if (!fs.existsSync(row.path)) {
        fs.mkdirSync(row.path, { recursive: true });
      }
      migrated = true;
      db.prepare('UPDATE projects SET path = ? WHERE id = ?').run(row.path, row.id);
    }
  }
  if (migrated) {
    // Re-read after migration
    loadProjects();
  }
}

export function getProjects(): Project[] {
  const db: Database.Database = getDb();
  const rows = db.prepare('SELECT * FROM projects').all() as { id: string; name: string; path: string; created_at: number; updated_at: number }[];
  return rows.map(toProject);
}

export function getProject(id: string): Project | undefined {
  const db: Database.Database = getDb();
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as { id: string; name: string; path: string; created_at: number; updated_at: number } | undefined;
  return row ? toProject(row) : undefined;
}

export function createProject(name: string, folderPath?: string): Project {
  const dir = folderPath
    ? validateProjectFolder(folderPath)
    : defaultProjectDir(name);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const now = Date.now();
  const db: Database.Database = getDb();
  db.prepare(
    'INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, name, dir, now, now);

  return toProject({ id, name, path: dir, created_at: now, updated_at: now });
}

export function renameProject(id: string, name: string): Project | undefined {
  const db: Database.Database = getDb();
  const now = Date.now();
  db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(name, now, id);

  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as { id: string; name: string; path: string; created_at: number; updated_at: number } | undefined;
  return row ? toProject(row) : undefined;
}

export function deleteProject(id: string): boolean {
  if (id === 'default') return false;

  const db: Database.Database = getDb();
  const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  return result.changes > 0;
}

export function reorderProjects(ids: string[]): boolean {
  const db: Database.Database = getDb();

  const known = ids
    .filter(id => id !== 'default')
    .map(id => db.prepare('SELECT * FROM projects WHERE id = ?').get(id))
    .filter((r): r is { id: string; name: string; path: string; created_at: number; updated_at: number } => !!r);

  const knownIds = new Set(ids.filter(id => id !== 'default'));
  const unknownRows = db.prepare('SELECT * FROM projects WHERE id NOT IN (' + known.map(() => '?').join(',') + ')').all(...knownIds.size ? [...knownIds] : []) as { id: string; name: string; path: string; created_at: number; updated_at: number }[];

  const defaultProject = db.prepare('SELECT * FROM projects WHERE id = ?').get('default') as { id: string; name: string; path: string; created_at: number; updated_at: number } | undefined;

  // Start a transaction for atomic updates
  const trx = db.transaction(() => {
    // Reset all order (we use the row's natural order from the query)
    // Since we don't have an explicit order column, we rely on the sequence returned
    // Re-insert projects in the desired order
    const allProjects = [...known, ...unknownRows];
    // Delete all non-default projects
    if (knownIds.size > 0) {
      db.prepare('DELETE FROM projects WHERE id IN (' + known.map(() => '?').join(',') + ')').run(...known.map(p => p.id));
    }
    // Re-insert in new order
    for (const p of allProjects) {
      db.prepare(
        'INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(p.id, p.name, p.path, p.created_at, p.updated_at);
    }
  });
  trx();

  return true;
}
