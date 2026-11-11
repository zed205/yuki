/**
 * Yuki client types.
 * Ported from client-v2 SolidJS types/yuki.d.ts — kept in sync with the
 * server's shared/types.ts and the WS protocol in server/index.ts.
 */

// ─── Role & Core ─────────────────────────────────────────────────────────────

export type Role = 'user' | 'assistant' | 'system' | 'tool';

export type VoiceStatus =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'error';

// ─── Message ─────────────────────────────────────────────────────────────────

export interface Attachment {
  name: string;
  type: string;       // MIME type
  path: string;       // absolute path to the file on disk (server-side)
  size: number;
  isImage: boolean;
  dataUrl?: string;   // raw data URL (kept for images / small text files)
}

export interface ToolCallEntry {
  id: string;
  name: string;
  parameters: Record<string, unknown>;
  result?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date | number;
  toolCalls?: ToolCallEntry[];
  reasoningContent?: string;
  sessionId?: string;
  images?: string[];
  attachments?: Attachment[];
  pruned?: boolean;
  compacted?: boolean;
  forkedFrom?: string;
  parentSessionId?: string;
  syntheticPrefix?: string;
  source?: 'timer' | 'job';
}

// ─── Session ─────────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  messages: Message[];
  createdAt: Date | number;
  updatedAt: Date | number;
  title?: string;
  summary?: string;
  projectId?: string;
  thinkingEnabled?: boolean;
  voiceMode?: boolean;
  disabledTools?: string[];
  charsPerToken?: number;
  lastPromptTokens?: number;
  lastUsage?: number;
  forkedFrom?: string;
  parentMessageId?: string;
}

// ─── Project ─────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  path: string;
  /** Session ids belonging to this project (session count for display). */
  sessions?: string[];
  createdAt?: Date | number;
  updatedAt?: Date | number;
}

// ─── Browser State ───────────────────────────────────────────────────────────

export interface BrowserState {
  enabled: boolean;
  url: string;
  screenshot: string | null;  // base64 data URL
  title: string;
}

// ─── Tool / Thinking ─────────────────────────────────────────────────────────

export interface ToolEntry {
  id: string;
  name: string;
  parameters: Record<string, unknown>;
  result?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  startedAt: number;
  finishedAt?: number;
}

// ─── WebSocket Messages ──────────────────────────────────────────────────────

export interface WSEvent {
  type: string;
  data: unknown;
}

export interface ChatMessageEvent extends WSEvent {
  type: 'chat:message';
  data: { message: string; sessionId?: string };
}

export interface ChatResponseEvent extends WSEvent {
  type: 'chat:response';
  data: {
    message: string;
    toolCalls?: ToolCallEntry[];
    messageId?: string;
    sessionId?: string;
  };
}

export interface ToolCallEvent extends WSEvent {
  type: 'tool:call';
  data: { toolCall: ToolCallEntry };
}

export interface ToolResultEvent extends WSEvent {
  type: 'tool:result';
  data: {
    toolCallId: string;
    result: string;
    status: 'completed' | 'error';
  };
}

export interface StreamingChunkEvent extends WSEvent {
  type: 'chat:chunk';
  data: { chunk: string; messageId?: string; sessionId?: string };
}

export interface SessionForkedEvent extends WSEvent {
  type: 'session:forked';
  data: {
    sessionId: string;
    parentSessionId: string;
    parentMessageId: string;
  };
}

export interface ScreenshotEvent extends WSEvent {
  type: 'desktop:screenshot';
  data: { imageBase64: string };
}

export type WSMessageEvent =
  | ChatMessageEvent
  | ChatResponseEvent
  | ToolCallEvent
  | ToolResultEvent
  | StreamingChunkEvent
  | SessionForkedEvent
  | ScreenshotEvent
  | WSEvent;  // fallback for untyped events

// ─── Plan ────────────────────────────────────────────────────────────────────

export interface PlanStep {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

export interface Plan {
  id: string;
  title: string;
  steps: PlanStep[];
  createdAt?: Date | number;
  updatedAt?: Date | number;
}

// ─── Models ──────────────────────────────────────────────────────────────────

export interface ModelInfo {
  id?: string;
  name: string;
  displayName?: string;
  model?: string;
  endpoint?: string;
  contextWindow?: number;
  maxTokens?: number;
  isDefault?: boolean;
}

// ─── MCP ─────────────────────────────────────────────────────────────────────

export interface MCPServerStatus {
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
  serverEnabled?: boolean;
  connected: boolean;
  error?: string;
  toolCount: number;
}

// ─── Tools list (server → client) ────────────────────────────────────────────

export interface ToolListItem {
  name: string;
  enabled: boolean;
}
