/**
 * SessionSync — Listens to server WebSocket messages and keeps
 * SessionContext and ProjectContext in sync with server state.
 *
 * The server only sends project names on `session:connected`; the full
 * session tree (titles, counts, ordering) comes from GET /api/tree, which
 * we refresh on connect and whenever sessions change.
 */
import { createEffect, onMount } from 'solid-js';
import { useWebSocket } from '../context/WebSocketContext';
import { useSession, type Session } from '../context/SessionContext';
import { useProject, type ProjectData } from '../context/ProjectContext';

interface TreeSession {
  id: string;
  title?: string | null;
  summary?: string | null;
  updatedAt: string;
  messageCount?: number;
  projectId: string;
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

export function SessionSync() {
  const { messageRouter } = useWebSocket();
  const {
    setMessages,
    setSessions,
    setCurrentSessionId,
    setCurrentProjectId,
    setModels,
    setActiveModel,
    setThinkingEnabled,
    setNotificationsEnabled,
    setConfig,
    setVoiceMode,
    setActiveSessionId,
  } = useSession();
  const { setProjects, currentProjectId } = useProject();

  // -------------------------------------------------------------------------
  // Session tree refresh
  // -------------------------------------------------------------------------
  let refreshInFlight = false;
  async function refreshTree() {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      const res = await fetch('/api/tree');
      if (!res.ok) return;
      const data = (await res.json()) as TreeResponse;

      const sessions: Session[] = [];
      const projects: ProjectData[] = [];

      for (const p of data.projects || []) {
        const projectSessions = (p.sessions || []).map((s) => {
          const ts = new Date(s.updatedAt).getTime();
          return {
            id: s.id,
            title: s.title || `${s.messageCount ?? 0} messages`,
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
          sessions: projectSessions.map((s) => s.id),
          sessionCount: projectSessions.length,
        });
      }

      // Newest first
      sessions.sort((a, b) => b.updatedAt - a.updatedAt);

      setSessions(sessions);
      setProjects(projects);
    } catch (err) {
      console.error('[SessionSync] failed to load tree:', err);
    } finally {
      refreshInFlight = false;
    }
  }

  onMount(() => {
    refreshTree();
  });

  createEffect(() => {
    // Session connected (initial connection)
    const unsubConnected = messageRouter.on('session:connected', (data: unknown) => {
      const sd = data as {
        sessionId: string;
        activeProjectId: string;
        thinkingEnabled: boolean;
        voiceMode: boolean;
        projects: Array<{ id: string; name: string }>;
        config: {
          enableImagePaste?: boolean;
          expandThinking?: boolean;
          expandToolOutputs?: boolean;
          collapseThinkingTools?: boolean;
          desktopNotifications?: boolean;
        };
        models: Array<{ name: string; displayName?: string }>;
        activeModel: string;
      };

      if (sd.sessionId) {
        setCurrentSessionId(sd.sessionId);
        setActiveSessionId(sd.sessionId);
      }
      if (sd.activeProjectId) {
        setCurrentProjectId(sd.activeProjectId);
      }
      if (sd.activeModel) {
        setActiveModel(sd.activeModel);
      }
      if (sd.models?.length) {
        setModels(sd.models);
      }
      if (typeof sd.thinkingEnabled === 'boolean') {
        setThinkingEnabled(sd.thinkingEnabled);
      }
      if (typeof sd.voiceMode === 'boolean') {
        setVoiceMode(sd.voiceMode);
      }
      if (sd.config) {
        setConfig({
          enableImagePaste: sd.config.enableImagePaste ?? false,
          expandThinking: sd.config.expandThinking ?? false,
          expandToolOutputs: sd.config.expandToolOutputs ?? false,
          collapseThinkingTools: sd.config.collapseThinkingTools ?? false,
          desktopNotifications: sd.config.desktopNotifications ?? true,
        });
      }

      refreshTree();
    });

    // Session switched
    const unsubSwitched = messageRouter.on('session:switched', (data: unknown) => {
      const sd = data as {
        sessionId: string;
        projectId: string;
        thinkingEnabled?: boolean;
        voiceMode?: boolean;
      };
      if (sd.sessionId) {
        setCurrentSessionId(sd.sessionId);
        setActiveSessionId(sd.sessionId);
        setMessages([]);
      }
      if (sd.projectId) {
        setCurrentProjectId(sd.projectId);
      }
      if (typeof sd.thinkingEnabled === 'boolean') {
        setThinkingEnabled(sd.thinkingEnabled);
      }
      if (typeof sd.voiceMode === 'boolean') {
        setVoiceMode(sd.voiceMode);
      }
    });

    // Project switched
    const unsubProjectSwitched = messageRouter.on('project:switched', (data: unknown) => {
      const pd = data as {
        projectId: string;
        sessionId: string;
        thinkingEnabled?: boolean;
        voiceMode?: boolean;
        projects?: Array<{ id: string; name: string }>;
      };
      if (pd.projectId) {
        setCurrentProjectId(pd.projectId);
      }
      if (pd.sessionId) {
        setCurrentSessionId(pd.sessionId);
        setActiveSessionId(pd.sessionId);
        setMessages([]);
      }
      if (typeof pd.thinkingEnabled === 'boolean') {
        setThinkingEnabled(pd.thinkingEnabled);
      }
      if (typeof pd.voiceMode === 'boolean') {
        setVoiceMode(pd.voiceMode);
      }
      refreshTree();
    });

    // Model switched
    const unsubModelSwitched = messageRouter.on('model:switched', (data: unknown) => {
      const md = data as {
        activeModel: string;
        thinkingEnabled?: boolean;
      };
      if (md.activeModel) {
        setActiveModel(md.activeModel);
      }
      if (typeof md.thinkingEnabled === 'boolean') {
        setThinkingEnabled(md.thinkingEnabled);
      }
    });

    // Thinking toggled
    const unsubThinkingToggled = messageRouter.on('thinking:toggled', (data: unknown) => {
      const td = data as { enabled: boolean };
      if (typeof td.enabled === 'boolean') {
        setThinkingEnabled(td.enabled);
      }
    });

    // Notifications toggled
    const unsubNotifToggled = messageRouter.on('notifications:toggled', (data: unknown) => {
      const nd = data as { enabled: boolean };
      if (typeof nd.enabled === 'boolean') {
        setNotificationsEnabled(nd.enabled);
      }
    });

    // Voice status
    const unsubVoiceStatus = messageRouter.on('voice:status', (data: unknown) => {
      const vd = data as { enabled: boolean };
      if (typeof vd.enabled === 'boolean') {
        setVoiceMode(vd.enabled);
      }
    });

    // Session renamed (manual rename or auto-title after first turn)
    const unsubRenamed = messageRouter.on('session:renamed', () => {
      refreshTree();
    });

    // Session moved between projects
    const unsubMoved = messageRouter.on('session:moved', () => {
      refreshTree();
    });

    // Session cleared
    const unsubCleared = messageRouter.on('session:cleared', () => {
      setMessages([]);
      refreshTree();
    });

    // Session created
    const unsubCreated = messageRouter.on('session:created', (data: unknown) => {
      const cd = data as { sessionId: string; projectId: string };
      if (cd.sessionId) {
        setCurrentSessionId(cd.sessionId);
        setActiveSessionId(cd.sessionId);
      }
      if (cd.projectId) {
        setCurrentProjectId(cd.projectId);
      }
      refreshTree();
    });

    // Session deleted
    const unsubDeleted = messageRouter.on('session:deleted', (data: unknown) => {
      const dd = data as { sessionId: string };
      setSessions((prev) => prev.filter((s) => s.id !== dd.sessionId));
      refreshTree();
    });

    // Turn finished — the server may have auto-generated a title/count
    const unsubChatResponse = messageRouter.on('chat:response', () => {
      refreshTree();
    });

    return () => {
      unsubConnected();
      unsubSwitched();
      unsubProjectSwitched();
      unsubModelSwitched();
      unsubThinkingToggled();
      unsubNotifToggled();
      unsubVoiceStatus();
      unsubRenamed();
      unsubMoved();
      unsubCleared();
      unsubCreated();
      unsubDeleted();
      unsubChatResponse();
    };
  });

  // No rendered output
  return null;
}
