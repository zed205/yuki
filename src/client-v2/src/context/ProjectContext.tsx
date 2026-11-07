import {
  createContext,
  useContext,
  createSignal,
  createEffect,
  type JSX,
} from 'solid-js';
import { useSession, type Project } from './SessionContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectData extends Project {
  sessionCount: number;
}

export interface ProjectContextState {
  projects: ProjectData[];
  currentProjectId: string;
}

// ---------------------------------------------------------------------------
// ProjectContext
// ---------------------------------------------------------------------------

export interface ProjectContextActions {
  addProject: (name: string, path?: string) => Promise<void>;
  removeProject: (projectId: string) => Promise<void>;
  setCurrentProject: (projectId: string) => Promise<void>;
  renameProject: (projectId: string, name: string) => Promise<void>;
  updateProjectPath: (projectId: string, path: string) => Promise<void>;
}

export interface ProjectContextValue extends ProjectContextState, ProjectContextActions {}

const ProjectContext = createContext<ProjectContextValue>();

export function ProjectProvider(props: { children: JSX.Element }) {
  const { tree } = useSession();

  const [projects, setProjects] = createSignal<ProjectData[]>([]);
  const [currentProjectId, setCurrentProjectId] = createSignal('default');

  // Sync projects from session tree
  createEffect(() => {
    const t = tree();
    if (t?.projects) {
      setProjects(
        t.projects.map((p) => ({
          ...p,
          sessionCount: p.sessions.length,
        }))
      );
    }
  });

  // Persist current project to localStorage
  createEffect(() => {
    const id = currentProjectId();
    if (id) {
      localStorage.setItem('yukiweb_current_project', id);
    }
  });

  async function addProject(name: string, path?: string) {
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, path }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to create project: ${res.status}`);
      }
      const data = await res.json();
      setProjects((prev) => [
        ...prev,
        { id: data.projectId, name, path, sessionCount: 0 },
      ]);
    } catch (err) {
      console.error('Failed to add project:', err);
      throw err;
    }
  }

  async function removeProject(projectId: string) {
    if (projectId === 'default') return; // Cannot delete default project

    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to delete project: ${res.status}`);
      }
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      if (currentProjectId() === projectId) {
        setCurrentProjectId('default');
      }
    } catch (err) {
      console.error('Failed to remove project:', err);
      throw err;
    }
  }

  async function setCurrentProject(projectId: string) {
    try {
      setCurrentProjectId(projectId);
      localStorage.setItem('yukiweb_current_project', projectId);

      const res = await fetch('/api/projects/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) {
        setCurrentProjectId(currentProjectId()); // revert
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to switch project: ${res.status}`);
      }
    } catch (err) {
      console.error('Failed to switch project:', err);
      throw err;
    }
  }

  async function renameProject(projectId: string, name: string) {
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to rename project: ${res.status}`);
      }
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, name } : p))
      );
    } catch (err) {
      console.error('Failed to rename project:', err);
      throw err;
    }
  }

  async function updateProjectPath(projectId: string, path: string) {
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to update project path: ${res.status}`);
      }
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, path } : p))
      );
    } catch (err) {
      console.error('Failed to update project path:', err);
      throw err;
    }
  }

  const value: ProjectContextValue = {
    projects,
    currentProjectId,
    addProject,
    removeProject,
    setCurrentProject,
    renameProject,
    updateProjectPath,
  };

  return <ProjectContext.Provider value={value}>{props.children}</ProjectContext.Provider>;
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return ctx;
}
