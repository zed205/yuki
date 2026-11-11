'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useWebSocket } from './websocket-context';
import type { Message, ModelInfo, Session, ToolCallEntry } from '@/lib/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionConfig {
  contextWindow: number;
  enableImagePaste: boolean;
  expandThinking?: boolean;
  expandToolOutputs?: boolean;
  collapseThinkingTools?: boolean;
  desktopNotifications?: boolean;
  voiceMode?: boolean;
  thinkingEnabled?: boolean;
  toolsEnabled?: boolean;
  compactMode?: boolean;
}

export interface SessionContextValue {
  // Messages
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;

  // Streaming state
  isWaiting: boolean;
  setIsWaiting: (v: boolean) => void;
  isStreaming: boolean;
  setIsStreaming: (v: boolean) => void;

  // Agent settings
  thinkingEnabled: boolean;
  setThinkingEnabled: (v: boolean) => void;
  compactMode: boolean;
  setCompactMode: (v: boolean) => void;
  notificationsEnabled: boolean;
  setNotificationsEnabled: (v: boolean) => void;

  // Model
  activeModel: string;
  setActiveModel: (v: string) => void;
  models: ModelInfo[];
  setModels: (v: ModelInfo[] | ((prev: ModelInfo[]) => ModelInfo[])) => void;

  // Session management
  config: SessionConfig;
  setConfig: (v: Partial<SessionConfig>) => void;
  currentSessionId: string | null;
  setCurrentSessionId: (v: string | null) => void;
  currentProjectId: string;
  setCurrentProjectId: (v: string) => void;
  activeSessionId: string | null;
  setActiveSessionId: (v: string | null) => void;

  // Session list
  sessions: Session[];
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;

  // Audio
  voiceMode: boolean;
  setVoiceMode: (v: boolean) => void;

  // Context window tracking
  promptTokens: number;
  maxTokens: number;

  // Actions (WS-backed)
  sendMessage: (text: string) => boolean;
  stopResponse: () => void;
  switchSession: (sessionId: string, projectId?: string) => void;
  createSession: () => void;
  deleteSession: (sessionId: string) => void;
  renameSession: (sessionId: string, title: string) => void;
  switchModel: (modelName: string) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function SessionProvider({ children }: { children: ReactNode }) {
  const { send, messageRouter } = useWebSocket();

  const [messages, setMessages] = useState<Message[]>([]);
  const [isWaiting, setIsWaiting] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [compactMode, setCompactMode] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [activeModel, setActiveModel] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [config, setConfigState] = useState<SessionConfig>({
    contextWindow: 64000,
    enableImagePaste: false,
  });
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [currentProjectId, setCurrentProjectId] = useState('default');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [voiceMode, setVoiceMode] = useState(false);
  const [promptTokens, setPromptTokens] = useState(0);
  const [maxTokens, setMaxTokens] = useState(64000);

  const setConfig = useCallback((v: Partial<SessionConfig>) => {
    setConfigState((prev) => ({ ...prev, ...v }));
  }, []);

  // Track id of the assistant message being streamed (for chat:chunk)
  const streamingIdRef = useRef<string | null>(null);
  // Pending chunk buffer for rAF-batched appends
  const pendingChunkRef = useRef<string>('');
  const chunkFlushScheduled = useRef(false);
  // Monotonic token so a slow fetch can't overwrite a newer session's history
  const loadSeqRef = useRef(0);

  // Load a session's transcript from the REST API (the server only sends
  // session metadata over WS, so the transcript itself comes from here).
  const loadSession = useCallback(async (sessionId: string) => {
    if (!sessionId) return;
    const seq = ++loadSeqRef.current;
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        messages?: Array<Partial<Message> & { role: string }>;
      };
      if (seq !== loadSeqRef.current) return;

      const history = (data.messages || [])
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m, i) => ({
          id: m.id || `hist-${i}`,
          role: (m.role === 'user' ? 'user' : 'assistant') as Message['role'],
          content: m.content || '',
          timestamp: m.timestamp ? new Date(m.timestamp as never) : new Date(),
          toolCalls: m.toolCalls as Message['toolCalls'],
          reasoningContent: m.reasoningContent as string | undefined,
          images: m.images as string[] | undefined,
          attachments: m.attachments as Message['attachments'],
          compacted: m.compacted as boolean | undefined,
          isStreaming: false,
        }));

