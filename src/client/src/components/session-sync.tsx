'use client';

import { useEffect, useRef } from 'react';
import { useWebSocket } from '@/context/websocket-context';
import { useSession } from '@/context/session-context';
import { useProject, type ProjectData } from '@/context/project-context';
import type { Session } from '@/lib/types';

interface TreeSession {
  id: string;
  title?: string | null;
  summary?: string | null;
  updatedAt: string;
  messageCount?: number;
  projectId?: string;
}

interface TreeProject {
  id: string;
  name: string;
  sessions: TreeSession[];
}

interface TreeResponse {
  projects: TreeProject[];
  activeProjectId?: string;
}

/**
 * Keeps SessionContext and ProjectContext in sync with server state.
 *
 * The server only sends project names on session:connected; the full
 * session tree (titles, counts, ordering) comes from GET /api/tree, which
 * we refresh on connect and whenever sessions change.
 * React port of the SolidJS SessionSync component.
 */
export function SessionSync() {
  const { messageRouter } = useWebSocket();
  const { setSessions } = useSession();
  const { setProjects } = useProject();

  const inFlightRef = useRef(false);

  useEffect(() => {
    const refreshTree = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const res = await fetch('/api/tree');
        if (!res.ok) return;
        const data = (await res.json()) as TreeResponse;

        const sessions: Session[] = [];
        const projects: ProjectData[] = [];

        for (const p of data.projects || []) {
          const projectSessions: Session[] = (p.sessions || []).map((s) => {
            const ts = new Date(s.updatedAt).getTime();
            return {
              id: s.id,
              title: s.title || `${s.messageCount ?? 0} messages`,
              summary: s.summary || undefined,
              messageCount: s.messageCount ?? 0,
              projectId: s.projectId || p.id,
              messages: [],
              createdAt: ts,
              updatedAt: ts,
            } as Session;
          });
          sessions.push(...projectSessions);
          projects.push({
            id: p.id,
            name: p.name,
            path: '',
            sessions: projectSessions.map((s) => s.id),
            sessionCount: projectSessions.length,
          });
        }

        // Newest first
        sessions.sort((a, b) => {
          const aT = typeof a.updatedAt === 'number' ? a.updatedAt : 0;
          const bT = typeof b.updatedAt === 'number' ? b.updatedAt : 0;
          return bT - aT;
        });

        setSessions(sessions);
        setProjects(projects);
      } catch (err) {
        console.error('[SessionSync] failed to load tree:', err);
      } finally {
        inFlightRef.current = false;
      }
    };

    void refreshTree();

    const unsubs: Array<() => void> = [];
    const on = messageRouter.on;
    // Refresh the tree whenever the session/project structure changes
    const TREE_EVENTS = [
      'session:connected',
      'session:renamed',
      'session:moved',
      'session:cleared',
      'session:created',
      'session:deleted',
      'session:forked',
      'project:switched',
      'chat:response',
    ];
    for (const type of TREE_EVENTS) {
      unsubs.push(on(type, () => void refreshTree()));
    }

    // Local refresh requests (e.g. after a project reorder via DnD).
    const onLocal = () => void refreshTree();
    window.addEventListener('yukiweb:refresh-tree', onLocal);

    return () => {
      unsubs.forEach((u) => u());
      window.removeEventListener('yukiweb:refresh-tree', onLocal);
    };
  }, [messageRouter, setSessions, setProjects]);

  return null;
}
