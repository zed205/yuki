import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Config, ContextManagementConfig, ModelConfig, SubAgentConfig, ObserverConfig, UIAutomationConfig, ShellConfig, SearchConfig } from '../shared/types';
import { splitLines, normalizeLineEndings } from './utils/line-endings';
import { dataDir } from './paths';
import {
  listModelRows, listVariantRows, upsertModel, upsertVariant,
  deleteModelRow, deleteVariantRow, clearVariantDefaults,
  getSetting, setSetting, deleteSetting,
  ModelRow, ModelVariantRow,
} from '../db';

const configDir = dataDir;
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
  reasoningEffort: 'xhigh',
};

const defaultSubAgentConfig: SubAgentConfig = {
  enabled: false,
  maxAgentSlots: 4,
  background: true,
  maxQueued: 8,
};

const defaultObserverConfig: ObserverConfig = {
  enabled: false,
  model: "",
  mode: "periodic",
  interval: 3,
  maxSuggestions: 3,
  timeoutMs: 30000,
  minConfidence: 0.5,
};

const defaultUIAutomationConfig: UIAutomationConfig = {
  enabled: true,
};

const defaultShellConfig: ShellConfig = {
  pwshPath: 'pwsh',
};

const defaultConfig: Config = {
  // Default model -- used when no models[] are configured
  models: [{
    ...defaultModelConfig,
    name: 'Default',
  }],
  activeModel: 'Default',
  maxToolIterations: 10,
  imageTokensPerImage: 1024,
  llmTimeoutMs: 180000,
  llmStaleTimeoutMs: 120000,
  thinkingEnabled: false,
  maxToolOutputChars: 20000,
  maxReadLines: 200,
  maxReadChars: 20000,
  disabledTools: [
    'desktop_viewport', 'desktop_screenshot', 'desktop_snapshot_region', 'desktop_click', 'desktop_type', 'desktop_move', 'desktop_drag', 'desktop_scroll', 'desktop_keypress',
  ],
  subAgents: { ...defaultSubAgentConfig, model: 'Default' },
  uiAutomation: defaultUIAutomationConfig,
  shell: defaultShellConfig,
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
    desktopNotifications: true,
  },
  autoSessionSummary: true,
  desktop: {
    enableAutomation: false,
    snapshotExpiry: 3,
  },
  contextManagement: {
    enabled: true,
    compactionThreshold: 0.85,
    hardStopThreshold: 0.95,
    estimateSafetyMargin: 1.15,
    toolResultMaxChars: 16000,
    charsPerToken: 3.0,
    stagedSummaryBudget: 0.5,
  },
  rawLLMLog: {
    enabled: false,
    maxSizeMB: 25,
  },
  tempOutputCleanupTTLMinutes: 60,
  observer: { ...defaultObserverConfig },
  search: {},
};

let config: Config = { ...defaultConfig };
let activeModelName: string | undefined;
let thinkingOverride: boolean | undefined = undefined;

export function loadEnvFile(): void {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of splitLines(fs.readFileSync(envPath, 'utf-8'))) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2] || '';
      }
    }
  } catch (err) {
    console.error('Failed to load .env:', err);
  }
}

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


export function getNamedModels(): ModelConfig[] {
  // Primary: use models[] array if defined
  if (config.models && config.models.length > 0) return config.models;
  // Fallback: create a default model entry
  return [{ ...defaultModelConfig, name: 'Default' }];
}

export function getModelConfig(name: string): ModelConfig | undefined {
  return getNamedModels().find(m => m.name === name);
}

export function getActiveModelName(): string {
  if (activeModelName) return activeModelName;
  if (config?.activeModel) return config.activeModel;
  const models = getNamedModels();
  return models[0]?.name || 'Default';
}

export function setActiveModelName(name: string): ModelConfig | undefined {
  const cfg = getModelConfig(name);
  if (cfg) {
    activeModelName = name;
    config.activeModel = name;
    // Persist the selection so the DB is the source of truth across restarts.
    try { setSetting('activeModel', name); } catch (err) { console.error('Failed to persist active model:', err); }
  }
  return cfg;
}

