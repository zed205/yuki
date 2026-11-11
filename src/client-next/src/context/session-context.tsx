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
import { useToaster } from '@/components/toast/toaster-provider';
import type {
  Message,
  MCPServerStatus,
  ModelInfo,
  ObserverFeedback,
  Plan,
  PlanStep,
  Session,
  StructuredModel,
  SubAgentInfo,
  ToolCallEntry,
  ToolInfo,
} from '@/lib/types';

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
  /** Underlying model string (server config), for the utility summary. */
  model?: string;
  /** Endpoint URL, for the utility summary. */
  endpoint?: string;
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

  // Tools / MCP / Plan / Sub-agents
  tools: ToolInfo[];
  mcpServers: MCPServerStatus[];
  plan: Plan | null;
  subagents: SubAgentInfo[];

  // Structured models (cards + variants) for the models modal
  structuredModels: StructuredModel[];

  // Sub-agent capacity reported by the server (subagent:list slots).
  subAgentSlots: number;

  // Compaction indicator state (Ready / Busy / Done / Failed)
  compactState: 'ready' | 'busy' | 'done' | 'failed';

  // When the server reverts a message it echoes the text back; the composer
  // refills its input from this (nonce-bumped so repeats re-trigger).
  revertFill: { text: string; nonce: number } | null;

  // Actions (WS-backed)
  sendMessage: (text: string) => boolean;
  stopResponse: () => void;
  switchSession: (sessionId: string, projectId?: string) => void;
  createSession: () => void;
  deleteSession: (sessionId: string) => void;
  renameSession: (sessionId: string, title: string) => void;
  switchModel: (modelName: string) => void;
  forkSession: (sessionId: string, messageIndex: number) => void;
  moveSession: (sessionId: string, projectId: string) => void;
  compactContext: () => void;
  revertMessage: (messageId: string) => void;
  toggleTool: (toolName: string, enabled: boolean) => void;
  toggleMcp: (serverName: string, enabled: boolean) => void;
  refreshMcp: () => void;
  killSubAgent: (agentId: string) => void;
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
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [mcpServers, setMcpServers] = useState<MCPServerStatus[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [subagents, setSubagents] = useState<SubAgentInfo[]>([]);
  const [structuredModels, setStructuredModels] = useState<StructuredModel[]>([]);
  const [subAgentSlots, setSubAgentSlots] = useState(0);
  const [compactState, setCompactState] = useState<'ready' | 'busy' | 'done' | 'failed'>('ready');
  const [revertFill, setRevertFill] = useState<{ text: string; nonce: number } | null>(null);
  const { showToast, showSuccess, showError } = useToaster();

  // Ref mirrors so WS handlers never read stale closures.
  const isWaitingRef = useRef(false);
  useEffect(() => {
    isWaitingRef.current = isWaiting;
  }, [isWaiting]);
  const currentSessionRef = useRef<string | null>(null);
  useEffect(() => {
    currentSessionRef.current = currentSessionId;
  }, [currentSessionId]);
  const pendingCompactionRefreshRef = useRef(false);

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

  // Defer the post-compaction transcript refresh until the turn settles.
  useEffect(() => {
    if (!isWaiting && pendingCompactionRefreshRef.current) {
      pendingCompactionRefreshRef.current = false;
      const sid = currentSessionRef.current;
      if (sid) void loadSession(sid);
    }
  }, [isWaiting, loadSession]);

  // Merge a sub-agent event into the subagents list.
  const upsertSubAgent = useCallback((agentId: string, patch: Partial<SubAgentInfo>) => {
    setSubagents((prev) => {
      const baseAt = Date.now();
      const idx = prev.findIndex((a) => a.agentId === agentId);
      if (idx === -1) {
        return [{ agentId, status: 'running', ...patch, baseAt }, ...prev];
      }
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch, baseAt };
      return next;
    });
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
        // Structured models (cards + variants) for the models modal.
        try {
          const sm = (sd as Record<string, unknown>).structuredModels as
            | StructuredModel[]
            | undefined;
          if (Array.isArray(sm) && sm.length) setStructuredModels(sm);
        } catch {
          /* ignore */
        }
        // Restore the persisted model choice (qualified variant name).
        try {
          const savedModel = localStorage.getItem('yukiweb_model');
          if (savedModel && savedModel !== sd.activeModel) {
            const sm = (sd as Record<string, unknown>).structuredModels as
              | StructuredModel[]
              | undefined;
            const qualified = (sm || []).flatMap((m) =>
              m.variants.map((v) => v.qualifiedName),
            );
            if (qualified.length ? qualified.includes(savedModel) : savedModel) {
              send('model:switch', { modelName: savedModel });
            }
          }
        } catch {
          /* ignore */
        }
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
            model: (sd.config.model as string) || undefined,
            endpoint: (sd.config.endpoint as string) || undefined,
            contextWindow:
              (sd.config.contextWindow as number) || undefined,
          } as Partial<SessionConfig>);
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
        if (md.activeModel) {
          setActiveModel(md.activeModel);
          // Persist the choice so it is restored on the next connect.
          try {
            localStorage.setItem('yukiweb_model', md.activeModel);
          } catch {
            /* ignore */
          }
        }
        if (md.contextWindow) setMaxTokens(md.contextWindow);
        if (typeof md.thinkingEnabled === 'boolean')
          setThinkingEnabled(md.thinkingEnabled);
        // Keep the utility summary's model/endpoint in sync.
        const md2 = data as { model?: string; endpoint?: string };
        if (md2.model || md2.endpoint) {
          setConfig({
            model: md2.model,
            endpoint: md2.endpoint,
          } as Partial<SessionConfig>);
        }
      }),
    );

    unsubs.push(
      on('models:updated', (data) => {
        const md = data as {
          models?: Array<{ name: string; displayName?: string }>;
        };
        if (md.models?.length) setModels(md.models);
        // Keep structured models fresh (server re-broadcasts after CRUD).
        const sm = (data as Record<string, unknown>).models as unknown;
        if (Array.isArray(sm) && sm.length && sm[0] && 'variants' in sm[0]) {
          setStructuredModels(sm as StructuredModel[]);
        } else {
          // Fallback: refresh from the REST endpoint.
          fetch('/api/models')
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              if (d && Array.isArray(d.models)) setStructuredModels(d.models);
            })
            .catch(() => {});
        }
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
        setMessages((prev) => {
          const next = prev.map((m) =>
            m.isStreaming ? { ...m, isStreaming: false } : m,
          );
          return [
            ...next,
            {
              id: `stopped-${Date.now()}`,
              role: 'system' as const,
              content: '',
              timestamp: new Date(),
              stoppedNotice: true,
            },
          ];
        });
        // Cancel any in-flight sub-agent bubbles (legacy parity).
        setSubagents((prev) =>
          prev.map((a) =>
            a.status === 'running' || a.status === 'queued'
              ? { ...a, status: 'cancelled' }
              : a,
          ),
        );
      }),
    );

    unsubs.push(
      on('observer:feedback', (data) => {
        const od = data as { feedback?: ObserverFeedback; sessionId?: string };
        const fb = od.feedback;
        if (!fb || (!fb.concern && !fb.suggestion)) return;
        setMessages((prev) => [
          ...prev,
          {
            id: `observer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            role: 'system' as const,
            content: '',
            timestamp: new Date(),
            observerFeedback: fb,
          },
        ]);
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
        // Refill + refocus the composer with the reverted text.
        setRevertFill({ text: rd.text ?? '', nonce: Date.now() });
        const sid = currentSessionRef.current;
        if (sid) void loadSession(sid);
      }),
    );

    // --- Tools / MCP / Plan ---

    unsubs.push(
      on('tools:list', (data) => {
        const td = data as { tools?: ToolInfo[] };
        if (td.tools) setTools(td.tools);
      }),
    );

    unsubs.push(
      on('tools:toggled', (data) => {
        const td = data as { toolName?: string; enabled?: boolean };
        if (!td.toolName) return;
        setTools((prev) =>
          prev.map((t) =>
            t.name === td.toolName ? { ...t, enabled: !!td.enabled } : t,
          ),
        );
      }),
    );

    unsubs.push(
      on('mcp:list', (data) => {
        const md = data as { servers?: MCPServerStatus[] };
        if (md.servers) setMcpServers(md.servers);
      }),
    );

    unsubs.push(
      on('mcp:toggled', (data) => {
        const md = data as {
          serverName?: string;
          enabled?: boolean;
          success?: boolean;
          error?: string;
        };
        if (md.error) showError(md.error);
      }),
    );

    unsubs.push(
      on('plan:updated', (data) => {
        const pd = data as {
          plan?: {
            id?: string;
            title?: string;
            steps?: Array<{
              id?: string;
              description?: string;
              status?: PlanStep['status'];
            }>;
          } | null;
        };
        if (!pd.plan) {
          setPlan(null);
          return;
        }
        setPlan({
          id: pd.plan.id || `plan-${Date.now()}`,
          title: pd.plan.title || 'Plan',
          steps: (pd.plan.steps || []).map((s) => ({
            id: s.id || '',
            description: s.description || '',
            status: s.status || 'pending',
          })),
        });
      }),
    );

    // --- Context compaction ---

    unsubs.push(
      on('context:compacted', () => {
        setCompactState('done');
        // Refresh the transcript so the freshly-written summary shows up in
        // history; defer until the turn settles if the model is mid-turn.
        const sid = currentSessionRef.current;
        if (sid) {
          if (!isWaitingRef.current) {
            void loadSession(sid);
          } else {
            pendingCompactionRefreshRef.current = true;
          }
        }
        setTimeout(() => {
          if (!isWaitingRef.current) setCompactState('ready');
        }, 3000);
      }),
    );

    unsubs.push(
      on('context:compact-failed', (data) => {
        const cd = data as { error?: string; reason?: string };
        showError(cd.error || cd.reason || 'Context compaction failed');
        setCompactState('failed');
        setTimeout(() => {
          if (!isWaitingRef.current) setCompactState('ready');
        }, 3000);
      }),
    );

    // --- Session fork / switch guards ---

    unsubs.push(
      on('session:fork-result', (data) => {
        const fd = data as {
          ok?: boolean;
          sessionId?: string;
          parentSessionId?: string;
          error?: string;
        };
        if (!fd.ok) {
          showError(fd.error || 'Fork failed');
          return;
        }
        if (fd.sessionId) {
          showSuccess('Session forked');
          send('session:switch', { sessionId: fd.sessionId });
        }
      }),
    );

    unsubs.push(
      on('switch:blocked', (data) => {
        const bd = data as { reason?: string };
        showError(bd.reason || 'Cannot switch session right now');
      }),
    );

    // --- Sub-agents ---

    // Ensure an in-chat agent bubble exists for a live agent (idempotent).
    const ensureAgentBubble = (agentId: string) => {
      setMessages((prev) =>
        prev.some((m) => m.agentId === agentId)
          ? prev
          : [
              ...prev,
              {
                id: `agent-${agentId}`,
                role: 'system' as const,
                content: '',
                timestamp: new Date(),
                agentId,
              },
            ],
      );
    };

    unsubs.push(
      on('subagent:list', (data) => {
        const sd = data as { agents?: SubAgentInfo[] };
        const d2 = data as { agents?: SubAgentInfo[]; slots?: number };
        if (typeof d2.slots === 'number') setSubAgentSlots(d2.slots);
        if (d2.agents) {
          setSubagents(d2.agents.map((a) => ({ ...a, baseAt: Date.now() })));
          // Recreate feed bubbles for agents that are still alive (after a
          // session switch the old bubbles are gone).
          for (const a of d2.agents) {
            if (a.status === 'running' || a.status === 'queued') {
              ensureAgentBubble(a.agentId);
            }
          }
        }
      }),
    );

    const subAgentUpsert = (type: string) =>
      on(type, (data) => {
        const d = data as Partial<SubAgentInfo> & { ok?: boolean };
        const agentId = d.agentId;
        if (!agentId) return;
        const { ok, ...rest } = d;
        if (type === 'subagent:kill-result') {
          upsertSubAgent(agentId, {
            ...rest,
            status: ok ? 'cancelled' : 'error',
            error: ok ? rest.error : rest.error || 'Kill failed',
          });
        } else {
          upsertSubAgent(agentId, rest);
        }
        // A spawn (or a still-alive agent announced via status) gets its own
        // light-blue bubble in the message stream.
        if (type === 'subagent:spawn' || type === 'subagent:status') {
          ensureAgentBubble(agentId);
        }
      });

    unsubs.push(
      subAgentUpsert('subagent:spawn'),
      subAgentUpsert('subagent:status'),
      subAgentUpsert('subagent:done'),
      subAgentUpsert('subagent:kill-result'),
    );

    unsubs.push(
      on('subagent:tool_call', (data) => {
        const d = data as {
          agentId?: string;
          toolCall?: { id: string; name: string; parameters?: Record<string, unknown> };
        };
        if (!d.agentId || !d.toolCall?.id) return;
        const tc = d.toolCall;
        setSubagents((prev) =>
          prev.map((a) => {
            if (a.agentId !== d.agentId) return a;
            const existing = a.toolCalls || [];
            if (existing.some((t) => t.id === tc.id)) return a;
            return {
              ...a,
              toolCalls: [
                ...existing,
                {
                  id: tc.id,
                  name: tc.name,
                  parameters: tc.parameters || {},
                  status: 'running' as const,
                },
              ],
            };
          }),
        );
      }),
    );

    unsubs.push(
      on('subagent:tool_result', (data) => {
        const d = data as {
          agentId?: string;
          toolCallId?: string;
          result?: string;
          status?: string;
        };
        if (!d.agentId || !d.toolCallId) return;
        const status: ToolCallEntry['status'] =
          d.status === 'error' ? 'error' : 'completed';
        setSubagents((prev) =>
          prev.map((a) => {
            if (a.agentId !== d.agentId || !a.toolCalls?.length) return a;
            return {
              ...a,
              toolCalls: a.toolCalls.map((t) =>
                t.id === d.toolCallId
                  ? { ...t, result: d.result, status }
                  : t,
              ),
            };
          }),
        );
      }),
    );

    unsubs.push(
      on('subagent:chunk', (data) => {
        const d = data as { agentId?: string; chunk?: string };
        if (!d.agentId || !d.chunk) return;
        upsertSubAgent(d.agentId, {});
        setSubagents((prev) =>
          prev.map((a) =>
            a.agentId === d.agentId
              ? { ...a, content: (a.content || '') + d.chunk!, status: a.status === 'queued' ? 'running' : a.status }
              : a,
          ),
        );
      }),
    );

    unsubs.push(
      on('subagent:thinking', (data) => {
        const d = data as { agentId?: string; chunk?: string };
        if (!d.agentId || !d.chunk) return;
        setSubagents((prev) =>
          prev.map((a) =>
            a.agentId === d.agentId ? { ...a, thinking: (a.thinking || '') + d.chunk! } : a,
          ),
        );
      }),
    );

    unsubs.push(
      on('subagent:response', (data) => {
        const d = data as { agentId?: string; message?: string };
        if (!d.agentId) return;
        setSubagents((prev) =>
          prev.map((a) =>
            a.agentId === d.agentId
              ? { ...a, content: d.message ?? a.content, status: a.status === 'error' ? a.status : 'completed' }
              : a,
          ),
        );
      }),
    );

    unsubs.push(
      on('subagent:results-delivered', () => {
        showToast('Sub-agent results delivered', 'info');
      }),
    );

    unsubs.push(
      on('subagent:results-pending', (data) => {
        const d = data as { count?: number };
        showToast(`${d.count ?? 1} sub-agent result(s) pending — will be injected`, 'info');
      }),
    );

    unsubs.push(
      on('subagent:wake', (data) => {
        const d = data as { agentId?: string; description?: string };
        console.info('[subagent] wake', d.agentId, d.description);
      }),
    );

    // --- Voice global toggle (tray hotkey ping) ---

    unsubs.push(on('voice:global-toggle', () => {
      // The server broadcasts this when the global voice hotkey fires;
      // voice state arrives via voice:status.
    }));

    return () => unsubs.forEach((u) => u());
  }, [messageRouter, setConfig, loadSession, upsertSubAgent, showToast, showSuccess, showError, send]);

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
      // Guard: don't yank the user away mid-turn (legacy parity).
      if (isWaitingRef.current && sessionId !== currentSessionRef.current) {
        showToast('Yuki is still working — wait for it to finish or press Stop first');
        return;
      }
      send('session:switch', { sessionId, projectId });
    },
    [send, showToast],
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

  const forkSession = useCallback(
    (sessionId: string, messageIndex: number) => {
      send('session:fork', { sessionId, messageIndex });
    },
    [send],
  );

  const moveSession = useCallback(
    (sessionId: string, projectId: string) => {
      send('session:move', { sessionId, projectId });
    },
    [send],
  );

  const compactContext = useCallback(() => {
    setCompactState('busy');
    send('context:compact', {});
  }, [send]);

  const revertMessage = useCallback(
    (messageId: string) => {
      send('message:revert', { messageId });
    },
    [send],
  );

  const toggleTool = useCallback(
    (toolName: string, enabled: boolean) => {
      send('tools:toggle', { toolName, enabled });
    },
    [send],
  );

  const toggleMcp = useCallback(
    (serverName: string, enabled: boolean) => {
      send('mcp:toggle', { serverName, enabled });
    },
    [send],
  );

  const refreshMcp = useCallback(() => {
    send('mcp:refresh', {});
  }, [send]);

  const killSubAgent = useCallback(
    (agentId: string) => {
      send('subagent:kill', { agentId });
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
      tools,
      mcpServers,
      plan,
      subagents,
      structuredModels,
      subAgentSlots,
      compactState,
      revertFill,
      sendMessage,
      stopResponse,
      switchSession,
      createSession,
      deleteSession,
      renameSession,
      switchModel,
      forkSession,
      moveSession,
      compactContext,
      revertMessage,
      toggleTool,
      toggleMcp,
      refreshMcp,
      killSubAgent,
    }),
    [
      messages, isWaiting, isStreaming, thinkingEnabled, compactMode,
      notificationsEnabled, activeModel, models, config, currentSessionId,
      currentProjectId, activeSessionId, sessions, voiceMode, promptTokens,
      maxTokens, tools, mcpServers, plan, subagents, structuredModels,
      subAgentSlots, compactState, revertFill, setConfig, sendMessage,
      stopResponse, switchSession, createSession, deleteSession,
      renameSession, switchModel, forkSession, moveSession, compactContext,
      revertMessage, toggleTool, toggleMcp, refreshMcp, killSubAgent,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
