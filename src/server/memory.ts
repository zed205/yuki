import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { normalizeLineEndings } from './utils/line-endings';

export function memorySave(key: string, value: string): string {
  try {
    const db: Database.Database = getDb();
    db.prepare('INSERT OR REPLACE INTO memories (key, value) VALUES (?, ?)').run(key, value);
    return `Saved memory "${key}"`;
  } catch {
    return `Failed to save memory "${key}"`;
  }
}

export function memoryRead(key: string): string {
  try {
    const db: Database.Database = getDb();
    const row = db.prepare('SELECT value FROM memories WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? row.value : `No memory found for "${key}"`;
  } catch {
    return `No memory found for "${key}"`;
  }
}

export function memoryList(): string {
  try {
    const db: Database.Database = getDb();
    const rows = db.prepare('SELECT key FROM memories ORDER BY key').all() as { key: string }[];
    if (rows.length === 0) return 'No memories stored.';
    return rows.map(r => r.key).join('\n');
  } catch {
    return 'No memories stored.';
  }
}

export function memoryDelete(key: string): string {
  try {
    const db: Database.Database = getDb();
    const row = db.prepare('SELECT value FROM memories WHERE key = ?').get(key) as { value: string } | undefined;
    if (row) {
      db.prepare('DELETE FROM memories WHERE key = ?').run(key);
      return `Deleted memory "${key}"`;
    }
    return `No memory found for "${key}"`;
  } catch {
    return `No memory found for "${key}"`;
  }
}