export function getAgentModel(modelName?: string): ModelConfig {
  if (modelName) {
    const named = getModelConfig(modelName);
    if (named) return named;
  }
  const active = getActiveModelName();
  const activeConfig = getModelConfig(active);
  if (activeConfig) return activeConfig;
  // Fallback: create default model config
  return { ...defaultModelConfig, name: 'Default' };
}

/**
 * Get reasoning effort for a model, falling back to the default 'xhigh' when unset.
 */
export function getModelReasoningEffort(name?: string): string | undefined {
  const cfg = getAgentModel(name);
  return cfg.reasoningEffort ?? 'xhigh';
}

export function getModelDefaultThinking(name?: string): boolean {
  const cfg = getAgentModel(name);
  return cfg.thinkingEnabled ?? getConfig().thinkingEnabled ?? false;
}

// ---------------------------------------------------------------------------
// Model & variant persistence (SQLite-backed)
// ---------------------------------------------------------------------------
//
// The DB tables `models` (connection identity) and `model_variants` (generation
// presets) are the source of truth for model definitions. On load (and after any
// mutation) we flatten them into the in-memory `config.models` array so the rest
// of the app (agent, sub-agents, observer, client) keeps working unchanged. A
// variant is addressed by a fully-qualified name: the model's plain name for its
// default variant, or `"<model> / <variant>"` otherwise.

export interface StructuredVariant {
  id: string;
  name: string;
  temperature: number | null;
  thinkingEnabled: boolean | null;
  preserveThinking: boolean | null;
  reasoningEffort: string | null;
  isDefault: boolean;
  sortOrder: number;
  qualifiedName: string;
}

export interface StructuredModel {
  id: string;
  name: string;
  model: string;
  endpoint: string;
  apiKeyMasked: string;
  contextWindow: number | null;
  maxTokens: number | null;
  sortOrder: number;
  variants: StructuredVariant[];
}

export interface ModelInput {
  name: string;
  model?: string;
  endpoint: string;
  apiKey?: string;
  contextWindow?: number | null;
  maxTokens?: number | null;
  sortOrder?: number;
}

export interface VariantInput {
  name: string;
  temperature?: number | null;
  thinkingEnabled?: boolean | null;
  preserveThinking?: boolean | null;
  reasoningEffort?: string | null;
  isDefault?: boolean;
  sortOrder?: number;
}

function buildVariantsMap(): Map<string, ModelVariantRow[]> {
  const map = new Map<string, ModelVariantRow[]>();
  for (const v of listVariantRows()) {
    const arr = map.get(v.model_id) || [];
    arr.push(v);
    map.set(v.model_id, arr);
  }
  return map;
}

/**
 * Map each variant of a model to its fully-qualified selection name.
 * The default variant maps to the model's plain name; if none is marked
 * default, the first variant takes the plain name instead, so the bare model
 * name always resolves to a runnable config.
 */
function variantQualifiedNames(m: ModelRow, variants: ModelVariantRow[]): Map<string, string> {
  const map = new Map<string, string>();
  let assignedPlain = false;
  for (const v of variants) {
    if (v.is_default === 1 && !assignedPlain) {
      map.set(v.id, m.name);
      assignedPlain = true;
    } else {
      map.set(v.id, `${m.name} / ${v.name}`);
    }
  }
  if (!assignedPlain && variants.length > 0) {
    map.set(variants[0].id, m.name);
  }
  return map;
}

/** Build the flat in-memory model list from the DB (every defined model). */
function flattenModels(models: ModelRow[], variantsByModel: Map<string, ModelVariantRow[]>): ModelConfig[] {
  const flat: ModelConfig[] = [];
  for (const m of models) {
    const variants = variantsByModel.get(m.id) || [];
    if (variants.length === 0) {
      flat.push({
        name: m.name,
        model: m.model,
        apiKey: m.api_key || '',
        endpoint: m.endpoint,
        contextWindow: m.context_window ?? 64000,
        maxTokens: m.max_tokens ?? -1,
      });
      continue;
    }
    const qnames = variantQualifiedNames(m, variants);
    for (const v of variants) {
      flat.push({
        name: qnames.get(v.id) || `${m.name} / ${v.name}`,
        model: m.model,
        apiKey: m.api_key || '',
        endpoint: m.endpoint,
        contextWindow: m.context_window ?? 64000,
        maxTokens: m.max_tokens ?? -1,
        temperature: v.temperature ?? undefined,
        thinkingEnabled: v.thinking_enabled == null ? undefined : v.thinking_enabled === 1,
        preserveThinking: v.preserve_thinking == null ? undefined : v.preserve_thinking === 1,
        reasoningEffort: (v.reasoning_effort || undefined) as ModelConfig['reasoningEffort'],
      });
    }
  }
  return flat;
}

