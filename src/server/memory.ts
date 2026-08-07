import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const memoryPath = path.join(os.homedir(), '.config', 'yukiweb', 'memories.json');

interface MemoryStore {
  [key: string]: string;
}

function loadMemories(): MemoryStore {
  try {
    if (fs.existsSync(memoryPath)) {
      return JSON.parse(fs.readFileSync(memoryPath, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveMemories(data: MemoryStore): void {
  const dir = path.dirname(memoryPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(memoryPath, JSON.stringify(data, null, 2));
}

export function memorySave(key: string, value: string): string {
  const data = loadMemories();
  data[key] = value;
  saveMemories(data);
  return `Saved memory "${key}"`;
}

export function memoryRead(key: string): string {
  const data = loadMemories();
  return data[key] !== undefined ? data[key] : `No memory found for "${key}"`;
}

export function memoryList(): string {
  const data = loadMemories();
  const keys = Object.keys(data);
  if (keys.length === 0) return 'No memories stored.';
  return keys.join('\n');
}

export function memoryDelete(key: string): string {
  const data = loadMemories();
  if (data[key] !== undefined) {
    delete data[key];
    saveMemories(data);
    return `Deleted memory "${key}"`;
  }
  return `No memory found for "${key}"`;
}
