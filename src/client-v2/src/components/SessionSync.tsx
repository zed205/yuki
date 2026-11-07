/**
 * SessionSync — Listens to server WebSocket messages and updates
 * SessionContext and ProjectContext with real-time data.
 */
import { createEffect } from 'solid-js';
import { useWebSocket } from '../context/WebSocketContext';
import { useSession } from '../context/SessionContext';
import { useProject } from '../context/ProjectContext';

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
  const { setProjects } = useProject();

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
      if (sd.projects?.length) {
        setProjects(sd.projects.map((p) => ({
          id: p.id,
          name: p.name,
          sessionCount: 0,
        })));
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
      setMessages([]);
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
        setMessages([]); // Clear chat on switch
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
        projects: Array<{ id: string; name: string }>;
      };
      if (pd.projectId) {
        setCurrentProjectId(pd.projectId);
      }
      if (pd.sessionId) {
        setCurrentSessionId(pd.sessionId);
        setMessages([]);
      }
      if (pd.projects?.length) {
        setProjects(pd.projects.map((p) => ({
          id: p.id,
          name: p.name,
          sessionCount: 0,
        })));
      }
      if (typeof pd.thinkingEnabled === 'boolean') {
        setThinkingEnabled(pd.thinkingEnabled);
      }
      if (typeof pd.voiceMode === 'boolean') {
        setVoiceMode(pd.voiceMode);
      }
    });

    // Model switched
    const unsubModelSwitched = messageRouter.on('model:switched', (data: unknown) => {
      const md = data as {
        activeModel: string;
        model?: string;
        endpoint?: string;
        contextWindow?: number;
        thinkingEnabled?: boolean;
        preserveThinking?: boolean;
      };
      if (md.activeModel) {
        setActiveModel(md.activeModel);
      }
      if (typeof md.thinkingEnabled === 'boolean') {
        setThinkingEnabled(md.thinkingEnabled);
      }
    });

    // Context update (token usage)
    const unsubContextUpdate = messageRouter.on('context:update', (data: unknown) => {
      const cd = data as { promptTokens: number; maxTokens: number };
      // Token usage is displayed in TopBar via MainLayout
    });

    // Thinking toggled
    const unsubThinkingToggled = messageRouter.on('thinking:toggled', (data: unknown) => {
      const td = data as { enabled: boolean; sessionId?: string };
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
      const vd = data as { enabled: boolean; sessionId?: string };
      if (typeof vd.enabled === 'boolean') {
        setVoiceMode(vd.enabled);
      }
    });

    // Session renamed (manual or auto)
    const unsubRenamed = messageRouter.on('session:renamed', (data: unknown) => {
      const rd = data as { sessionId: string; title: string };
      setSessions((prev) => prev.map((s) =>
        s.id === rd.sessionId ? { ...s, title: rd.title } : s
      ));
    });

    // Session moved (different project)
    const unsubMoved = messageRouter.on('session:moved', (data: unknown) => {
      const md = data as { sessionId: string; projectId: string };
      setSessions((prev) => prev.map((s) =>
        s.id === md.sessionId ? { ...s, projectId: md.projectId } : s
      ));
    });

    // Session cleared
    const unsubCleared = messageRouter.on('session:cleared', () => {
      setMessages([]);
    });

    // Message reverted
    const unsubReverted = messageRouter.on('message:reverted', () => {
      setMessages((prev) => prev.filter(() => true));
    });

    // Session created (new session)
    const unsubCreated = messageRouter.on('session:created', (data: unknown) => {
      const cd = data as { sessionId: string; projectId: string };
      if (cd.sessionId) {
        setCurrentSessionId(cd.sessionId);
        setActiveSessionId(cd.sessionId);
      }
      if (cd.projectId) {
        setCurrentProjectId(cd.projectId);
      }
    });

    // Session deleted
    const unsubDeleted = messageRouter.on('session:deleted', (data: unknown) => {
      const dd = data as { sessionId: string };
      setSessions((prev) => prev.filter((s) => s.id !== dd.sessionId));
    });

    return () => {
      unsubConnected();
      unsubSwitched();
      unsubProjectSwitched();
      unsubModelSwitched();
      unsubContextUpdate();
      unsubThinkingToggled();
      unsubNotifToggled();
      unsubVoiceStatus();
      unsubRenamed();
      unsubMoved();
      unsubCleared();
      unsubReverted();
      unsubCreated();
      unsubDeleted();
    };
  });

  // No rendered output
  return null;
}