/** Re-read the model/variant tables and refresh the in-memory config. */
export function refreshModels(): void {
  try {
    const models = listModelRows();
    const variantsByModel = buildVariantsMap();
    config.models = flattenModels(models, variantsByModel);
    if (!config.activeModel || !getNamedModels().some(m => m.name === config.activeModel)) {
      config.activeModel = getNamedModels()[0]?.name;
    }
    if (!activeModelName || !getNamedModels().some(m => m.name === activeModelName)) {
      activeModelName = config.activeModel || getNamedModels()[0]?.name;
    }
  } catch (err) {
    console.error('Failed to refresh models from DB:', err);
  }
}

/** Seed the DB from the models[] array in config.json (first run only). */
function seedModelsFromConfigFile(): void {
  const fileModels = config.models;
  if (!Array.isArray(fileModels) || fileModels.length === 0) return;
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < fileModels.length; i++) {
    const m = fileModels[i];
    if (!m || !m.name) continue;
    const modelId = randomUUID();
    upsertModel({
      id: modelId,
      name: m.name,
      model: m.model || '',
      endpoint: m.endpoint || '',
      api_key: m.apiKey || null,
      context_window: typeof m.contextWindow === 'number' ? m.contextWindow : null,
      max_tokens: typeof m.maxTokens === 'number' ? m.maxTokens : null,
      sort_order: i,
      created_at: now,
      updated_at: now,
    });
    upsertVariant({
      id: randomUUID(),
      model_id: modelId,
      name: 'Default',
      temperature: typeof m.temperature === 'number' ? m.temperature : null,
      thinking_enabled: m.thinkingEnabled == null ? null : (m.thinkingEnabled ? 1 : 0),
      preserve_thinking: m.preserveThinking == null ? null : (m.preserveThinking ? 1 : 0),
      reasoning_effort: m.reasoningEffort || null,
      is_default: 1,
      sort_order: 0,
    });
  }
  if (config.activeModel) setSetting('activeModel', config.activeModel);
  deleteSetting('backupModel'); // legacy key — backup models have been removed
}

/**
 * Hydrate the in-memory model list from the DB. Called from loadConfig().
 * Seeds the DB from config.json on first run, then flattens into config.models.
 */
export function hydrateModelsFromDb(): void {
  try {
    if (listModelRows().length === 0) {
      seedModelsFromConfigFile();
    }
    const models = listModelRows();
    if (models.length === 0) return; // nothing in DB — keep file/default models
    const variantsByModel = buildVariantsMap();
    config.models = flattenModels(models, variantsByModel);
    const dbActive = getSetting('activeModel');
    if (dbActive) config.activeModel = dbActive;
    deleteSetting('backupModel'); // legacy key — backup models have been removed
    if (!config.activeModel || !getNamedModels().some(m => m.name === config.activeModel)) {
      config.activeModel = getNamedModels()[0]?.name;
    }
    if (!activeModelName) {
      activeModelName = config.activeModel || getNamedModels()[0]?.name;
    }
  } catch (err) {
    console.error('Failed to hydrate models from DB, keeping file models:', err);
  }
}

