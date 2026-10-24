export interface ContextManagementConfig {
  enabled: boolean;
  // Compact once the projected prompt exceeds this fraction of the context window.
  compactionThreshold: number;
  // Fraction of the window at which a turn is halted instead of being sent to the model.
  hardStopThreshold: number;
  // Multiplier applied to the last provider-reported prompt token count, which is
  // ground truth, before comparing it against the compaction threshold.
  estimateSafetyMargin: number;
  // Maximum characters of a single tool result kept in conversation history.
  // The full output stays on disk / in the temp file the tool already points at.
  toolResultMaxChars: number;
  // Starting chars-per-token assumption; refined at runtime from reported usage.
  charsPerToken: number;
  // Fraction of the context window a single summarization request may occupy
  // before the summarization itself is staged across multiple calls.
  stagedSummaryBudget: number;
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
  // Reasoning depth when thinking is enabled. Maps to the thinking token
  // budget sent to the model (low=4096, medium=16000, high=32768, xhigh=64384).
  // Defaults to 'medium' when unset.
  reasoningEffort? : 'low' | 'medium' | 'high' | 'xhigh';
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
  disabledTools: string[];
  mcpServers?: MCPServerConfig[];
  stt: STTConfig;
  tts: TTSConfig;
  ui: UIConfig;
  desktop: DesktopConfig;
  /**
   * Max tool output size, in characters.
   *   N > 0 : cap output at N chars; overflow is saved to disk with a preview.
   *   N == 0: write full output to disk immediately, no inline preview.
   *   N < 0 : size control disabled — full output returned inline, never saved.
   */
  maxToolOutputChars: number;
  /**
   * Dedicated limits for the `read` tool, independent of maxToolOutputChars,
   * so the model can always page through file contents inline.
   *   maxReadLines: max lines returned per read call (0 = no line cap).
   *   maxReadChars: max characters returned per read call (0 = no char cap).
   *   readNumbered: prefix each returned line with its line number (default true).
   */
  maxReadLines: number;
  maxReadChars: number;
  readNumbered: boolean;
  subAgents?: SubAgentConfig;
  observer?: ObserverConfig;
  uiAutomation?: UIAutomationConfig;
  contextManagement?: ContextManagementConfig;
  rawLLMLog?: RawLLMLogConfig;
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
  // Show a desktop notification when a model turn completes while the tab is
  // not focused. Can also be toggled at runtime from the options menu.
  desktopNotifications?: boolean;
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

export interface ObserverConfig {
  enabled: boolean;
  // Name of the model to use for the observer (reference into models[] array).
  // If empty, uses the same model as the active agent model.
  model?: string;
  // How often to run the observer: 'every' (every turn) or 'periodic' (every N turns)
  mode: 'every' | 'periodic';
  // When mode is 'periodic', run observer every N agent turns
  interval: number;
  // Maximum number of suggestions to inject per evaluation (prevents context bloat)
  maxSuggestions: number;
  // Timeout in ms for the observer call
  timeoutMs: number;
  // If the observer's confidence in a concern is below this, skip it (0-1)
  minConfidence: number;
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
  // Set when this turn has been folded into the compaction summary. The turn is
  // kept in the session log for reference, but is no longer replayed to the model.
  compacted?: boolean;
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
  // Calibrated chars-per-token for this session's model, learned from reported usage.
  charsPerToken?: number;
  // Last prompt token count reported by the provider — the authoritative context size.
  lastPromptTokens?: number;
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
