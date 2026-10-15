export interface ContextManagementConfig {
  enabled: boolean;
  compactionThreshold: number;
  compactionTarget: number;
}

export interface RawLLMLogConfig {
  enabled: boolean;
  maxSizeMB: number;
}

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface ModelConfig {
  name?: string;
  model: string;
  apiKey: string;
  endpoint: string;
  contextWindow: number;
  maxTokens: number;
  temperature?: number;
  thinkingEnabled?: boolean;
  preserveThinking?: boolean;
}

export interface Config {
  // Named model definitions — single source of truth for all model configs
  models?: ModelConfig[];
  // References into the models[] array by name
  activeModel?: string;
  backupModel?: string;
  // Core config
  maxToolIterations: number;
  imageTokensPerImage: number;
  llmTimeoutMs: number;
  thinkingEnabled: boolean;
  reasoningEffort: 'low' | 'medium' | 'high';
  disabledTools: string[];
  mcpServers?: MCPServerConfig[];
  stt: STTConfig;
  tts: TTSConfig;
  ui: UIConfig;
  desktop: DesktopConfig;
  maxToolOutputLines: number;
  subAgents?: SubAgentConfig;
  uiAutomation?: UIAutomationConfig;
  contextManagement?: ContextManagementConfig;
  rawLLMLog?: RawLLMLogConfig;
  webFetchMaxInlineKB: number;
  shell: ShellConfig;
  // Auto session summary — ask the model to generate a short label + topic
  // summary after the first turn of an untitled session.
  autoSessionSummary?: boolean;
  // Temp output file cleanup TTL in minutes (default: 60)
  tempOutputCleanupTTLMinutes?: number;
}

export interface STTConfig {
  provider: string;
  model: string;
  language: string;
  beamSize: number;
  device?: string;
  computeType?: string;
}

export interface TTSConfig {
  provider: string;
  voice: string;
}

export interface UIConfig {
  expandThinking: boolean;
  expandToolOutputs: boolean;
  enableImagePaste: boolean;
  collapseThinkingTools: boolean;
}

export interface DesktopConfig {
  enableAutomation: boolean;
  snapshotExpiry: number;
}

export interface SubAgentConfig {
  enabled: boolean;
  maxAgentSlots: number;
  // Name of the model to use for sub-agents (reference into models[] array)
  model?: string;
}

export interface UIAutomationConfig {
  enabled: boolean;
}

export type ShellEngine = 'pwsh' | 'ps5' | 'cmd';

export interface ShellConfig {
  engine: ShellEngine;
  pwshPath: string;
  ps5Path: string;
  cmdPath: string;
}

export interface PlanStep {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

export interface Plan {
  id: string;
  title: string;
  steps: PlanStep[];
  createdAt: Date;
  updatedAt: Date;
}

// Message types
export interface Attachment {
  name: string;
  type: string;        // MIME type
  path: string;        // absolute path to the file on disk (server-side)
  size: number;
  isImage: boolean;
  dataUrl?: string;    // raw data URL (kept for images / small text files)
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  reasoningContent?: string;
  sessionId: string;
  images?: string[];
  attachments?: Attachment[];
  pruned?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  parameters: Record<string, any>;
  result?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
}

// Project types
export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: Date;
  updatedAt: Date;
}

// Session types
export interface Session {
  id: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
  title?: string;
  summary?: string;      // 1-2 sentence topic summary
  projectId?: string;
  thinkingEnabled?: boolean;
  voiceMode?: boolean;
  disabledTools?: string[];
}

// WebSocket event types
export interface WSEvent {
  type: string;
  data: any;
}

export interface ChatMessageEvent extends WSEvent {
  type: 'chat:message';
  data: {
    message: string;
    sessionId?: string;
  };
}

export interface ChatResponseEvent extends WSEvent {
  type: 'chat:response';
  data: {
    message: string;
    toolCalls?: ToolCall[];
    messageId?: string;
    sessionId?: string;
  };
}

export interface ToolCallEvent extends WSEvent {
  type: 'tool:call';
  data: {
    toolCall: ToolCall;
  };
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
  data: {
    chunk: string;
    messageId?: string;
    sessionId?: string;
  };
}

// Tool result type
export interface ToolResult {
  name: string;
  output: string;
  error?: string;
}

// Audio events
export interface AudioTranscribeEvent extends WSEvent {
  type: 'audio:transcribe';
  data: {
    audioBase64: string;
  };
}

export interface AudioTranscribedEvent extends WSEvent {
  type: 'audio:transcribed';
  data: {
    text: string;
  };
}

export interface AudioSynthesizeEvent extends WSEvent {
  type: 'audio:synthesize';
  data: {
    audioBase64: string;
  };
}

// Session events
export interface SessionSwitchEvent extends WSEvent {
  type: 'session:switch';
  data: {
    sessionId: string;
  };
}

export interface SessionClearedEvent extends WSEvent {
  type: 'session:cleared';
  data: {
    sessionId: string;
  };
}

// Desktop events
export interface ScreenshotEvent extends WSEvent {
  type: 'desktop:screenshot';
  data: {
    imageBase64: string;
  };
}