/** Nested model → variants shape for the settings UI (all models, incl. disabled). */
export function getStructuredModels(): StructuredModel[] {
  const models = listModelRows();
  const variantsByModel = buildVariantsMap();
  return models.map(m => {
    const all = variantsByModel.get(m.id) || [];
    const qnames = variantQualifiedNames(m, all);
    return {
      id: m.id,
      name: m.name,
      model: m.model,
      endpoint: m.endpoint,
      apiKeyMasked: m.api_key ? '***' : '',
      contextWindow: m.context_window,
      maxTokens: m.max_tokens,
      sortOrder: m.sort_order,
      variants: all.map(v => ({
        id: v.id,
        name: v.name,
        temperature: v.temperature,
        thinkingEnabled: v.thinking_enabled == null ? null : v.thinking_enabled === 1,
        preserveThinking: v.preserve_thinking == null ? null : v.preserve_thinking === 1,
        reasoningEffort: v.reasoning_effort,
        isDefault: v.is_default === 1,
        sortOrder: v.sort_order,
        qualifiedName: qnames.get(v.id) || `${m.name} / ${v.name}`,
      })),
    };
  });
}

// --- Model & variant CRUD (called by the REST layer) ---

export function addModel(input: ModelInput, variant?: VariantInput): { ok: boolean; error?: string; modelId?: string } {
  const name = (input.name || '').trim();
  const endpoint = (input.endpoint || '').trim();
  if (!name) return { ok: false, error: 'Model name is required' };
  if (!endpoint) return { ok: false, error: 'Endpoint is required' };
  if (listModelRows().some(x => x.name === name)) return { ok: false, error: 'A model with that name already exists' };
  const now = Math.floor(Date.now() / 1000);
  const id = randomUUID();
  const maxSort = listModelRows().reduce((mx, x) => Math.max(mx, x.sort_order), -1);
  upsertModel({
    id, name, model: (input.model || '').trim(), endpoint,
    api_key: input.apiKey || null,
    context_window: input.contextWindow ?? null,
    max_tokens: input.maxTokens ?? null,
    sort_order: input.sortOrder ?? maxSort + 1,
    created_at: now, updated_at: now,
  });
  const v = variant || { name: 'Default' };
  upsertVariant({
    id: randomUUID(), model_id: id,
    name: (v.name || 'Default').trim() || 'Default',
    temperature: v.temperature ?? null,
    thinking_enabled: v.thinkingEnabled == null ? null : (v.thinkingEnabled ? 1 : 0),
    preserve_thinking: v.preserveThinking == null ? null : (v.preserveThinking ? 1 : 0),
    reasoning_effort: v.reasoningEffort || null,
    is_default: 1,
    sort_order: 0,
  });
  refreshModels();
  return { ok: true, modelId: id };
}

export function updateModel(id: string, input: ModelInput): { ok: boolean; error?: string } {
  const existing = listModelRows().find(x => x.id === id);
  if (!existing) return { ok: false, error: 'Model not found' };
  const newName = ((input.name !== undefined ? input.name : existing.name) || '').trim();
  const newEndpoint = ((input.endpoint !== undefined ? input.endpoint : existing.endpoint) || '').trim();
  if (!newName) return { ok: false, error: 'Model name is required' };
  if (!newEndpoint) return { ok: false, error: 'Endpoint is required' };
  if (listModelRows().some(x => x.name === newName && x.id !== id)) return { ok: false, error: 'A model with that name already exists' };
  // '' / undefined api key => keep the stored value
  const apiKey = (input.apiKey === undefined || input.apiKey === '') ? existing.api_key : (input.apiKey || null);
  upsertModel({
    id,
    name: newName,
    model: (input.model !== undefined ? input.model : existing.model) || '',
    endpoint: newEndpoint,
    api_key: apiKey,
    context_window: input.contextWindow !== undefined ? (input.contextWindow ?? null) : existing.context_window,
    max_tokens: input.maxTokens !== undefined ? (input.maxTokens ?? null) : existing.max_tokens,
    sort_order: input.sortOrder ?? existing.sort_order,
    created_at: existing.created_at,
    updated_at: Math.floor(Date.now() / 1000),
  });
  if (newName !== existing.name) renameModelRefs(existing.name, newName);
  refreshModels();
  return { ok: true };
}

/** Keep the active selection ref valid when a model is renamed. */
function renameModelRefs(oldName: string, newName: string): void {
  const fix = (s: string | undefined): string | undefined => {
    if (s === undefined) return undefined;
    if (s === oldName) return newName;
    if (s.startsWith(oldName + ' / ')) return s.replace(oldName + ' / ', newName + ' / ');
    return s;
  };
  const active = fix(getSetting('activeModel'));
  if (active !== undefined) setSetting('activeModel', active);
  config.activeModel = fix(config.activeModel);
}

