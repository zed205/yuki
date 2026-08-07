import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const skillsDir = path.join(os.homedir(), '.config', 'yukiweb', 'skills');

interface Skill {
  name: string;
  description: string;
  instructions: string;
}

function ensureDir(): void {
  if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });
}

export function skillList(): string {
  ensureDir();
  const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md'));
  if (files.length === 0) return 'No skills installed.';
  return files.map(f => f.replace(/\.md$/, '')).join('\n');
}

export function skillLoad(name: string): string {
  ensureDir();
  const filePath = path.join(skillsDir, `${name}.md`);
  if (!fs.existsSync(filePath)) return `Skill "${name}" not found. Available skills:\n${skillList()}`;
  return fs.readFileSync(filePath, 'utf-8');
}

export function skillSave(name: string, description: string, instructions: string): string {
  ensureDir();
  const content = `# ${name}\n\n**Description:** ${description}\n\n## Instructions\n\n${instructions}\n`;
  fs.writeFileSync(path.join(skillsDir, `${name}.md`), content, 'utf-8');
  return `Saved skill "${name}"`;
}

export function skillDelete(name: string): string {
  ensureDir();
  const filePath = path.join(skillsDir, `${name}.md`);
  if (!fs.existsSync(filePath)) return `Skill "${name}" not found.`;
  fs.unlinkSync(filePath);
  return `Deleted skill "${name}"`;
}
