import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Config, ContextManagementConfig, ModelConfig } from '../shared/types';

const configDir = path.join(os.homedir(), '.config', 'yukiweb');
const configPath = path.join(configDir, 'config.json');
const systemPromptPath = path.join(configDir, 'system_prompt.txt');
const voiceSystemPromptPath = path.join(configDir, 'voice_system_prompt.txt');

const defaultModelConfig: ModelConfig = {
  endpoint: 'http://debby:1234/v1',
  apiKey: '',
  model: 'unsloth/Qwen3.6-27B-MTP-GGUF/Qwen3.6-27B-Q4_K_M',
  maxTokens: 8000,
  contextWindow: 64000,
  temperature: undefined,
  thinkingEnabled: false,
  preserveThinking: true,
};

const defaultConfig: Config = {
  agentModel: { ...defaultModelConfig },
  maxToolIterations: 10,
  imageTokensPerImage: 1024,
  llmTimeoutMs: 180000,
  thinkingEnabled: false,
  reasoningEffort: 'medium',
  maxToolOutputLines: 20,
  disabledTools: [
    'browser_navigate', 'browser_click', 'browser_fill', 'browser_screenshot', 'browser_get_content', 'browser_get_links',
    'desktop_viewport', 'desktop_screenshot', 'desktop_snapshot_region', 'desktop_click', 'desktop_type', 'desktop_move', 'desktop_drag', 'desktop_scroll', 'desktop_keypress',
  ],
  mcpServers: [],
  stt: {
    provider: 'whisper',
    model: 'small',
    language: 'en',
    beamSize: 2,
    device: 'auto',
  },
  tts: {
    provider: 'local',
    voice: 'en_US-amy-medium',
  },
  ui: {
    expandThinking: true,
    expandToolOutputs: true,
    enableImagePaste: true,
    collapseThinkingTools: true,
  },
  desktop: {
    enableAutomation: false,
    snapshotExpiry: 3,
  },
  contextManagement: {
    enabled: true,
    compactionThreshold: 0.85,
    compactionTarget: 0.25,
  },
  rawLLMLog: {
    enabled: false,
    maxSizeMB: 25,
  },
  webFetchMaxInlineKB: 50,
};

export function loadEnvFile(): void {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2] || '';
      }
    }
  } catch (err) {
    console.error('Failed to load .env:', err);
  }
}

let config: Config = defaultConfig;
let activeModelName: string | undefined;
let thinkingOverride: boolean | undefined = undefined;

export function setThinkingOverride(enabled: boolean): void {
  thinkingOverride = enabled;
}

export function getThinkingOverride(): boolean | undefined {
  return thinkingOverride;
}

export function getEffectiveThinking(name?: string): boolean {
  if (thinkingOverride !== undefined) return thinkingOverride;
  return getModelDefaultThinking(name);
}

function normalizeModelConfig(src: any, fallback?: ModelConfig): ModelConfig {
  return {
    endpoint: src?.endpoint || fallback?.endpoint || defaultModelConfig.endpoint,
    apiKey: src?.apiKey ?? fallback?.apiKey ?? defaultModelConfig.apiKey,
    model: src?.model || fallback?.model || defaultModelConfig.model,
    maxTokens: src?.maxTokens ?? fallback?.maxTokens ?? defaultModelConfig.maxTokens,
    contextWindow: src?.contextWindow || fallback?.contextWindow || defaultModelConfig.contextWindow,
    temperature: src?.temperature ?? fallback?.temperature,
    thinkingEnabled: src?.thinkingEnabled ?? fallback?.thinkingEnabled ?? defaultModelConfig.thinkingEnabled,
    preserveThinking: src?.preserveThinking ?? fallback?.preserveThinking ?? defaultModelConfig.preserveThinking,
  };
}

export function getNamedModels(): ModelConfig[] {
  if (config.models && config.models.length > 0) return config.models;
  if (config.agentModel) return [{ ...config.agentModel, name: config.agentModel.name || 'Default' }];
  return [{ ...defaultModelConfig, name: 'Default' }];
}

export function getModelConfig(name: string): ModelConfig | undefined {
  return getNamedModels().find(m => m.name === name);
}

export function getActiveModelName(): string {
  if (activeModelName) return activeModelName;
  if (config.defaultModel) return config.defaultModel;
  const models = getNamedModels();
  return models[0]?.name || 'Default';
}

export function setActiveModelName(name: string): ModelConfig | undefined {
  const cfg = getModelConfig(name);
  if (cfg) {
    activeModelName = name;
  }
  return cfg;
}

export function getBackupModelName(): string | undefined {
  return config.backupModel;
}