export function deleteModel(id: string): { ok: boolean; error?: string } {
  if (!listModelRows().some(x => x.id === id)) return { ok: false, error: 'Model not found' };
  deleteModelRow(id); // cascades variants
  refreshModels();
  return { ok: true };
}

export function addVariant(modelId: string, input: VariantInput): { ok: boolean; error?: string; variantId?: string } {
  if (!listModelRows().some(x => x.id === modelId)) return { ok: false, error: 'Model not found' };
  const name = (input.name || '').trim();
  if (!name) return { ok: false, error: 'Variant name is required' };
  const variants = listVariantRows(modelId);
  if (variants.some(v => v.name === name)) return { ok: false, error: 'A variant with that name already exists' };
  const maxSort = variants.reduce((mx, v) => Math.max(mx, v.sort_order), -1);
  if (input.isDefault) clearVariantDefaults(modelId);
  const id = randomUUID();
  upsertVariant({
    id, model_id: modelId, name,
    temperature: input.temperature ?? null,
    thinking_enabled: input.thinkingEnabled == null ? null : (input.thinkingEnabled ? 1 : 0),
    preserve_thinking: input.preserveThinking == null ? null : (input.preserveThinking ? 1 : 0),
    reasoning_effort: input.reasoningEffort || null,
    is_default: input.isDefault ? 1 : 0,
    sort_order: input.sortOrder ?? maxSort + 1,
  });
  refreshModels();
  return { ok: true, variantId: id };
}

export function updateVariant(id: string, input: VariantInput): { ok: boolean; error?: string } {
  const existing = listVariantRows().find(v => v.id === id);
  if (!existing) return { ok: false, error: 'Variant not found' };
  const newName = ((input.name !== undefined ? input.name : existing.name) || '').trim();
  if (!newName) return { ok: false, error: 'Variant name is required' };
  if (listVariantRows(existing.model_id).some(v => v.name === newName && v.id !== id)) return { ok: false, error: 'A variant with that name already exists' };
  const isDefault = input.isDefault !== undefined ? (input.isDefault ? 1 : 0) : existing.is_default;
  if (isDefault) clearVariantDefaults(existing.model_id);
  upsertVariant({
    id,
    model_id: existing.model_id,
    name: newName,
    temperature: input.temperature !== undefined ? (input.temperature ?? null) : existing.temperature,
    thinking_enabled: input.thinkingEnabled !== undefined ? (input.thinkingEnabled == null ? null : (input.thinkingEnabled ? 1 : 0)) : existing.thinking_enabled,
    preserve_thinking: input.preserveThinking !== undefined ? (input.preserveThinking == null ? null : (input.preserveThinking ? 1 : 0)) : existing.preserve_thinking,
    reasoning_effort: input.reasoningEffort !== undefined ? (input.reasoningEffort || null) : existing.reasoning_effort,
    is_default: isDefault,
    sort_order: input.sortOrder ?? existing.sort_order,
  });
  refreshModels();
  return { ok: true };
}

export function deleteVariant(id: string): { ok: boolean; error?: string } {
  const existing = listVariantRows().find(v => v.id === id);
  if (!existing) return { ok: false, error: 'Variant not found' };
  deleteVariantRow(id);
  // Promote a remaining variant to default if none is marked default.
  const remaining = listVariantRows(existing.model_id);
  if (remaining.length > 0 && !remaining.some(v => v.is_default === 1)) {
    clearVariantDefaults(existing.model_id);
    upsertVariant({ ...remaining[0], is_default: 1 });
  }
  refreshModels();
  return { ok: true };
}

/**
 * One-time migration: reasoningEffort used to be a top-level (global) config
 * key. It is now per-model. If a legacy top-level value is present, apply it to
 * every model that does not set its own, then drop the global key.
 */