      streamingIdRef.current = null;
      pendingChunkRef.current = '';
      setIsStreaming(false);
      setMessages(history);
    } catch (err) {
      console.error('[SessionContext] failed to load session', sessionId, err);
    }
  }, []);

  // -----------------------------------------------------------------
  // WebSocket wiring (server → client)
  // -----------------------------------------------------------------
  useEffect(() => {
    const unsubs: Array<() => void> = [];
    const on = messageRouter.on;

    unsubs.push(
      on('session:connected', (data) => {
        const sd = data as {
          sessionId?: string;
          activeProjectId?: string;
          thinkingEnabled?: boolean;
          voiceMode?: boolean;
          config?: Record<string, unknown>;
          models?: Array<{ name: string; displayName?: string }>;
          activeModel?: string;
        };
        if (sd.models?.length) setModels(sd.models);
        if (sd.activeModel) setActiveModel(sd.activeModel);
        if (sd.sessionId) {
          setCurrentSessionId(sd.sessionId);
          setActiveSessionId(sd.sessionId);
          void loadSession(sd.sessionId);
        }
        if (sd.activeProjectId) setCurrentProjectId(sd.activeProjectId);
        if (typeof sd.thinkingEnabled === 'boolean')
          setThinkingEnabled(sd.thinkingEnabled);
        if (typeof sd.voiceMode === 'boolean') setVoiceMode(sd.voiceMode);
        if (sd.config) {
          setConfig({
            enableImagePaste: (sd.config.enableImagePaste as boolean) ?? false,
            expandThinking: (sd.config.expandThinking as boolean) ?? false,
            expandToolOutputs:
              (sd.config.expandToolOutputs as boolean) ?? false,
            collapseThinkingTools:
              (sd.config.collapseThinkingTools as boolean) ?? false,
            desktopNotifications:
              (sd.config.desktopNotifications as boolean) ?? true,
          });
        }
      }),
    );

    unsubs.push(
      on('session:switched', (data) => {
        const sd = data as {
          sessionId?: string;
          projectId?: string;
          thinkingEnabled?: boolean;
          voiceMode?: boolean;
        };
        if (sd.sessionId) {
          setCurrentSessionId(sd.sessionId);
          setActiveSessionId(sd.sessionId);
          void loadSession(sd.sessionId);
        }
        if (sd.projectId) setCurrentProjectId(sd.projectId);
        if (typeof sd.thinkingEnabled === 'boolean')
          setThinkingEnabled(sd.thinkingEnabled);
        if (typeof sd.voiceMode === 'boolean') setVoiceMode(sd.voiceMode);
      }),
    );

    unsubs.push(
      on('project:switched', (data) => {
        const pd = data as {
          projectId?: string;
          sessionId?: string;
          thinkingEnabled?: boolean;
          voiceMode?: boolean;
        };
        if (pd.projectId) setCurrentProjectId(pd.projectId);
        if (pd.sessionId) {
          setCurrentSessionId(pd.sessionId);
          setActiveSessionId(pd.sessionId);
          void loadSession(pd.sessionId);
        }
        if (typeof pd.thinkingEnabled === 'boolean')
          setThinkingEnabled(pd.thinkingEnabled);
        if (typeof pd.voiceMode === 'boolean') setVoiceMode(pd.voiceMode);
      }),
    );

    unsubs.push(
      on('model:switched', (data) => {
        const md = data as {
          activeModel?: string;
          contextWindow?: number;
          thinkingEnabled?: boolean;
        };
        if (md.activeModel) setActiveModel(md.activeModel);
        if (md.contextWindow) setMaxTokens(md.contextWindow);
        if (typeof md.thinkingEnabled === 'boolean')
          setThinkingEnabled(md.thinkingEnabled);
      }),
    );

    unsubs.push(
      on('models:updated', (data) => {
        const md = data as {
          models?: Array<{ name: string; displayName?: string }>;
        };
        if (md.models?.length) setModels(md.models);
      }),
    );

    unsubs.push(
      on('context:update', (data) => {
        const cd = data as { promptTokens?: number; maxTokens?: number };
        if (cd.promptTokens !== undefined) setPromptTokens(cd.promptTokens);
        if (cd.maxTokens !== undefined) setMaxTokens(cd.maxTokens);
      }),
    );

    unsubs.push(
      on('thinking:toggled', (data) => {
        const td = data as { enabled?: boolean };
        if (typeof td.enabled === 'boolean') setThinkingEnabled(td.enabled);
      }),
    );

    unsubs.push(
      on('notifications:toggled', (data) => {
        const nd = data as { enabled?: boolean };
        if (typeof nd.enabled === 'boolean')
          setNotificationsEnabled(nd.enabled);
      }),
    );

    unsubs.push(
      on('voice:status', (data) => {
        const vd = data as { enabled?: boolean };
        if (typeof vd.enabled === 'boolean') setVoiceMode(vd.enabled);
      }),
    );

    // --- Session lifecycle ---

    unsubs.push(
      on('session:created', (data) => {
        const sd = data as {
          sessionId: string;
          title?: string;
          projectId?: string;
        };
        const newSession: Session = {
          id: sd.sessionId,
          messages: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          title: sd.title || 'New session',
          projectId: sd.projectId || 'default',
        };
        setSessions((prev) => [newSession, ...prev.filter((s) => s.id !== sd.sessionId)]);
      }),
    );

    unsubs.push(
      on('session:deleted', (data) => {
        const sd = data as { sessionId?: string; sessionIds?: string[] };
        const ids = new Set(
          sd.sessionIds ?? (sd.sessionId ? [sd.sessionId] : []),
        );
        if (ids.size === 0) return;
        setSessions((prev) => prev.filter((s) => !ids.has(s.id)));
      }),
    );

    unsubs.push(
      on('session:cleared', () => {
        streamingIdRef.current = null;
        pendingChunkRef.current = '';
        setMessages([]);
      }),
    );

    unsubs.push(
      on('session:renamed', (data) => {
        const rd = data as { sessionId?: string; title?: string };
        if (!rd.sessionId) return;
        setSessions((prev) =>
          prev.map((s) =>
            s.id === rd.sessionId ? { ...s, title: rd.title } : s,
          ),
        );
      }),
    );

    unsubs.push(
      on('session:summary', (data) => {
        const rd = data as { sessionId?: string; summary?: string };
        if (!rd.sessionId) return;
        setSessions((prev) =>
          prev.map((s) =>
            s.id === rd.sessionId ? { ...s, summary: rd.summary } : s,
          ),
        );
      }),
    );

    unsubs.push(
      on('session:moved', (data) => {
        const md = data as { sessionId?: string; projectId?: string };
        if (!md.sessionId) return;
        setSessions((prev) =>
          prev.map((s) =>
            s.id === md.sessionId ? { ...s, projectId: md.projectId } : s,
          ),
        );
      }),
    );

    unsubs.push(
      on('session:forked', (data) => {
        const fd = data as {
          sessionId?: string;
          title?: string;
          projectId?: string;
        };
        if (!fd.sessionId) return;
        const fork: Session = {
          id: fd.sessionId,
          messages: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          title: fd.title || 'Fork',
          projectId: fd.projectId || 'default',
        };
        setSessions((prev) => [fork, ...prev]);
      }),
    );

    // --- Chat ---

    unsubs.push(
      on('chat:message', (data) => {
        const cd = data as {
          message?: string;
          messageId?: string;
          sessionId?: string;
          steer?: boolean;
        };
        if (!cd.message) return;
        const userMsg: Message = {
          id: cd.messageId || `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'user',
          content: cd.message,
          timestamp: new Date(),
          sessionId: cd.sessionId,
        };
        setMessages((prev) => [...prev, userMsg]);
        setIsWaiting(true);
      }),
    );

    unsubs.push(
      on('chat:chunk', (data) => {
        const cd = data as {
          chunk?: string;
          messageId?: string;
          reasoning?: string;
        };
        const id = cd.messageId || streamingIdRef.current;
        if (!cd.chunk) return;
        streamingIdRef.current = id;
        // Batch appends to reduce re-renders during fast streams
        pendingChunkRef.current += cd.chunk;
        if (chunkFlushScheduled.current) return;
        chunkFlushScheduled.current = true;
        requestAnimationFrame(() => {
          chunkFlushScheduled.current = false;
          const chunk = pendingChunkRef.current;
          pendingChunkRef.current = '';
          if (!chunk) return;
          setIsStreaming(true);
          setIsWaiting(false);
          const targetId = streamingIdRef.current;
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === targetId);
            if (idx === -1) {
              return [
                ...prev,
                {
                  id: targetId!,
                  role: 'assistant' as const,
                  content: chunk,
                  timestamp: new Date(),
                  isStreaming: true,
                },
              ];
            }
            const next = [...prev];
            next[idx] = {
              ...next[idx],
              content: (next[idx].content || '') + chunk,
              isStreaming: true,
            };
            return next;
          });
        });
      }),
    );

    unsubs.push(
      on('chat:response', (data) => {
        const rd = data as {
          message?: string;
          toolCalls?: Message['toolCalls'];
          messageId?: string;
        };
        setIsStreaming(false);
        setIsWaiting(false);
        pendingChunkRef.current = '';
        if (!rd.message && !rd.toolCalls?.length) {
          streamingIdRef.current = null;
          return;
        }
        const id = rd.messageId || streamingIdRef.current || `asst-${Date.now()}`;
        streamingIdRef.current = null;
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === id);
          const doneMsg: Message = {
            id,
            role: 'assistant',
            content: rd.message ?? '',
            timestamp: new Date(),
            toolCalls: rd.toolCalls as Message['toolCalls'],
            isStreaming: false,
          };
          if (idx === -1) return [...prev, doneMsg];
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            ...doneMsg,
            content: rd.message ?? next[idx].content,
          };
          return next;
        });
      }),
    );

    unsubs.push(
      on('chat:stopped', () => {
        setIsStreaming(false);
        setIsWaiting(false);
        pendingChunkRef.current = '';
        streamingIdRef.current = null;
        setMessages((prev) =>
          prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)),
        );
      }),
    );

    // --- Tool events ---

    unsubs.push(
      on('tool:call', (data) => {
        const td = data as {
          toolCall?: {
            id: string;
            name: string;
            arguments?: Record<string, unknown>;
            parameters?: Record<string, unknown>;
            status?: string;
          };
        };
        const tc = td.toolCall;
        if (!tc?.id) return;
        setMessages((prev) => {
          const idx = prev.findIndex(
            (m) => m.role === 'assistant' && (m.isStreaming || m.id === streamingIdRef.current),
          );
          if (idx === -1) return prev;
          const status: ToolCallEntry['status'] =
            tc.status === 'error' ? 'error'
            : tc.status === 'running' ? 'running'
            : tc.status === 'completed' ? 'completed'
            : 'pending';
          const parameters = tc.arguments ?? tc.parameters ?? {};
          const existing = prev[idx].toolCalls || [];
          const existingIdx = existing.findIndex((t) => t.id === tc.id);
          const next = [...prev];
          if (existingIdx >= 0) {
            next[idx] = {
              ...next[idx],
              toolCalls: existing.map((t, i) =>
                i === existingIdx
                  ? { ...t, status, parameters: parameters }
                  : t,
              ),
            };
          } else {
            next[idx] = {
              ...next[idx],
              toolCalls: [
                ...existing,
                { id: tc.id, name: tc.name, parameters, status },
              ],
            };
          }
          return next;
        });
      }),
    );

    unsubs.push(
      on('tool:result', (data) => {
        const td = data as { toolCallId?: string; result?: string; status?: string };
        if (!td.toolCallId) return;
        const status: ToolCallEntry['status'] = td.status === 'error' ? 'error' : 'completed';
        setMessages((prev) =>
          prev.map((m) => {
            if (!m.toolCalls?.length) return m;
            return {
              ...m,
              toolCalls: m.toolCalls.map((t) =>
                t.id === td.toolCallId
                  ? { ...t, result: td.result, status }
                  : t,
              ),
            };
          }),
        );
      }),
    );

    // --- Thinking (reasoning) stream ---

    unsubs.push(
      on('thinking:chunk', (data) => {
        const td = data as { chunk?: string; messageId?: string };
        if (!td.chunk) return;
        const id = td.messageId || streamingIdRef.current;
        if (!id) return;
        streamingIdRef.current = id;
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === id);
          if (idx === -1) {
            return [
              ...prev,
              {
                id,
                role: 'assistant' as const,
                content: '',
                timestamp: new Date(),
                reasoningContent: td.chunk,
                isStreaming: true,
              },
            ];
          }
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            reasoningContent: (next[idx].reasoningContent || '') + td.chunk!,
            isStreaming: true,
          };
          return next;
        });
      }),
    );

    unsubs.push(
      on('message:reverted', (data) => {
        const rd = data as { messageId?: string; text?: string };
        if (rd.messageId) {
          setMessages((prev) => prev.filter((m) => m.id !== rd.messageId));
        }
      }),
    );

    return () => unsubs.forEach((u) => u());
  }, [messageRouter, setConfig, loadSession]);

  // -----------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------

  const sendMessage = useCallback(
    (text: string): boolean => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      return send('chat:message', { message: trimmed });
    },
    [send],
  );

  const stopResponse = useCallback(() => {
    send('chat:stop', {});
  }, [send]);

  const switchSession = useCallback(
    (sessionId: string, projectId?: string) => {
      send('session:switch', { sessionId, projectId });
    },
    [send],
  );

  const createSession = useCallback(() => {
    send('session:create', {});
  }, [send]);

  const deleteSession = useCallback(
    (sessionId: string) => {
      send('session:delete', { sessionId });
    },
    [send],
  );

  const renameSession = useCallback(
    (sessionId: string, title: string) => {
      send('session:rename', { sessionId, title });
    },
    [send],
  );

  const switchModel = useCallback(
    (modelName: string) => {
      send('model:switch', { modelName });
    },
    [send],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      messages,
      setMessages,
      isWaiting,
      setIsWaiting,
      isStreaming,
      setIsStreaming,
      thinkingEnabled,
      setThinkingEnabled,
      compactMode,
      setCompactMode,
      notificationsEnabled,
      setNotificationsEnabled,
      activeModel,
      setActiveModel,
      models,
      setModels,
      config,
      setConfig,
      currentSessionId,
      setCurrentSessionId,
      currentProjectId,
      setCurrentProjectId,
      activeSessionId,
      setActiveSessionId,
      sessions,
      setSessions,
      voiceMode,
      setVoiceMode,
      promptTokens,
      maxTokens,
      sendMessage,
      stopResponse,
      switchSession,
      createSession,
      deleteSession,
      renameSession,
      switchModel,
    }),
    [
      messages, isWaiting, isStreaming, thinkingEnabled, compactMode,
      notificationsEnabled, activeModel, models, config, currentSessionId,
      currentProjectId, activeSessionId, sessions, voiceMode, promptTokens,
      maxTokens, setConfig, sendMessage, stopResponse, switchSession,
      createSession, deleteSession, renameSession, switchModel,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
