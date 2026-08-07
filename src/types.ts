/**
 * Core types for the YukiWeb application.
 */

/** Represents the role of a message in a conversation. */
export type Role = 'user' | 'assistant' | 'system' | 'tool';

/** A single message in the conversation history. */
export interface Message {
  role: Role;
  content: string;
}

/** Configuration for connecting to an LLM provider. */
export interface LLMConfig {
  provider: 'openai' | 'ollama';
  baseUrl?: string; // For Ollama or custom endpoints
  apiKey?: string; // For OpenAI
  model?: string;
}

/** Configuration for the STT/TTS Python microservice. */
export interface SpeechConfig {
  enabled: boolean;
  serviceUrl: string;
  sttModel: string;
  ttsModel: string;
}

/** Configuration for the Desktop Automation Python microservice. */
export interface DesktopConfig {
  enabled: boolean;
  serviceUrl: string;
}

/** The main application configuration. */
export interface AppConfig {
  llm: LLMConfig;
  speech: SpeechConfig;
  desktop: DesktopConfig;
  systemPrompt: string;
}

/** A tool definition for the LLM. */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Represents a tool call request from the LLM. */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/** Represents a tool response to be sent back to the LLM. */
export interface ToolResponse {
  id: string;
  name: string;
  content: string; // Result of the tool execution
}
