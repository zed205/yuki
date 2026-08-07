import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Project } from '../shared/types';

const configDir = path.join(os.homedir(), '.config', 'yukiweb', 'projects');
const projectsFilePath = path.join(configDir, 'projects.json');
const projectsRoot = path.join(__dirname, '..', '..', 'Projects');

let projects: Project[] = [];

function ensureConfigDir(): void {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

function save(): void {
  ensureConfigDir();
  const serialized = projects.map(p => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));
  fs.writeFileSync(projectsFilePath, JSON.stringify(serialized, null, 2));
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'project';
}

export function loadProjects(): void {
  ensureConfigDir();
  if (fs.existsSync(projectsFilePath)) {
    try {
      const raw = fs.readFileSync(projectsFilePath, 'utf-8');
      projects = JSON.parse(raw).map((p: any) => ({
        ...p,
        createdAt: new Date(p.createdAt),
        updatedAt: new Date(p.updatedAt),
      }));
    } catch (err) {
      console.error('Failed to load projects:', err);
      projects = [];
    }
  }

  // Migrate old relative paths to absolute
  let migrated = false;
  for (const p of projects) {
    if (!path.isAbsolute(p.path)) {
      const slug = p.id === 'default' ? 'Default' : (slugify(p.name) || p.path);
      p.path = path.join(projectsRoot, slug);
      if (!fs.existsSync(p.path)) {
        fs.mkdirSync(p.path, { recursive: true });
      }
      migrated = true;
    }
  }
  if (migrated) save();

  if (projects.length === 0) {
    const defaultDir = path.join(projectsRoot, 'Default');
    if (!fs.existsSync(defaultDir)) {
      fs.mkdirSync(defaultDir, { recursive: true });
    }
    projects.push({
      id: 'default',
      name: 'Default',
      path: defaultDir,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    save();
  }
}

export function getProjects(): Project[] {
  return projects;
}

export function getProject(id: string): Project | undefined {
  return projects.find(p => p.id === id);
}

export function createProject(name: string): Project {
  const slug = slugify(name);
  const dir = path.join(projectsRoot, slug);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const project: Project = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    path: dir,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  projects.push(project);
  save();
  return project;
}

export function renameProject(id: string, name: string): Project | undefined {
  const project = projects.find(p => p.id === id);
  if (!project) return undefined;
  project.name = name;
  project.updatedAt = new Date();
  save();
  return project;
}

export function deleteProject(id: string): boolean {
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1 || projects[idx].id === 'default') return false;
  projects.splice(idx, 1);
  save();
  return true;
}

export function reorderProjects(ids: string[]): boolean {
  const known = ids
    .filter(id => id !== 'default')
    .map(id => projects.find(p => p.id === id))
    .filter((p): p is Project => !!p);
  const unknown = projects.filter(p => p.id !== 'default' && !known.includes(p));
  const reordered = [...known, ...unknown];
  const defaultProject = projects.find(p => p.id === 'default');
  projects = defaultProject ? [defaultProject, ...reordered] : reordered;
  save();
  return true;
}