export function getAgentModel(modelName?: string): ModelConfig {
  if (modelName) {
    const named = getModelConfig(modelName);
    if (named) return named;
  }
  const active = getActiveModelName();
  const activeConfig = getModelConfig(active);
  if (activeConfig) return activeConfig;
  return config.agentModel || normalizeModelConfig(config, defaultModelConfig);
}

export function getModelDefaultThinking(name?: string): boolean {
  const cfg = getAgentModel(name);
  return cfg.thinkingEnabled ?? getConfig().thinkingEnabled ?? false;
}

export function loadConfig(): Config {
  try {
    if (fs.existsSync(configPath)) {
      let raw = fs.readFileSync(configPath, 'utf-8');
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      const loaded = JSON.parse(raw);
      config = {
        ...defaultConfig,
        ...loaded,
        agentModel: loaded.agentModel
          ? { ...defaultConfig.agentModel, ...loaded.agentModel }
          : normalizeModelConfig(loaded, defaultModelConfig as any),

        stt: { ...defaultConfig.stt, ...(loaded.stt || {}) },
        tts: { ...defaultConfig.tts, ...(loaded.tts || {}) },
        ui: { ...defaultConfig.ui, ...(loaded.ui || {}) },
        desktop: { ...defaultConfig.desktop, ...(loaded.desktop || {}) },
        contextManagement: { ...defaultConfig.contextManagement, ...(loaded.contextManagement || {}) },
        rawLLMLog: { ...defaultConfig.rawLLMLog, ...(loaded.rawLLMLog || {}) },
      };

      if (!activeModelName) {
        activeModelName = config.defaultModel || getNamedModels()[0]?.name;
      }

      if (loaded.thinkingEnabled !== undefined) {
        thinkingOverride = loaded.thinkingEnabled;
      }
    }
  } catch (err) {
    console.error('Failed to load config, using defaults:', err);
    config = { ...defaultConfig };
    if (!activeModelName) {
      activeModelName = getNamedModels()[0]?.name;
    }
  }
  return config;
}

export function saveConfig(newConfig: Config): void {
  config = newConfig;
  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('Failed to save config:', err);
  }
}

export function getConfig(): Config {
  return config;
}

export function loadSystemPrompt(): string {
  try {
    if (fs.existsSync(systemPromptPath)) {
      return fs.readFileSync(systemPromptPath, 'utf-8');
    }
  } catch (err) {
    console.error('Failed to load system prompt:', err);
  }

  const defaultPrompt = `You are Yuki, a helpful AI assistant. You can help with various tasks including answering questions, writing code, and automating tasks.

When you need to find information online, ALWAYS use web_search first. Only use web_fetch if search snippets are insufficient, and browser_navigate only if you need to interact with a live rendered page.

## Formatting

- Use markdown for formatting. Headings, bold, italic, lists, tables, and code blocks all render as expected.
- When showing a code block that itself contains fenced code blocks, use longer fences for the outer block (e.g., \`\`\`\`\`markdown ... \`\`\`\`\`) so the inner triple-backtick blocks don't prematurely close the outer one.`;

  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(systemPromptPath, defaultPrompt);
  } catch (err) {
    console.error('Failed to write default system prompt:', err);
  }

  return defaultPrompt;
}

export function loadVoiceSystemPrompt(): string {
  try {
    if (fs.existsSync(voiceSystemPromptPath)) {
      return fs.readFileSync(voiceSystemPromptPath, 'utf-8');
    }
  } catch (err) {
    console.error('Failed to load voice system prompt:', err);
  }

  const defaultVoicePrompt = `You are Yuki, a helpful and friendly AI assistant speaking to the user by voice.

## Voice Response Style

- Respond conversationally, exactly as you would say it out loud.
- Use NO markdown formatting: no headings, bold, italics, lists, tables, code blocks, or bullet points.
- Do not use symbols or abbreviations that are awkward to read aloud (e.g. "->", "=>", "a.k.a."). Spell them out.
- Keep answers concise so they read back quickly. Aim for a few short sentences unless the user asks for more detail.
- Answer yes/no questions with a clear yes or no first, then a brief explanation.
- If you need to use tools, do so silently and report the outcome in plain spoken language.
- For complex tasks, say briefly what you are doing, then give the result conversationally.
- Never output raw code, file paths, or commands unless the user explicitly asks; if you must, keep them minimal and say them naturally.`;

  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(voiceSystemPromptPath, defaultVoicePrompt);
  } catch (err) {
    console.error('Failed to write default voice system prompt:', err);
  }

  return defaultVoicePrompt;
}