function migrateReasoningEffort(loaded: any): void {
  if (!loaded || typeof loaded !== 'object') return;
  const legacy = loaded.reasoningEffort;
  if (legacy === undefined) return;
  if (Array.isArray(loaded.models)) {
    for (const m of loaded.models) {
      if (m && typeof m === 'object' && m.reasoningEffort === undefined) {
        m.reasoningEffort = legacy;
      }
    }
  }
  delete loaded.reasoningEffort;
}

export function loadConfig(): Config {
  try {
    if (fs.existsSync(configPath)) {
      let raw = fs.readFileSync(configPath, 'utf-8');
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      const loaded = JSON.parse(raw);
      migrateReasoningEffort(loaded);
      config = {
        ...defaultConfig,
        ...loaded,
        models: Array.isArray(loaded.models) ? loaded.models : undefined,

        stt: { ...defaultConfig.stt, ...(loaded.stt || {}) },
        tts: { ...defaultConfig.tts, ...(loaded.tts || {}) },
        ui: { ...defaultConfig.ui, ...(loaded.ui || {}) },
        desktop: { ...defaultConfig.desktop, ...(loaded.desktop || {}) },
        contextManagement: { ...defaultConfig.contextManagement, ...(loaded.contextManagement || {}) },
        rawLLMLog: { ...defaultConfig.rawLLMLog, ...(loaded.rawLLMLog || {}) },
        subAgents: { ...defaultConfig.subAgents, ...(loaded.subAgents || {}) },
        observer: { ...defaultConfig.observer, ...(loaded.observer || {}) },
        uiAutomation: { ...defaultConfig.uiAutomation, ...(loaded.uiAutomation || {}) },
        shell: { ...defaultConfig.shell, ...(loaded.shell || {}) },
      };

      if (!activeModelName) {
        activeModelName = config.activeModel || getNamedModels()[0]?.name;
      }

      // Only seed the override from disk on first load. Runtime re-loads must
      // not clobber a live value set by the UI toggle.
      if (thinkingOverride === undefined && loaded.thinkingEnabled !== undefined) {
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

  // Hydrate the in-memory model list from the SQLite DB (seeds from config.json
  // on first run). This makes the DB the source of truth for model definitions.
  hydrateModelsFromDb();

  return config;
}

export function saveConfig(newConfig: Config): void {
  // Models are persisted in the SQLite DB — keep the DB-backed in-memory model
  // list and never write a stale flattened list back to config.json.
  const dbModels = config.models;
  config = newConfig;
  config.models = dbModels;
  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    const persisted: any = { ...newConfig };
    delete persisted.models;
    fs.writeFileSync(configPath, JSON.stringify(persisted, null, 2));
  } catch (err) {
    console.error('Failed to save config:', err);
  }
}

export function getConfig(): Config {
  return config;
}

/** Absolute path to the active YukiWeb config file (shown in tool errors). */
export function getConfigPath(): string {
  return configPath;
}

export function loadSystemPrompt(): string {
  try {
    if (fs.existsSync(systemPromptPath)) {
      // Normalise to LF so the prompt in the model context is consistent
      // regardless of the file's on-disk line endings (CRLF on Windows).
      return normalizeLineEndings(fs.readFileSync(systemPromptPath, 'utf-8'));
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
      return normalizeLineEndings(fs.readFileSync(voiceSystemPromptPath, 'utf-8'));
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

// --- Sub-Agent Config Accessors ---

export function getSubAgentConfig(): SubAgentConfig {
  return config.subAgents ?? defaultSubAgentConfig;
}

// --- Observer Config Accessors ---

export function getObserverConfig(): ObserverConfig {
  return config.observer ?? defaultObserverConfig;
}

export function getObserverModelConfig(): ModelConfig | undefined {
  const obsCfg = getObserverConfig();
  if (!obsCfg.enabled) return undefined;
  // If model is specified, look it up; otherwise return the active model config
  if (obsCfg.model && obsCfg.model.trim() !== '') {
    return getModelConfig(obsCfg.model);
  }
  // Use the same model as the active agent
  const activeName = getActiveModelName();
  return getModelConfig(activeName);
}

export function getObserverTimeoutMs(): number {
  return getObserverConfig().timeoutMs ?? 30000;
}
