import { createContext, useContext } from 'solid-js';
import { createSignal } from 'solid-js';
import type { Accessor, Setter } from 'solid-js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'agent';
  content: string;
  timestamp: number;
  compacted?: boolean;
  reasoningContent?: string;
  toolCalls?: ToolCall[];
  forkedFrom?: string;
  sessionId?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  parameters?: Record<string, unknown>;
  result?: string;
  status?: string;
}

export interface ModelInfo {
  name: string;
  displayName?: string;
}

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

export interface Session {
  id: string;
  title: string;
  projectId: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface SessionTree {
  sessions: Session[];
  projects: Project[];
}

export interface Project {
  id: string;
  name: string;
  path?: string;
  sessions: string[];
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface SessionContextValue {
  // Messages
  messages: Accessor<ChatMessage[]>;
  setMessages: Setter<ChatMessage[]>;

  // Streaming state
  isWaiting: Accessor<boolean>;
  setIsWaiting: Setter<boolean>;
  isStreaming: Accessor<boolean>;
  setIsStreaming: Setter<boolean>;

  // Agent settings
  thinkingEnabled: Accessor<boolean>;
  setThinkingEnabled: Setter<boolean>;
  compactMode: Accessor<boolean>;
  setCompactMode: Setter<boolean>;
  notificationsEnabled: Accessor<boolean>;
  setNotificationsEnabled: Setter<boolean>;

  // Model
  activeModel: Accessor<string>;
  setActiveModel: Setter<string>;
  models: Accessor<ModelInfo[]>;
  setModels: Setter<ModelInfo[]>;

  // Session management
  config: Accessor<SessionConfig>;
  setConfig: Setter<SessionConfig>;
  currentSessionId: Accessor<string | null>;
  setCurrentSessionId: Setter<string | null>;
  currentProjectId: Accessor<string>;
  setCurrentProjectId: Setter<string>;

  // Tree / sessions list
  sessions: Accessor<Session[]>;
  setSessions: Setter<Session[]>;
  tree: Accessor<SessionTree>;

  // Audio
  voiceMode: Accessor<boolean>;
  setVoiceMode: Setter<boolean>;
}

const SessionContext = createContext<SessionContextValue>();

export function SessionProvider(props: { children: import('solid-js').JSX.Element }) {
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [isWaiting, setIsWaiting] = createSignal(false);
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [thinkingEnabled, setThinkingEnabled] = createSignal(false);
  const [compactMode, setCompactMode] = createSignal(false);
  const [notificationsEnabled, setNotificationsEnabled] = createSignal(true);
  const [activeModel, setActiveModel] = createSignal('');
  const [models, setModels] = createSignal<ModelInfo[]>([]);
  const [voiceMode, setVoiceMode] = createSignal(false);
  const [config, setConfig] = createSignal<SessionConfig>({} as SessionConfig);
  const [currentSessionId, setCurrentSessionId] = createSignal<string | null>(null);
  const [currentProjectId, setCurrentProjectId] = createSignal('default');
  const [sessions, setSessions] = createSignal<Session[]>([]);

  const tree = () => ({
    sessions: sessions(),
    projects: [],
  });

  const value: SessionContextValue = {
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
    sessions,
    setSessions,
    tree,
    voiceMode,
    setVoiceMode,
  };

  return <SessionContext.Provider value={value}>{props.children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return ctx;
}
