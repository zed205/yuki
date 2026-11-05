import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { normalizeLineEndings } from './utils/line-endings';

interface Skill {
  name: string;
  description: string;
  instructions: string;
}

export function skillList(): string {
  try {
    const db: Database.Database = getDb();
    const rows = db.prepare('SELECT name FROM skills ORDER BY name').all() as { name: string }[];
    if (rows.length === 0) return 'No skills installed.';
    return rows.map(r => r.name).join('\n');
  } catch {
    return 'No skills installed.';
  }
}

export function skillLoad(name: string): string {
  try {
    const db: Database.Database = getDb();
    const row = db.prepare('SELECT * FROM skills WHERE name = ?').get(name) as Skill | undefined;
    if (!row) {
      return `Skill "${name}" not found. Available skills:\n${skillList()}`;
    }
    // Reconstruct the file format for backward compatibility
    return normalizeLineEndings(`# ${row.name}\n\n**Description:** ${row.description}\n\n## Instructions\n\n${row.instructions}\n`);
  } catch {
    return `Skill "${name}" not found. Available skills:\n${skillList()}`;
  }
}

export function skillSave(name: string, description: string, instructions: string): string {
  try {
    const db: Database.Database = getDb();
    db.prepare('INSERT OR REPLACE INTO skills (name, description, instructions) VALUES (?, ?, ?)').run(name, description, instructions);
    return `Saved skill "${name}"`;
  } catch {
    return `Failed to save skill "${name}"`;
  }
}

export function skillDelete(name: string): string {
  try {
    const db: Database.Database = getDb();
    const result = db.prepare('DELETE FROM skills WHERE name = ?').run(name);
    if (result.changes > 0) {
      return `Deleted skill "${name}"`;
    }
    return `Skill "${name}" not found.`;
  } catch {
    return `Skill "${name}" not found.`;
  }
}
