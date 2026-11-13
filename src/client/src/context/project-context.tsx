'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Project } from '@/lib/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectData extends Project {
  sessionCount?: number;
}

export interface ProjectContextValue {
  projects: ProjectData[];
  currentProjectId: string;
  addProject: (name: string, path?: string) => Promise<void>;
  removeProject: (projectId: string) => Promise<void>;
  setCurrentProject: (projectId: string) => Promise<void>;
  renameProject: (projectId: string, name: string) => Promise<void>;
  updateProjectPath: (projectId: string, path: string) => Promise<void>;
  setProjects: React.Dispatch<React.SetStateAction<ProjectData[]>>;
  refresh: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const STORAGE_KEY = 'yukiweb_current_project';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState('default');

  // Persist current project
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, currentProjectId);
    } catch {
      /* ignore */
    }
  }, [currentProjectId]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) return;
      const data = (await res.json()) as Project[] | { projects: Project[] };
      const list = Array.isArray(data) ? data : data.projects ?? [];
      setProjects(list);
      // Restore persisted selection if it still exists
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && list.some((p) => p.id === saved)) {
          setCurrentProjectId(saved);
        }
      } catch {
        /* ignore */
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  const addProject = useCallback(
    async (name: string, path?: string) => {
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
        await refresh();
      } catch (err) {
        console.error('Failed to add project:', err);
        throw err;
      }
    },
    [refresh],
  );

  const removeProject = useCallback(
    async (projectId: string) => {
      if (projectId === 'default') return;
      try {
        const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Failed to delete project: ${res.status}`);
        }
        setProjects((prev) => prev.filter((p) => p.id !== projectId));
        if (currentProjectId === projectId) setCurrentProjectId('default');
      } catch (err) {
        console.error('Failed to remove project:', err);
        throw err;
      }
    },
    [currentProjectId],
  );

  const setCurrentProject = useCallback(async (projectId: string) => {
    setCurrentProjectId(projectId);
    try {
      const res = await fetch('/api/projects/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to switch project: ${res.status}`);
      }
    } catch (err) {
      console.error('Failed to switch project:', err);
      throw err;
    }
  }, []);

  const renameProject = useCallback(
    async (projectId: string, name: string) => {
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
          prev.map((p) => (p.id === projectId ? { ...p, name } : p)),
        );
      } catch (err) {
        console.error('Failed to rename project:', err);
        throw err;
      }
    },
    [],
  );

  const updateProjectPath = useCallback(
    async (projectId: string, path: string) => {
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
          prev.map((p) => (p.id === projectId ? { ...p, path } : p)),
        );
      } catch (err) {
        console.error('Failed to update project path:', err);
        throw err;
      }
    },
    [],
  );

  const value = useMemo<ProjectContextValue>(
    () => ({
      projects,
      currentProjectId,
      addProject,
      removeProject,
      setCurrentProject,
      renameProject,
      updateProjectPath,
      setProjects,
      refresh,
    }),
    [
      projects,
      currentProjectId,
      addProject,
      removeProject,
      setCurrentProject,
      renameProject,
      updateProjectPath,
      refresh,
    ],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used within a ProjectProvider');
  return ctx;
}
