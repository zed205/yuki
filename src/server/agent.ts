import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { WebSocket } from 'ws';
import { getConfig } from './config';
import { tools, toolDefinitions, planToolNames, truncateOutput } from './tools';
import { Message, ToolCall, Session, Plan, PlanStep, Attachment, ModelConfig } from '../shared/types';
import { planCreate, planUpdate, planGet, planRemove, getPlanSummary } from './plan';
import { getAgentModel, getActiveModelName, setActiveModelName, getBackupModelName, getNamedModels, loadVoiceSystemPrompt, getEffectiveThinking, getSubAgentConfig, getConfigPath } from './config';
import { getProject } from './project';
import { AudioPipeline } from './audio';
import { BrowserAutomation } from './browser';
import { DesktopAutomation } from './automation';
import { MCPManager } from './mcp';
import { logLLMRequestResponse } from './llm-logger';
import { Observer } from './observer';
import {
  calibrateFromUsage,
  capToolResult,
  estimateRequestTokens,
  estimateSessionTokens,
  isImageResult,
  projectedPromptTokens,
  requestChars,
  resolveCharsPerToken,
  textTokens,
} from './context-budget';
import { normalizeLineEndings, trimLineEndings } from './utils/line-endings';

export const SUMMARY_PREFIX = 'Summary of previous conversation:';

const SUMMARY_TEMPLATE = `Output exactly this Markdown structure and keep the section order unchanged:

---
## Goal

- [single-sentence task summary]

## Constraints & Preferences

- [user constraints, preferences, specs, or "(none)"]

## Accomplished

- [completed work or "(none)"]

### In Progress

- [current work or "(none)"]

### Blocked

- [blockers or "(none)"]

## Key Decisions

- [decision and why, or "(none)"]

## Next Steps

- [ordered next actions or "(none)"]

## Critical Context

- [important technical facts, errors, open questions, or "(none)"]

## Relevant Files

- [file or directory path: why it matters, or "(none)"]

---

Keep every section, even when empty.
Use terse bullets, not prose paragraphs.
Preserve exact file paths, commands, error strings, and identifiers when known.
Do not mention the summary process or that context was compacted.`;

const CREATE_ANCHOR = 'Create a new anchored summary from the conversation history above.';

/** Tools whose results are binary payloads â€” truncating them destroys the data. */
const IMAGE_RESULT_TOOLS = new Set([
  'desktop_screenshot', 'desktop_snapshot_region', 'desktop_viewport',
  'browser_screenshot', 'view_image',
]);

/**
 * Tools a sub-agent may not use. Spawning is excluded so agents cannot recurse,
 * plan/attachment tools are excluded because they operate on the parent's
 * session state rather than the sub-agent's own task.
 */
const SUBAGENT_TOOL_EXCLUSIONS = [
  'spawn_agent',
  'plan_create', 'plan_update', 'plan_get', 'plan_remove',
  'attachment_list', 'save_attached_file',
];

/** Process-wide count of running sub-agents, bounded by subAgents.maxAgentSlots. */
let activeSubAgentSlots = 0;

/**
 * Serializes work against a single stateful service (one browser page, one
 * desktop). Without it, concurrent sub-agents interleave navigate/click
 * sequences and end up acting on each other's page state.
 */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

function buildAnchor(prevSummary?: string): string {
  if (!prevSummary) return CREATE_ANCHOR;
  return [
    'Update the anchored summary below using the conversation history above.',
    'Preserve still-true details, remove stale details, and merge in the new facts.',
    '<previous-summary>',
    prevSummary,
    '</previous-summary>',
  ].join('\n');
}

/** Cost a stored message will contribute to a summarization request. */
function summaryEntryCost(m: Message, cpt: number, imageTokens: number, resultLimit: number): number {
  let total = textTokens(m.content, cpt) + textTokens(m.reasoningContent, cpt) + 8;
  for (const tc of m.toolCalls || []) {
    total += textTokens(JSON.stringify(tc.parameters ?? {}), cpt) + 8;
    if (tc.result) total += textTokens(capToolResult(tc.name, tc.parameters, tc.result, resultLimit), cpt);
  }
  if (m.attachments) total += m.attachments.filter(a => a.isImage).length * imageTokens;
  return total;
}

/** Split a summarization target into request-sized chunks, preserving order. */
function chunkByBudget(
  messages: Message[],
  maxTokens: number,
  cpt: number,
  imageTokens: number,
  resultLimit: number,
): Message[][] {
  const chunks: Message[][] = [];
  let current: Message[] = [];
  let total = 0;
  for (const m of messages) {
    const cost = summaryEntryCost(m, cpt, imageTokens, resultLimit);
    if (current.length > 0 && total + cost > maxTokens) {
      chunks.push(current);
      current = [];
      total = 0;
    }
    current.push(m);
    total += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function getSystemInfo(projectPath?: string): string {
  const maxChars = getConfig().maxToolOutputChars ?? 20000;
  const now = new Date();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateStr = `${months[now.getMonth()]} ${now.getFullYear()}`;
  const lines = [
    `Date: ${dateStr}`,
    `OS: ${os.version()} (${os.type()} ${os.release()})`,
    `Hostname: ${os.hostname()}`,
    `Username: ${os.userInfo().username}`,
    `Shell: ${process.env.SHELL || process.env.ComSpec || 'unknown'}`,
    `CWD: ${projectPath || process.cwd()}`,
    `${maxChars < 0 ? 'Tool output size control is disabled (maxToolOutputChars=-1).' : maxChars === 0 ? 'Tool outputs are written to disk with no inline preview (maxToolOutputChars=0).' : `Tool outputs for web_fetch and shell are capped at ${maxChars} chars. Overflow is saved to disk; use read(..., offset, limit) where offset and limit are line numbers to page through output.`}`,
    `The read tool always returns content inline (independent of maxToolOutputChars), capped at ${getConfig().maxReadLines ?? 200} lines and ${getConfig().maxReadChars ?? 20000} chars per call, with line numbers ${getConfig().readNumbered ?? true ? 'enabled' : 'disabled'}. Use offset/limit to page through larger files.`,
  ];
  return lines.join('\n');
}

export class Agent {
  private audioPipeline: AudioPipeline | null = null;
  private browser: BrowserAutomation | null = null;
  private desktop: DesktopAutomation | null = null;
  private mcp: MCPManager | null = null;
  private cancelled = false;
  private running = false;
  private pendingSteers: string[] = [];
  private abortController: AbortController | null = null;
  private disabledTools: Set<string> = new Set();
  private observer: Observer | null = null;
  private observerTurnCount = 0;
  currentProjectPath: string = '';
  currentModelName: string = '';
  private openai: OpenAI | null = null;
  private lastRequestChars = 0;
  private toolDefsChars: number | null = null;
  private currentWs: WebSocket | null = null;
  // Shared stateful services: serialize them across concurrent sub-agents.
  private readonly browserMutex = new Mutex();
  private readonly desktopMutex = new Mutex();

  setToolEnabled(name: string, enabled: boolean) {
    if (enabled) {
      this.disabledTools.delete(name);
    } else {
      this.disabledTools.add(name);
    }
  }

  initToolDefaults() {
    const cfg = getConfig();
    this.disabledTools = new Set(cfg.disabledTools || []);
  }

  stop() {
    this.cancelled = true;
    this.abortController?.abort();
  }
  /** True while a chat turn (including steered continuations) is in flight. */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Queue a steering message for the in-flight turn (codex-style). The steer
   * is drained before the next LLM call in the current turn, so the model can
   * interrupt/redirect mid-task. Only call this while isRunning is true;
   * otherwise route to chat() as a normal new turn.
   */
  steer(text: string): void {
    this.pendingSteers.push(text);
    console.log(`[agent] steer queued (${text.length} chars): ${text.slice(0, 80)}`);
  }

  /** Evaluate observer feedback and inject it if significant enough. Returns true if feedback was injected. */
  private async getObserverFeedback(
    messages: Array<Record<string, any>>,
    ws: WebSocket,
    session: Session,
    iterations: number,
  ): Promise<boolean> {
    const obsCfg = getConfig().observer;
    console.log('[observer] getObserverFeedback called, enabled=%s, mode=%s, iter=%d', obsCfg?.enabled, obsCfg?.mode, iterations);
    if (!obsCfg?.enabled) return false;

    // Check if observer should run this turn
    if (obsCfg.mode === 'periodic' && (iterations % obsCfg.interval!) !== 0) {
      console.log('[observer] skipped (periodic, iter %d mod %d != 0)', iterations, obsCfg.interval);
      return false;
    }
    console.log('[observer] proceeding to evaluate');

    // Build tool results map from messages (tool responses are in the messages array)
    const toolResults = new Map<string, string>();
    for (const msg of messages) {
      if (msg.role === 'tool' && msg.tool_call_id) {
        toolResults.set(msg.tool_call_id, msg.content || '');
      }
    }

    try {
      if (!this.observer) {
        this.observer = new Observer();
      }

      // Get feedback from observer
      const feedback = await this.observer.evaluate(
        session.messages,
        toolResults,
        session.id,
      );

      // Skip if confidence is too low
      if (feedback.confidence < (obsCfg.minConfidence ?? 0.5)) {
        return false;
      }

      // Format feedback for injection
      const feedbackText = this.formatFeedbackForObserver(feedback);
      if (!feedbackText || feedbackText.trim() === '') {
        return false;
      }

      // Send feedback to client for visibility
      this.sendToClient(ws, 'observer:feedback', {
        feedback,
        sessionId: session.id,
      });

      // Inject feedback into the messages array (as a system message)
      const feedbackMsg: Record<string, any> = {
        role: 'system',
        content: feedbackText,
      };
      messages.push(feedbackMsg);
      session.messages.push({
        id: `obs_${session.id}_${iterations}`,
        role: 'system',
        content: feedbackText,
        timestamp: new Date(),
        sessionId: session.id,
        pruned: true, // Mark as pruned so it doesn't accumulate in history
      });

      console.log(`[observer] feedback injected: ${feedback.status} (confidence: ${feedback.confidence})`);
      return true;
    } catch (err: any) {
      console.error(`[observer] evaluation failed: ${err.message}`);
      return false;
    }
  }

  /** Format observer feedback for injection into the agent context. */
  private formatFeedbackForObserver(feedback: { status: string; concern?: string | undefined | null; suggestion?: string | undefined | null; confidence: number }): string {
    if (!feedback.concern && !feedback.suggestion) return '';

    let block = '\n\n## Observer Feedback\n';
    block += `**Assessment**: ${feedback.status}\n`;
    if (feedback.concern) {
      block += `**Concern**: ${feedback.concern}\n`;
    }
    if (feedback.suggestion) {
      block += `**Suggestion**: ${feedback.suggestion}\n`;
    }
    block += `Accept this feedback and adjust your approach accordingly.\n`;
    return block;
  }


  setServices(
    audio: AudioPipeline,
    browser: BrowserAutomation,
    desktop: DesktopAutomation,
    mcp?: MCPManager,
  ) {
    this.audioPipeline = audio;
    this.browser = browser;
    this.desktop = desktop;
    this.mcp = mcp || null;
  }

  private currentAttachments: Attachment[] = [];

  async chat(
    userMessage: string,
    session: Session,
    ws: WebSocket,
    images: string[] = [],
    attachments: Attachment[] = [],
  ): Promise<void> {
    this.cancelled = false;
    this.running = true;
    this.pendingSteers = [];
    this.currentAttachments = attachments || [];
    this.currentWs = ws;
    this.abortController = new AbortController();
    const config = { ...getConfig() };
    let systemPrompt = session.messages.find(m => m.role === 'system' && !this.isSummaryMessage(m))?.content || '';
    if (session.voiceMode) {
      systemPrompt = loadVoiceSystemPrompt();
    }

    const project = getProject(session.projectId || 'default');
    this.currentProjectPath = project?.path || '';

    // Compact if conversation exceeds threshold
    const cm = config.contextManagement;
    if (cm?.enabled) {
      await this.compactIfOverBudget(session, config, ws);
    }

    let messages = this.buildRequestMessages(session, config, userMessage, images, systemPrompt);

    let iterations = 0;
    let hasToolCalls = true;
    let midTurnCompactions = 0;
    // The "current" user message for request rebuilds (compaction). Normally
    // the original user message, but a steer replaces it so post-compaction
    // rebuilds replay the steer, not the stale original.
    let turnUserMessage = userMessage;
    let turnImages = images;
    const cfgIter = getConfig().maxToolIterations;
    const maxIterations = cfgIter === -1 ? Infinity : (cfgIter || 10);

    while (hasToolCalls && iterations < maxIterations) {
      if (this.cancelled) {
        console.log('[agent] cancelled before iter, returning');
        this.running = false;
        this.pendingSteers = [];
        this.cancelled = false;
        return;
      }

      // Drain steering messages queued while the model was working. The steer
      // becomes the new tail user message so the next LLM call redirects the
      // in-flight task (codex-style).
      if (this.pendingSteers.length > 0) {
        const steerText = this.pendingSteers.join('\n\n');
        this.pendingSteers = [];
        const steerMsg: Message = {
          id: this.generateId(),
          role: 'user',
          content: steerText,
          timestamp: new Date(),
          sessionId: session.id,
        };
        session.messages.push(steerMsg);
        messages.push({ role: 'user', content: `## Current Plan\n${getPlanSummary(session.id)}\n\n${steerText}` });
        turnUserMessage = steerText;
        turnImages = [];
        console.log(`[agent] steer injected into turn (${steerText.length} chars)`);
      }

      // Context is re-checked every iteration, not just once per user turn: a
      // single long tool loop can otherwise grow the prompt past the window.
      const guard = midTurnCompactions < 2
        ? await this.enforceContextBudget(messages, session, config, ws, turnUserMessage, turnImages, systemPrompt)
        : 'ok';
      if (guard === 'halt') {
        session.updatedAt = new Date();
        this.running = false;
        this.pendingSteers = [];
        return;
      }
      if (guard === 'compacted') {
        midTurnCompactions++;
        messages = this.buildRequestMessages(session, config, turnUserMessage, turnImages, systemPrompt);
        continue;
      }

      iterations++;
      const streamMsgId = this.generateId();

      this.lastRequestChars = requestChars(messages) + this.toolDefsOverheadChars();

      let response;
      try {
        response = await this.callLLM(messages, config, this.abortController?.signal,
          (thinkingChunk) => this.sendToClient(ws, 'thinking:chunk', { chunk: thinkingChunk, messageId: streamMsgId, sessionId: session.id }),
          (contentChunk) => this.sendToClient(ws, 'chat:chunk', { chunk: contentChunk, messageId: streamMsgId, sessionId: session.id }),
          undefined, session.id, session.disabledTools,
        );
      } catch (llmErr: any) {
        const backupName = getBackupModelName();
        if (backupName && backupName !== getActiveModelName()) {
          console.log(`[agent] primary model failed, falling back to backup: ${backupName}`);
          setActiveModelName(backupName);
          this.openai = null;
          response = await this.callLLM(messages, config, this.abortController?.signal,
            (thinkingChunk) => this.sendToClient(ws, 'thinking:chunk', { chunk: thinkingChunk, messageId: streamMsgId, sessionId: session.id }),
            (contentChunk) => this.sendToClient(ws, 'chat:chunk', { chunk: contentChunk, messageId: streamMsgId, sessionId: session.id }),
            undefined, session.id, session.disabledTools,
          );
        } else {
          response = { content: `Error calling LLM: ${llmErr.message}`, toolCalls: undefined, reasoningContent: '', usage: undefined };
        }
      }

      console.log(`[agent] iter=${iterations} hasToolCalls=${!!(response.toolCalls && response.toolCalls.length > 0)} contentLen=${response.content?.length || 0} toolCount=${response.toolCalls?.length || 0}`);

      if (response.usage?.promptTokens) {
        const before = session.charsPerToken;
        calibrateFromUsage(session, response.usage.promptTokens, this.lastRequestChars);
        const cpt = resolveCharsPerToken(session, config);
        console.log(
          `[agent] context: actual=${response.usage.promptTokens} est=${Math.round(this.lastRequestChars / cpt)} ` +
          `chars/token=${cpt.toFixed(2)} (was ${before ? before.toFixed(2) : 'n/a'})`,
        );
        this.sendContextUpdate(ws, response.usage.promptTokens, getAgentModel().contextWindow || 64000);
      }

      if (this.cancelled) {
        console.log('[agent] cancelled after callLLM, returning');
        this.running = false;
        this.pendingSteers = [];
        this.cancelled = false;
        return;
      }

      hasToolCalls = !!(response.toolCalls && response.toolCalls.length > 0);

      if (hasToolCalls && response.toolCalls) {
        const toolCalls = response.toolCalls;

        const assistantMsg: Message = {
          id: streamMsgId,
          role: 'assistant',
          content: response.content || '',
          timestamp: new Date(),
          toolCalls,
          reasoningContent: response.reasoningContent || '',
          sessionId: session.id,
        };

        this.sendToClient(ws, 'chat:response', {
          message: assistantMsg.content,
          reasoningContent: response.reasoningContent || '',
          toolCalls,
          messageId: streamMsgId,
          sessionId: session.id,
        });

        // Execute first, record second: a spawn-only batch runs concurrently,
        // but the transcript is still built in the model's original tool order
        // so every tool message keeps a valid tool_call_id pairing.
        const results = await this.runToolBatch(toolCalls, ws, session.id);

        for (let ti = 0; ti < toolCalls.length; ti++) {
          const toolCall = toolCalls[ti];
          toolCall.result = results[ti].result;
          toolCall.status = results[ti].status;

          if (planToolNames.includes(toolCall.name)) {
            const plan = planGet(session.id);
            this.sendToClient(ws, 'plan:updated', {
              plan: plan ? { title: plan.title, steps: plan.steps.map(s => ({ id: s.id, description: s.description, status: s.status })) } : null,
            });
          }

          const assistEntry: Record<string, any> = {
            role: 'assistant',
            content: response.content || '',
            tool_calls: [
              {
                id: toolCall.id,
                type: 'function',
                function: {
                  name: toolCall.name,
                  arguments: JSON.stringify(toolCall.parameters),
                },
              },
            ],
          };
          if (response.reasoningContent) {
            assistEntry.reasoning_content = response.reasoningContent;
          }
          messages.push(assistEntry);

          if ((toolCall.name === 'desktop_screenshot' || toolCall.name === 'desktop_snapshot_region') && toolCall.status === 'completed') {
            messages.push({
              role: 'user',
              content: buildMultimodalContent('Here is the desktop screenshot I captured:', [`data:image/png;base64,${toolCall.result}`]),
            });
          } else {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: this.contextToolResult(toolCall, config),
            });
          }
          this.sendContextUpdate(ws, this.estimateSessionTokens(session, config), getAgentModel().contextWindow || 64000);
        }

        session.messages.push(this.forStorage(assistantMsg, config));
        this.sendContextUpdate(ws, this.estimateSessionTokens(session, config), getAgentModel().contextWindow || 64000);

        // Run observer evaluation if enabled
        try {
          await this.getObserverFeedback(messages, ws, session, iterations);
        } catch (obsErr) {
          console.error('[agent] observer error (non-fatal):', obsErr);
        }

        if (this.cancelled) {
          console.log('[agent] cancelled after tool execution, returning');
          this.running = false;
          this.pendingSteers = [];
          this.cancelled = false;
          return;
        }
      } else {
        const content = response.content || '';
        const reasoning = response.reasoningContent || '';
        // If the user steered while we were composing this final answer, flag
        // the response so the client knows the turn is NOT over.
        const steerPending = this.pendingSteers.length > 0;

        // If model generated only reasoning with no visible content, surface it
        if (!content && !reasoning) {
          // Completely empty response â€” send fallback instead of breaking silently
          this.sendToClient(ws, 'chat:response', {
            message: '[The model returned an empty response. This may indicate the thinking budget exhausted available tokens before generating visible output.]',
            reasoningContent: '',
            toolCalls: undefined,
            messageId: streamMsgId,
            sessionId: session.id,
            continuing: steerPending,
          });
          session.messages.push({
            id: streamMsgId,
            role: 'assistant',
            content: '[Empty response â€” likely ran out of token budget during thinking.]',
            timestamp: new Date(),
            sessionId: session.id,
          });
          this.sendContextUpdate(ws, this.estimateSessionTokens(session, config), getAgentModel().contextWindow || 64000);
        } else if (!content && reasoning) {
          this.sendToClient(ws, 'chat:response', {
            message: reasoning,
            reasoningContent: reasoning,
            toolCalls: undefined,
            messageId: streamMsgId,
            sessionId: session.id,
            continuing: steerPending,
          });
          session.messages.push({
            id: streamMsgId,
            role: 'assistant',
            content: reasoning,
            reasoningContent: reasoning,
            timestamp: new Date(),
            sessionId: session.id,
          });
          this.sendContextUpdate(ws, this.estimateSessionTokens(session, config), getAgentModel().contextWindow || 64000);
        } else {
          const assistantMsg: Message = {
            id: streamMsgId,
            role: 'assistant',
            content,
            timestamp: new Date(),
            reasoningContent: reasoning,
            sessionId: session.id,
          };

          this.sendToClient(ws, 'chat:response', {
            message: content,
            reasoningContent: reasoning,
            toolCalls: undefined,
            messageId: streamMsgId,
            sessionId: session.id,
            continuing: steerPending,
          });

          session.messages.push(assistantMsg);
          this.sendContextUpdate(ws, this.estimateSessionTokens(session, config), getAgentModel().contextWindow || 64000);
        }
        // Steering: if the user sent a message while we were composing this
        // final answer, don't end the turn - hand the answer + steer back to
        // the model so it can redirect (codex-style). The answer payload
        // above already carried continuing:true, so the client kept waiting.
        if (steerPending) {
          const steerText = this.pendingSteers.join('\n\n');
          this.pendingSteers = [];

          messages.push({ role: 'assistant', content: content || reasoning || '[empty response]' });
          const steerMsg: Message = {
            id: this.generateId(),
            role: 'user',
            content: steerText,
            timestamp: new Date(),
            sessionId: session.id,
          };
          session.messages.push(steerMsg);
          messages.push({ role: 'user', content: `## Current Plan\n${getPlanSummary(session.id)}\n\n${steerText}` });
          turnUserMessage = steerText;
          turnImages = [];

          this.sendContextUpdate(ws, this.estimateSessionTokens(session, config), getAgentModel().contextWindow || 64000);

          iterations = 0;
          midTurnCompactions = 0;
          hasToolCalls = true;
          continue;
        }
        break;
      }
    }

    if (hasToolCalls) {
      console.log(`[agent] hit maxToolIterations (${cfgIter})`);
      this.sendToClient(ws, 'chat:response', {
        message: `I reached the maximum number of tool call iterations (${cfgIter}). If you need me to continue, please let me know.`,
        reasoningContent: '',
        messageId: '',
        sessionId: session.id,
      });
    }

    session.updatedAt = new Date();
    this.running = false;
    this.pendingSteers = [];
  }

  resetClient(): void {
    this.openai = null;
  }

  private getOpenAI(modelName?: string): OpenAI {
    const target = modelName || getActiveModelName() || this.currentModelName;
    const agentCfg = getAgentModel(target);
    if (!this.openai || this.currentModelName !== target) {
      this.currentModelName = target;
      this.openai = new OpenAI({
        baseURL: agentCfg.endpoint,
        apiKey: agentCfg.apiKey || '',
      });
    }
    return this.openai;
  }


  private async callLLM(
    messages: Array<Record<string, any>>,
    config: any,
    signal?: AbortSignal,
    onThinkingChunk?: (chunk: string) => void,
    onContentChunk?: (chunk: string) => void,
    modelName?: string,
    sessionId?: string,
    sessionDisabledTools?: string[],
    extraToolExclusions?: string[],
    maxOutputTokens?: number,
  ): Promise<{ content: string; toolCalls?: ToolCall[]; reasoningContent?: string; usage?: { promptTokens: number } }> {
    const startTime = Date.now();
    const requestBody: Record<string, any> = { messages };

    const targetModel = modelName || getActiveModelName() || this.currentModelName;
    const openai = this.getOpenAI(targetModel);

    const agentCfg = getAgentModel(targetModel);
    const logMeta = {
      modelName: getActiveModelName() || this.currentModelName || undefined,
      openaiClientModel: this.currentModelName || undefined,
      sessionId: sessionId || undefined,
    };
    const createParams: Record<string, any> = {
      model: agentCfg.model,
      messages: messages as any,
      max_tokens: maxOutputTokens ?? (agentCfg.maxTokens === -1 ? undefined : (agentCfg.maxTokens || 8000)),
      ...(agentCfg.temperature !== undefined ? { temperature: agentCfg.temperature } : {}),
      stream: true,
    };

    if (toolDefinitions.length > 0) {
      // Combine agent-level disabled tools (from config) with session-level disabled tools
      const sessionDisabled = new Set(sessionDisabledTools || []);
      const combinedDisabled = new Set([...this.disabledTools, ...sessionDisabled, ...(extraToolExclusions || [])]);
      const subCfg = getSubAgentConfig();
      const subAgentsEnabled = subCfg.enabled === true;
      const maxSubAgents = Math.max(1, Math.floor(subCfg.maxAgentSlots || 1));
      let enabledTools = toolDefinitions.filter(t => {
        const name = t.function.name;
        if (combinedDisabled.has(name)) return false;
        // spawn_agent is only offered while sub-agents are enabled in config.
        if (name === 'spawn_agent' && !subAgentsEnabled) return false;
        return true;
      }).map(t => {
        if (t.function.name !== 'spawn_agent') return t;
        return {
          ...t,
          function: {
            ...t.function,
            description: `${t.function.description} Up to ${maxSubAgents} sub-agent(s) may run at the same time. Independent spawn_agent calls emitted in the SAME response run in parallel; calls beyond ${maxSubAgents} in one response are rejected, so batch at most ${maxSubAgents} per response.`,
          },
        };
      });
      const mcpDefs = this.mcp?.getToolDefinitions() || [];
      if (mcpDefs.length > 0) {
        enabledTools = enabledTools.concat(mcpDefs);
      }
      if (enabledTools.length > 0) {
        createParams.tools = enabledTools as any;
        createParams.tool_choice = 'auto';
      }
    }

    const thinkingEnabled = getEffectiveThinking(targetModel);
    if (thinkingEnabled) {
      const kwargs: Record<string, any> = { enable_thinking: true, preserve_thinking: agentCfg.preserveThinking ?? true };
      if (agentCfg.reasoningEffort) {
        kwargs.reasoning_effort = agentCfg.reasoningEffort;
      }
      createParams.chat_template_kwargs = kwargs;
    } else {
      createParams.chat_template_kwargs = { enable_thinking: false };
    }
    Object.assign(requestBody, createParams);
    delete requestBody.stream;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.llmTimeoutMs ?? 180000);

    let fullContent = '';
    let fullReasoning = '';
    let onAbort: (() => void) | null = null;
    if (signal) {
      onAbort = () => controller.abort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
    let sawToolCall = false;
    const toolCallAccumulators: Map<string, { id: string; name: string; arguments: string }> = new Map();
    let usageResult: { promptTokens: number } | undefined;

    try {
      const stream = await openai.chat.completions.create(createParams as any, {
        signal: controller.signal,
      }) as any;

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if ((delta as any).reasoning_content) {
          const rc = (delta as any).reasoning_content;
          fullReasoning += rc;
          if (onThinkingChunk) onThinkingChunk(rc);
        }

        if (delta.content && !sawToolCall) {
          fullContent += delta.content;
          if (onContentChunk) onContentChunk(delta.content);
        }

        if (delta.tool_calls) {
          sawToolCall = true;
          for (const tc of delta.tool_calls) {
            const key = String(tc.index);
            if (!toolCallAccumulators.has(key)) {
              toolCallAccumulators.set(key, { id: tc.id || `call_${key}`, name: tc.function?.name || '', arguments: '' });
            }
            const acc = toolCallAccumulators.get(key)!;
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) acc.arguments += tc.function.arguments;
          }
        }

        if (chunk.usage) {
          usageResult = { promptTokens: chunk.usage.prompt_tokens ?? 0 };
        }
      }

    const toolCalls: ToolCall[] = [];
    for (const acc of toolCallAccumulators.values()) {
      toolCalls.push({
        id: acc.id,
        name: acc.name,
        parameters: this.parseFunctionArgs(acc.arguments),
        status: 'pending',
      });
    }

    if (toolCalls.length > 0 && fullContent) {
      fullContent = fullContent.replace(/<function>[\s\S]*?<\/function>/gi, '').replace(/<\/?function>/gi, '');
    }

    const result = { content: fullContent, reasoningContent: fullReasoning, toolCalls: toolCalls.length > 0 ? toolCalls : undefined, usage: usageResult };
    logLLMRequestResponse(requestBody, result, Date.now() - startTime, undefined, logMeta);
    return result;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
      const errMsg = `${err.name || err.message}${err.name === 'AbortError' ? ` (timeout=${config.llmTimeoutMs}ms)` : ''}`;
      console.error(`callLLM error: ${errMsg}`);
      logLLMRequestResponse(requestBody, { content: '' }, Date.now() - startTime, err.message, logMeta);
      throw err;
    } finally {
      clearTimeout(timeoutId);
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
    }
  }

  // Tools that bypass truncation (return small/bounded output or need raw content)
  private readonly _whitelistTools = new Set([
    'read', 'write', 'edit', 'patch',
    'browser_navigate', 'browser_click', 'browser_fill', 'browser_screenshot',
    'browser_get_content', 'browser_get_links',
    'desktop_screenshot', 'desktop_viewport',
    'desktop_click', 'desktop_type', 'desktop_move', 'desktop_drag', 'desktop_scroll', 'desktop_keypress',
    'desktop_snapshot_region',
    'memory_save', 'memory_read', 'memory_list', 'memory_delete',
    'skill_list', 'skill_load', 'skill_save', 'skill_delete',
    'plan_create', 'plan_update', 'plan_get', 'plan_remove',
    'attachment_list', 'save_attached_file',
    'web_search', 'view_image',
  ]);

  private _truncateOrReturn(content: string, maxChars: number, label: string): string {
    const toolName = label.split(':')[0].trim();
    if (this._whitelistTools.has(toolName)) return content;
    return truncateOutput(content, maxChars, label);
  }

  /**
   * Execute one assistant turn's tool calls.
   *
   * A batch made up entirely of spawn_agent calls is dispatched concurrently so
   * several sub-agents can work at once (bounded by subAgents.maxAgentSlots).
   * Every other batch stays sequential â€” writeâ†’edit or navigateâ†’click depend on
   * the previous call having finished, and running them at once would change
   * their meaning.
   *
   * Announcements go out up front (so every pending bubble appears at once),
   * and results are returned in the model's original order.
   */
  private async runToolBatch(
    toolCalls: ToolCall[],
    ws: WebSocket,
    sessionId?: string,
  ): Promise<Array<{ result: string; status: 'completed' | 'error' }>> {
    for (const toolCall of toolCalls) {
      toolCall.status = 'running';
      this.sendToClient(ws, 'tool:call', { toolCall });
    }

    const executeOne = async (toolCall: ToolCall) => {
      let result: string;
      let status: 'completed' | 'error';
      try {
        result = await this.executeTool(toolCall, sessionId);
        status = 'completed';
      } catch (err: any) {
        result = `Error: ${err.message}`;
        status = 'error';
      }
      toolCall.result = result;
      toolCall.status = status;
      // Emit as each call finishes so sequential batches still update
      // progressively instead of all at once at the end.
      this.sendToClient(ws, 'tool:result', {
        toolCallId: toolCall.id,
        result,
        status,
      });
      return { result, status };
    };

    const parallelizable = toolCalls.length > 1
      && toolCalls.every(tc => tc.name === 'spawn_agent');
    if (!parallelizable) {
      const sequential: Array<{ result: string; status: 'completed' | 'error' }> = [];
      for (const toolCall of toolCalls) {
        sequential.push(await executeOne(toolCall));
      }
      return sequential;
    }
    return Promise.all(toolCalls.map(executeOne));
  }

  /**
   * Route calls that drive a single shared service through its mutex so
   * concurrent sub-agents cannot interleave browser/desktop actions.
   */
  private async executeTool(toolCall: ToolCall, sessionId?: string): Promise<string> {
    const name = toolCall.name.toLowerCase();
    if (name.startsWith('browser_')) {
      return this.browserMutex.run(() => this.executeToolInner(toolCall, sessionId));
    }
    if (name.startsWith('desktop_')) {
      return this.desktopMutex.run(() => this.executeToolInner(toolCall, sessionId));
    }
    return this.executeToolInner(toolCall, sessionId);
  }

  private async executeToolInner(toolCall: ToolCall, sessionId?: string): Promise<string> {
    const toolName = toolCall.name.toLowerCase();
    const params = toolCall.parameters;

    if (this.mcp && this.mcp.isMCPTool(toolCall.name)) {
      const result = await this.mcp.callTool(toolCall.name, params);
      return result ?? `Unknown tool: ${toolCall.name}`;
    }

    switch (toolName) {
      case 'plan_create':
        if (!sessionId) return 'Error: no active session';
        return JSON.stringify(planCreate(sessionId, params.title, params.steps), null, 2);
      case 'plan_update':
        if (!sessionId) return 'Error: no active session';
        return JSON.stringify(planUpdate(sessionId, params.stepIndex, params.status), null, 2);
      case 'plan_get':
        if (!sessionId) return 'Error: no active session';
        return getPlanSummary(sessionId);
      case 'plan_remove':
        if (!sessionId) return 'Error: no active session';
        return planRemove(sessionId) ? 'Plan removed.' : 'No active plan to remove.';
      case 'read':
        return await tools.read(params.filePath, params.offset, params.limit);
      case 'write':
        return await tools.write(params.filePath, params.content);
      case 'edit':
        return await tools.editFile(params.filePath, params.oldString, params.newString);
      case 'patch':
        return await tools.patchFile(params.filePath, params.patch);
      case 'glob':
        {
          const result = await tools.glob(params.pattern, params.rootDir);
          const maxChars = getConfig().maxToolOutputChars ?? 20000;
          return this._truncateOrReturn(result, maxChars, `glob: ${params.pattern}`);
        }
      case 'grep':
        {
          const result = await tools.grep(params.pattern, params.rootDir, params.include);
          const maxChars = getConfig().maxToolOutputChars ?? 20000;
          return this._truncateOrReturn(result, maxChars, `grep: ${params.pattern}`);
        }
      case 'shell':
        {
          const result = await tools.shell(params.command, params.cwd || this.currentProjectPath || undefined);
          const maxChars = getConfig().maxToolOutputChars ?? 20000;
          return this._truncateOrReturn(result, maxChars, `shell: ${params.command}`);
        }
      case 'browser_navigate':
        if (!this.browser) return 'Browser not initialized';
        return await this.browser.navigate(params.url);
      case 'browser_click':
        if (!this.browser) return 'Browser not initialized';
        return await this.browser.click(params.selector);
      case 'browser_fill':
        if (!this.browser) return 'Browser not initialized';
        return await this.browser.fill(params.selector, params.value);
      case 'browser_screenshot':
        if (!this.browser) return 'Browser not initialized';
        return await this.browser.screenshot();
      case 'browser_get_content':
        if (!this.browser) return 'Browser not initialized';
        return await this.browser.getPageContent();
      case 'browser_get_links':
        if (!this.browser) return 'Browser not initialized';
        return await this.browser.getLinks();
      case 'browser_evaluate_js':
        if (!this.browser) return 'Browser not initialized';
        return await this.browser.evaluateJs(params.script);
      case 'browser_xpath':
        if (!this.browser) return 'Browser not initialized';
        return await this.browser.xpath(params.xpath);
      case 'browser_scroll':
        if (!this.browser) return 'Browser not initialized';
        return await this.browser.scroll(params.direction, params.amount);
      case 'browser_wait_for':
        if (!this.browser) return 'Browser not initialized';
        return await this.browser.waitFor(params.condition, params.timeout);
      case 'browser_select':
        if (!this.browser) return 'Browser not initialized';
        return await this.browser.selectOption(params.selector, params.value, params.label, params.index);
      case 'browser_get_visible_elements':
        if (!this.browser) return 'Browser not initialized';
        return await this.browser.getVisibleElements();
      case 'browser_get_ax_tree':
        if (!this.browser) return 'Browser not initialized';
        return await this.browser.getAccessibilityTree();
      case 'browser_get_react_tree':
        if (!this.browser) return 'Browser not initialized';
        return await this.browser.getReactComponentTree();
      case 'browser_hover':
        if (!this.browser) return 'Browser not initialized';
        return await this.browser.hover(params.selector);
      case 'browser_click_xpath':
        if (!this.browser) return 'Browser not initialized';
        return await this.browser.clickXPath(params.xpath);
      case 'browser_extract_content':
        if (!this.browser) return 'Browser not initialized';
        return await this.browser.extractContent(params.selector, params.options);
      case 'browser_get_page_structure':
        if (!this.browser) return 'Browser not initialized';
        return await this.browser.getPageStructure();
      case 'browser_scroll_to':
        if (!this.browser) return 'Browser not initialized';
        return await this.browser.scrollToElement(params.selector);
      case 'browser_wait_for_selector':
        if (!this.browser) return 'Browser not initialized';
        return await this.browser.waitForSelector(params.selector, params.timeout);
      case 'desktop_screenshot':
        if (!this.desktop) return 'Desktop automation not initialized';
        return await this.desktop.getScreenshotBase64();
      case 'desktop_click':
        if (!this.desktop) return 'Desktop automation not initialized';
        return await this.desktop.mouseClick(params.x, params.y);
      case 'desktop_type':
        if (!this.desktop) return 'Desktop automation not initialized';
        return await this.desktop.keyboardInput(params.text);
      case 'desktop_move':
        if (!this.desktop) return 'Desktop automation not initialized';
        return await this.desktop.mouseMove(params.x, params.y);
      case 'desktop_drag':
        if (!this.desktop) return 'Desktop automation not initialized';
        return await this.desktop.mouseDrag(params.x, params.y, params.button);
      case 'desktop_scroll':
        if (!this.desktop) return 'Desktop automation not initialized';
        return await this.desktop.scroll(params.clicks);
      case 'desktop_keypress':
        if (!this.desktop) return 'Desktop automation not initialized';
        return await this.desktop.keyPress(params.key);
      case 'desktop_viewport':
        if (!this.desktop) return 'Desktop automation not initialized';
        return JSON.stringify(await this.desktop.getViewport());
      case 'desktop_snapshot_region':
        if (!this.desktop) return 'Desktop automation not initialized';
        return await this.desktop.screenshotRegion(params.left, params.top, params.width, params.height);
      case 'web_search':
        return await tools.webSearch(params.query, params.numResults);
      case 'web_fetch':
        {
          const result = await tools.webFetch(params.url, params.format);
          const maxChars = getConfig().maxToolOutputChars ?? 20000;
          return this._truncateOrReturn(result, maxChars, `web_fetch: ${params.url}`);
        }
      case 'memory_save':
        return await tools.memorySave(params.key, params.value);
      case 'memory_read':
        return await tools.memoryRead(params.key);
      case 'memory_list':
        return await tools.memoryList();
      case 'memory_delete':
        return await tools.memoryDelete(params.key);
      case 'skill_list':
        return await tools.skillList();
      case 'skill_load':
        return await tools.skillLoad(params.name);
      case 'skill_save':
        return await tools.skillSave(params.name, params.description, params.instructions);
      case 'skill_delete':
        return await tools.skillDelete(params.name);
      case 'attachment_list':
        return this.listAttachments();
      case 'save_attached_file':
        return await this.saveAttachedFile(params.index, params.filename);
      case 'view_image':
        return await tools.view_image(params.filePath, this.currentProjectPath || undefined);
      case 'spawn_agent':
        return await this.spawnSubAgent(params, sessionId);
      default:
        return `Unknown tool: ${toolCall.name}`;
    }
  }

  private sendAgentEvent(ws: WebSocket | null, type: string, data: any): void {
    if (!ws) return;
    this.sendToClient(ws, type, data);
  }

  /**
   * Run the `spawn_agent` tool. Enforces the configured slot limit and reports
   * the whole lifecycle to the client so it can render a dedicated agent bubble.
   */
  private async spawnSubAgent(params: Record<string, any>, sessionId?: string): Promise<string> {
    const cfg = getSubAgentConfig();
    if (!cfg.enabled) {
      return 'Error: sub-agents are not enabled for this session.';
    }
    if (!sessionId) {
      // The only caller without a session is a sub-agent itself.
      return 'Error: sub-agents are not allowed to spawn other sub-agents.';
    }

    const maxSlots = Math.max(1, Math.floor(cfg.maxAgentSlots || 1));
    if (activeSubAgentSlots >= maxSlots) {
      // Model-facing text stays purely behavioral: the model cannot change
      // server flags or edit config.json. Operator sizing guidance is logged
      // to the console instead, where the human reads it.
      console.warn(
        `[subagent] refused spawn: ${activeSubAgentSlots}/${maxSlots} slot(s) in use ` +
        `(subAgents.maxAgentSlots=${maxSlots} in ${getConfigPath()}). ` +
        `Server sizing: --parallel must be maxAgentSlots + 1 (currently ${maxSlots + 1}).`,
      );
      return [
        `Error: cannot spawn a sub-agent â€” ${activeSubAgentSlots} of ${maxSlots} sub-agent slot(s) are already in use.`,
        `If you emitted several spawn_agent calls in one response, emit at most ${maxSlots} per response;`,
        `otherwise wait for a running sub-agent to finish.`,
      ].join(' ');
    }

    const task = typeof params.task === 'string' ? params.task.trim() : '';
    if (!task) {
      return 'Error: spawn_agent requires a non-empty "task" describing what the sub-agent should do.';
    }
    const description = (typeof params.description === 'string' && params.description.trim())
      ? params.description.trim()
      : task.slice(0, 80).replace(/\s+/g, ' ');

    const modelName = cfg.model?.trim() || getActiveModelName();
    const agentId = `agent_${this.generateId()}`;
    const ws = this.currentWs;
    const startedAt = Date.now();

    activeSubAgentSlots++;
    this.sendAgentEvent(ws, 'subagent:spawn', {
      agentId,
      sessionId,
      description,
      task,
      model: modelName,
      slotsInUse: activeSubAgentSlots,
      maxSlots,
    });

    try {
      const report = await this.runSubAgentLoop(agentId, task, description, modelName, ws);
      const durationMs = Date.now() - startedAt;
      if (this.cancelled) {
        this.sendAgentEvent(ws, 'subagent:done', { agentId, sessionId, status: 'cancelled', durationMs });
        return 'Sub-agent cancelled.';
      }
      this.sendAgentEvent(ws, 'subagent:done', { agentId, sessionId, status: 'completed', durationMs });
      return `Sub-agent "${description}" completed in ${(durationMs / 1000).toFixed(1)}s.\n\n${report}`;
    } catch (err: any) {
      const message = err?.message || String(err);
      this.sendAgentEvent(ws, 'subagent:done', {
        agentId,
        sessionId,
        status: this.cancelled ? 'cancelled' : 'error',
        durationMs: Date.now() - startedAt,
        error: message,
      });
      return this.cancelled
        ? 'Sub-agent cancelled.'
        : `Sub-agent "${description}" failed: ${message}`;
    } finally {
      activeSubAgentSlots = Math.max(0, activeSubAgentSlots - 1);
      // The child may have used a different model. Force the parent's next
      // request to resolve back through the active model/client.
      this.currentModelName = getActiveModelName();
      this.openai = null;
    }
  }

  /**
   * Token budget available to ONE child request.
   *
   * Sub-agents save the PARENT's context, but they do not create context at the
   * inference server: llama.cpp splits its total -c across --parallel slots, so
   * each concurrent request sees roughly 1/N of it. subAgents.perSlotContextTokens
   * states that real per-slot size; when it is unset we budget conservatively as
   * contextWindow / (1 + maxAgentSlots).
   */
  private subAgentContextBudget(modelName: string): {
    tokens: number;
    declared: number;
    maxSlots: number;
    explicit: boolean;
  } {
    const cfg = getSubAgentConfig();
    const declared = getAgentModel(modelName).contextWindow || 64000;
    const maxSlots = Math.max(1, Math.floor(cfg.maxAgentSlots || 1));
    const explicit = typeof cfg.perSlotContextTokens === 'number' && cfg.perSlotContextTokens > 0;
    const tokens = explicit
      ? Math.floor(cfg.perSlotContextTokens as number)
      : Math.floor(declared / (1 + maxSlots));
    return { tokens: Math.max(1024, tokens), declared, maxSlots, explicit };
  }

  /**
   * The child agent's own tool loop. It shares the parent's tool executor,
   * browser/desktop services and abort signal, but has an isolated transcript
   * and its own model selection.
   */
  private async runSubAgentLoop(
    agentId: string,
    task: string,
    description: string,
    modelName: string,
    ws: WebSocket | null,
  ): Promise<string> {
    const config = { ...getConfig() };
    const cwd = this.currentProjectPath || process.cwd();

    // Budget against the context this request can actually use (see
    // subAgentContextBudget), and shrink the per-result cap to match: a single
    // 16k-char grep would otherwise consume most of a small parallel slot.
    const budget = this.subAgentContextBudget(modelName);
    const cm = config.contextManagement;
    const charsPerToken = cm?.charsPerToken && cm.charsPerToken > 0 ? cm.charsPerToken : 3;
    const childToolResultChars = Math.max(2000, Math.min(
      this.storedResultLimit(config),
      Math.floor(budget.tokens * charsPerToken * 0.25),
    ));
    // Completion tokens occupy the same slot as the prompt, so a child cannot
    // be allowed to emit an unbounded report into a narrow parallel window.
    const childMaxOutput = Math.max(1024, Math.min(8192, Math.floor(budget.tokens * 0.4)));
    const childConfig: any = {
      ...config,
      contextManagement: { ...(cm || {}), toolResultMaxChars: childToolResultChars },
    };
    console.log(
      `[subagent] ${agentId} budget=${budget.tokens} tokens ` +
      (budget.explicit
        ? '(subAgents.perSlotContextTokens)'
        : `(derived: ${budget.declared}/${1 + budget.maxSlots} slots)`) +
      ` toolResults=${childToolResultChars} chars maxOutput=${childMaxOutput} tokens`,
    );
    const systemPrompt = [
      'You are a focused sub-agent spawned by Yuki, the primary assistant.',
      'Work autonomously on the task below. You cannot ask the user questions, and you cannot spawn further sub-agents.',
      'Use the available tools to inspect files, run commands, search the web, or operate the browser as needed.',
      `Your working directory is ${cwd}. Prefer relative paths inside it; never touch unrelated files.`,
      'When you are done, reply with a concise report for the parent agent: what you found or changed, exact paths/commands, and anything the parent still needs to do. Do not repeat raw tool output verbatim.',
      '',
      '## Environment Context',
      getSystemInfo(cwd),
    ].join('\n');

    const messages: Array<Record<string, any>> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `## Task\n${description ? description + '\n\n' : ''}${task}` },
    ];

    const configuredIterations = config.maxToolIterations;
    const maxIterations = configuredIterations === -1
      ? 40
      : Math.max(1, configuredIterations || 10);
    let finalContent = '';
    let iterations = 0;

    while (iterations < maxIterations) {
      if (this.cancelled) return '[Sub-agent cancelled by user.]';
      iterations++;

      this.trimSubAgentMessages(messages, budget.tokens);

      const response = await this.callLLM(
        messages,
        childConfig,
        this.abortController?.signal,
        (chunk) => this.sendAgentEvent(ws, 'subagent:thinking', { agentId, chunk }),
        (chunk) => this.sendAgentEvent(ws, 'subagent:chunk', { agentId, chunk }),
        modelName,
        undefined,
        undefined,
        SUBAGENT_TOOL_EXCLUSIONS,
        childMaxOutput,
      );

      if (this.cancelled) return '[Sub-agent cancelled by user.]';

      if (!response.toolCalls || response.toolCalls.length === 0) {
        finalContent = response.content || response.reasoningContent || '';
        break;
      }

      const assistantEntry: Record<string, any> = {
        role: 'assistant',
        content: response.content || '',
        tool_calls: response.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.parameters) },
        })),
      };
      if (response.reasoningContent) {
        assistantEntry.reasoning_content = response.reasoningContent;
      }
      messages.push(assistantEntry);

      for (const toolCall of response.toolCalls) {
        if (this.cancelled) return '[Sub-agent cancelled by user.]';
        toolCall.status = 'running';
        this.sendAgentEvent(ws, 'subagent:tool_call', { agentId, toolCall });

        try {
          const result = await this.executeTool(toolCall, undefined);
          toolCall.result = result;
          toolCall.status = 'completed';
        } catch (err: any) {
          toolCall.result = `Error: ${err.message}`;
          toolCall.status = 'error';
        }

        this.sendAgentEvent(ws, 'subagent:tool_result', {
          agentId,
          toolCallId: toolCall.id,
          result: toolCall.result,
          status: toolCall.status,
        });
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: this.contextToolResult(toolCall, childConfig),
        });
      }
    }

    if (!finalContent) {
      finalContent = `[Sub-agent stopped after reaching the tool-iteration limit (${maxIterations}).]`;
    }

    this.sendAgentEvent(ws, 'subagent:response', { agentId, message: finalContent });
    return finalContent;
  }

  /**
   * Keep a long-running sub-agent's isolated transcript inside its available
   * token budget (the per-slot window, not the model's advertised window) by
   * replacing the oldest tool payloads with a short marker. Structure is
   * preserved (assistant tool_calls still have matching tool messages), only
   * the bulky content is dropped.
   */
  private trimSubAgentMessages(messages: Array<Record<string, any>>, tokenBudget: number): void {
    const cm = getConfig().contextManagement;
    const cpt = cm?.charsPerToken && cm.charsPerToken > 0 ? cm.charsPerToken : 3;
    const budget = tokenBudget * cpt * 0.72;
    let total = 0;
    for (const m of messages) {
      total += typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content ?? '').length;
      if (m.tool_calls) total += JSON.stringify(m.tool_calls).length;
    }
    if (total <= budget) return;

    const placeholder = '[Tool result omitted to keep the sub-agent within its context window.]';
    for (let i = 1; i < messages.length - 6 && total > budget; i++) {
      const m = messages[i];
      if (
        m.role === 'tool'
        && typeof m.content === 'string'
        && m.content !== placeholder
        && !m.content.startsWith('data:image')
      ) {
        total -= m.content.length;
        m.content = placeholder;
        total += placeholder.length;
      }
    }
  }

  private listAttachments(): string {
    if (this.currentAttachments.length === 0) {
      return 'No file attachments on the current user message.';
    }
    return this.currentAttachments
      .map((a, i) => `[${i}] ${a.name} (${a.type}, ${a.size} bytes${a.isImage ? ', image' : ''})`)
      .join('\n');
  }

  private async saveAttachedFile(index: number, filename?: string): Promise<string> {
    const att = this.currentAttachments[index];
    if (!att) {
      return `No attachment at index ${index}. Use attachment_list to see available attachments.`;
    }

    const targetName = filename && filename.trim() ? path.basename(filename.trim()) : att.name;
    const targetDir = this.currentProjectPath || process.cwd();
    const targetPath = path.join(targetDir, targetName);

    try {
      if (fs.existsSync(att.path)) {
        fs.copyFileSync(att.path, targetPath);
      } else if (att.dataUrl) {
        const m = att.dataUrl.match(/^data:([^;]+);base64,(.*)$/s);
        if (m) {
          fs.writeFileSync(targetPath, Buffer.from(m[2], 'base64'));
        } else {
          fs.writeFileSync(targetPath, att.dataUrl, 'utf-8');
        }
      } else {
        return `Attachment data not available for: ${att.name}`;
      }
      return `Saved ${att.name} to ${targetPath}`;
    } catch (err: any) {
      return `Failed to save attachment: ${err.message}`;
    }
  }

  private parseFunctionArgs(argStr: string): Record<string, any> {
    try {
      if (typeof argStr === 'string') {
        return JSON.parse(argStr);
      }
      return argStr;
    } catch {
      return {};
    }
  }

  private sendContextUpdate(ws: WebSocket, promptTokens: number, maxTokens: number): void {
    this.sendToClient(ws, 'context:update', { promptTokens, maxTokens });
  }

  /**
   * Assemble the request array from stored history. Factored out so a mid-turn
   * compaction can rebuild it against the shortened session.
   */
  private buildRequestMessages(
    session: Session,
    config: any,
    userMessage: string,
    images: string[],
    systemPrompt: string,
  ): Array<Record<string, any>> {
    const messages: Array<Record<string, any>> = [];

    if (systemPrompt) {
      const envBlock = `\n\n## Environment Context\n${getSystemInfo(this.currentProjectPath)}`;
      // NOTE: the live plan STATE (getPlanSummary) intentionally does NOT live
      // here. This head message must stay byte-identical across turns so the
      // shared prompt prefix stays cacheable (prefix caching reuses from the
      // head; changing the head invalidates the whole cached prefix). The live
      // plan state is instead folded into the current user message at the tail
      // (the recency zone) â€” where a changing element only invalidates a short
      // suffix, and where it avoids Qwen's "system message must be at the
      // beginning" template constraint.
      const planBlock = `\n\n## Planning\nFor tasks requiring 3 or more sequential steps of moderate or higher complexity, you MUST create a plan before proceeding. Use plan_create to define steps, plan_update to mark steps complete, and plan_remove when all work is finished. When all steps are marked as completed or cancelled, you MUST call plan_remove to clear the plan. Do not leave stale plans behind.`;
      const subCfg = getSubAgentConfig();
      const maxSubAgents = Math.max(1, Math.floor(subCfg.maxAgentSlots || 1));
      const subAgentBlock = subCfg.enabled
        ? `\n\n## Sub-Agents\nspawn_agent is ENABLED and is present in your tool list for this session. Call it to delegate a self-contained task to a focused sub-agent with its own isolated context and tool loop. Up to ${maxSubAgents} sub-agent(s) can run at the same time. To use that, emit independent spawn_agent calls together in ONE response â€” they are dispatched concurrently, and calls beyond ${maxSubAgents} in the same response are rejected. Spawns in separate responses are sequential. Use sub-agents for deep, narrow work that would otherwise flood this conversation with detail (codebase research, bug investigation, drafting a long document), or for genuinely independent subtasks. The sub-agent cannot ask the user questions, so include every path, constraint, and expected deliverable in its task. Its final report is returned to you as the tool result â€” verify it and summarize it for the user.`
        : '';
      const reasoningNote = '\n\n## Reasoning\nYour previous reasoning is included in the context window inside <think> blocks as part of your assistant messages. You can reference it to maintain continuity. The thinking tag formatting is for your context only â€” the user sees your reasoning through a separate UI toggle, not as raw text.';
      const toolOutputNote = '\n\n## Tool Output Limits\nWhen a tool response says "Output truncated at N lines. Full output saved to: path", you MUST use read(filePath, offset=0, limit=N) to page through results. Never request more output than fits in the limit. This is a hard requirement â€” the content literally isn\'t in the response.';
      messages.push({ role: 'system', content: systemPrompt + envBlock + planBlock + subAgentBlock + reasoningNote + toolOutputNote });
    }

    // The anchored summary is a system-role message, so the history filter below
    // would drop it. Without this it is written and never actually sent back.
    const anchored = session.messages.find(m => this.isSummaryMessage(m) && !m.pruned);
    if (anchored) {
      messages.push({ role: 'system', content: anchored.content });
    }

    // Only go back to the start, or to the last compaction summary. Anything
    // older than the anchor has been folded into it and is no longer replayed.
    const anchorIndex = anchored ? session.messages.indexOf(anchored) : -1;
    const historyMessages = session.messages
      .filter((m, idx) => m.role !== 'system' && !m.pruned && !m.compacted && idx > anchorIndex)
      .slice(0, -1); // last message is the current user msg (re-added below with images)

    for (const msg of historyMessages) {
      const entry: Record<string, any> = {
        role: msg.role,
        content: msg.content,
      };
      if (msg.reasoningContent) {
        entry.reasoning_content = msg.reasoningContent;
      }
      if (msg.toolCalls) {
        entry.tool_calls = msg.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.parameters) },
        }));
        messages.push(entry);
        for (const tc of msg.toolCalls) {
          if (tc.result) {
            messages.push({ role: 'tool', tool_call_id: tc.id, content: tc.result });
          }
        }
      } else {
        messages.push(entry);
      }
    }

    // Live, mutable planning state rides along on the CURRENT user message â€”
    // kept at the tail (the recency zone) so the prompt head and all prior
    // history stay byte-identical and cacheable; when the plan changes only this
    // final message (which changes every turn anyway) differs.
    // NOTE: this MUST NOT be a `system`-role message. Qwen's chat template
    // raises "System message must be at the beginning" for any system message
    // placed mid-conversation, so the volatile plan state is folded into the
    // user turn (user role is valid anywhere) instead.
    const currentUserContent = buildUserContent(userMessage, images, this.currentAttachments);
    // Keep a short delegation reminder in the recency zone as well as in the
    // system prompt: long sessions can otherwise anchor on earlier turns where
    // the tool did not exist yet and wrongly claim it is unavailable.
    const subCfgForNote = getSubAgentConfig();
    const subAgentsForNote = Math.max(1, Math.floor(subCfgForNote.maxAgentSlots || 1));
    const delegationNote = subCfgForNote.enabled
      ? `## Delegation\nspawn_agent is enabled and listed in your tools this session (max ${subAgentsForNote} concurrent sub-agent(s)). Do not claim it is unavailable; if delegation would help, call it. To run sub-agents in parallel, emit their spawn_agent calls together in one response (at most ${subAgentsForNote}).\n\n`
      : '';
    const planNote = `## Current Plan\n${getPlanSummary(session.id)}\n\n${delegationNote}`;
    if (typeof currentUserContent === 'string') {
      messages.push({ role: 'user', content: planNote + currentUserContent });
    } else {
      // Multimodal: buildUserContent guarantees a text part first; prepend the plan to it.
      const parts = Array.isArray(currentUserContent) ? [...currentUserContent] : [{ type: 'text', text: String(currentUserContent) }];
      const first = parts[0];
      if (first && typeof first.text === 'string') {
        first.text = planNote + first.text;
      } else {
        parts.unshift({ type: 'text', text: planNote.trim() });
      }
      messages.push({ role: 'user', content: parts });
    }

    return messages;
  }

  /** Tool schemas ride along with every request and are pure overhead. */
  private toolDefsOverheadChars(): number {
    if (this.toolDefsChars === null) {
      try {
        this.toolDefsChars = JSON.stringify(toolDefinitions).length;
      } catch {
        this.toolDefsChars = 0;
      }
    }
    return this.toolDefsChars;
  }

  private storedResultLimit(config: any): number {
    const limit = config?.contextManagement?.toolResultMaxChars;
    return typeof limit === 'number' && limit > 0 ? limit : 16000;
  }

  private isSummaryMessage(msg: Message): boolean {
    return msg.id === `${msg.sessionId}-summary` || (msg.role === 'system' && (msg.content || '').startsWith(SUMMARY_PREFIX));
  }

  /** The copy of a tool result that enters the context (and therefore history). */
  private contextToolResult(toolCall: ToolCall, config: any): string {
    const full = toolCall.result || '';
    if (IMAGE_RESULT_TOOLS.has(toolCall.name) || isImageResult(full)) return full;
    return capToolResult(toolCall.name, toolCall.parameters, full, this.storedResultLimit(config));
  }

  /**
   * What gets written to the session file. Tool results are capped here so the
   * UI still renders the full output for this turn while every later turn â€” and
   * every restart â€” replays a bounded copy.
   */
  private forStorage(msg: Message, config: any): Message {
    if (!msg.toolCalls?.length) return msg;
    const limit = this.storedResultLimit(config);
    let capped = false;
    const toolCalls = msg.toolCalls.map(tc => {
      const full = tc.result || '';
      if (!full || full.length <= limit) return tc;
      if (IMAGE_RESULT_TOOLS.has(tc.name) || isImageResult(full)) return tc;
      capped = true;
      return { ...tc, result: capToolResult(tc.name, tc.parameters, full, limit) };
    });
    return capped ? { ...msg, toolCalls } : msg;
  }

  private estimateSessionTokens(session: Session, config: any): number {
    return estimateSessionTokens(session, config, this.toolDefsOverheadChars());
  }

  /** Turn-start compaction: cheap, runs once before the tool loop. */
  private async compactIfOverBudget(session: Session, config: any, ws: WebSocket): Promise<void> {
    const cm = config.contextManagement;
    if (!cm?.enabled) return;
    const ctxWindow = getAgentModel().contextWindow || 64000;
    const projected = projectedPromptTokens(
      session,
      this.estimateSessionTokens(session, config),
      cm.estimateSafetyMargin ?? 1.15,
    );
    if (projected > ctxWindow * (cm.compactionThreshold ?? 0.85)) {
      await this.compactConversation(session, config, ws);
    }
  }

  /**
   * Per-iteration budget guard. Returns:
   *   'ok'        â€” safe to call the model
   *   'compacted' â€” session was compacted; caller must rebuild its message array
   *   'halt'      â€” at the wall with nothing left to compact; turn is over
   */
  private async enforceContextBudget(
    messages: Array<Record<string, any>>,
    session: Session,
    config: any,
    ws: WebSocket,
    userMessage: string,
    images: string[],
    systemPrompt: string,
  ): Promise<'ok' | 'compacted' | 'halt'> {
    const cm = config.contextManagement;
    if (!cm?.enabled) return 'ok';

    const ctxWindow = getAgentModel().contextWindow || 64000;
    const cpt = resolveCharsPerToken(session, cm);
    const liveEstimate = estimateRequestTokens(messages, session, config)
      + Math.ceil(this.toolDefsOverheadChars() / cpt);
    const projected = projectedPromptTokens(session, liveEstimate, cm.estimateSafetyMargin ?? 1.15);

    if (projected <= ctxWindow * (cm.compactionThreshold ?? 0.85)) return 'ok';

    const atWall = projected > ctxWindow * (cm.hardStopThreshold ?? 0.95);
    console.log(
      `[agent] budget guard: projected=${projected}/${ctxWindow} ` +
      `(live=${liveEstimate}, lastActual=${session.lastPromptTokens || 0}, cpt=${cpt.toFixed(2)})`,
    );

    const compacted = await this.compactConversation(session, config, ws);
    if (compacted) return 'compacted';

    // Nothing could be reclaimed â€” either the turn is tiny or compaction failed.
    if (atWall) {
      console.warn('[agent] halting turn: context window exhausted and nothing left to compact');
      this.sendToClient(ws, 'chat:response', {
        message:
          'I stopped because this session ran out of context window and there was nothing left to compact. ' +
          'Start a new session, or ask me to work in smaller pieces â€” the earlier findings are summarized in the anchored summary.',
        reasoningContent: '',
        messageId: '',
        sessionId: session.id,
      });
      return 'halt';
    }
    return 'ok';
  }

  /**
   * Public method to trigger manual context compaction from the client.
   */
  async triggerCompaction(session: Session, config: any, ws: WebSocket): Promise<void> {
    console.log(`[agent] triggerCompaction called, session has ${session.messages.length} messages`);
    const reason = await this.compactConversation(session, config, ws);
    if (reason) {
      console.log(`[agent] compactConversation failed: ${reason}`);
      this.sendToClient(ws, 'context:compact-failed', {
        sessionId: session.id,
        reason,
      });
      return;
    }
    console.log('[agent] compactConversation returned true');
  }

  /**
   * Fold the conversation up to (but not including) the current message into a
   * single anchored summary. The folded turns are kept in the session log (for
   * reference) but flagged `compacted` so the agent's request history only ever
   * reaches back to the last compaction summary.
   * Returns an empty string when the session was rewritten, or a reason string
   * describing why compaction could not proceed.
   */
  private async compactConversation(session: Session, config: any, ws: WebSocket): Promise<string> {
    const cm = config.contextManagement || {};
    const cpt = resolveCharsPerToken(session, cm);
    const imageTokens = config.imageTokensPerImage || 1024;
    const ctxWindow = getAgentModel().contextWindow || 64000;

    // The anchored summary is itself a system message. It must be pulled out
    // explicitly, otherwise the second compaction silently drops the whole chain.
    const summaryMsg = session.messages.find(m => this.isSummaryMessage(m));
    const systemMsg = session.messages.find(m => m.role === 'system' && m !== summaryMsg);

    const rest = session.messages.filter(m => m !== systemMsg && m !== summaryMsg);
    if (rest.length < 1) return 'There is no conversation to compact.';

    // Never summarize away the message currently being answered.
    const pinned = rest.slice(-1);
    const toSummarize = rest.slice(0, -1);
    if (toSummarize.length < 1) return 'There is nothing to compact yet.';

    const prevSummary = summaryMsg && (summaryMsg.content || '').startsWith(SUMMARY_PREFIX)
      ? trimLineEndings(normalizeLineEndings(summaryMsg.content || '')).slice(SUMMARY_PREFIX.length + 1)
      : undefined;

    const beforeTokens = this.estimateSessionTokens(session, config);
    const resultLimit = Math.min(this.storedResultLimit(config), 8000);

    try {
      const summary = await this.summarizeForAnchor(toSummarize, prevSummary, cm, ctxWindow, resultLimit, cpt, imageTokens);
      if (!summary) {
        return 'The summarizer produced no output.';
      }

      // Keep the folded turns in the log for the user's reference, but mark them
      // so they are no longer replayed to the model.
      for (const m of toSummarize) {
        m.compacted = true;
      }

      // Drop any prior summary and insert the refreshed running anchor at the
      // compaction boundary â€” right before the message currently being answered
      // (the pinned message). This way the transcript reads naturally:
      //   [compacted turns (dimmed)] -> [Summary] -> [recent conversation]
      // instead of the summary being yanked to the very top.
      const summaryMessage: Message = {
        id: `${session.id}-summary`,
        role: 'system',
        content: `${SUMMARY_PREFIX}\n${summary}`,
        timestamp: new Date(),
        sessionId: session.id,
      };
      session.messages = session.messages.filter(m => m !== summaryMsg);
      const pinnedMsg = pinned[0];
      const insertAt = pinnedMsg ? session.messages.indexOf(pinnedMsg) : session.messages.length;
      if (insertAt < 0) {
        session.messages.push(summaryMessage);
      } else {
        session.messages.splice(insertAt, 0, summaryMessage);
      }
      session.updatedAt = new Date();

      const afterTokens = this.estimateSessionTokens(session, config);
      this.sendToClient(ws, 'context:compacted', {
        savedTokens: Math.max(0, beforeTokens - afterTokens),
        messagesCompacted: toSummarize.length,
        sessionId: session.id,
      });
      return '';
    } catch (err) {
      return `Compaction failed with an error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * Summarize into the anchor, staging the work when the history alone would
   * not fit in one request â€” otherwise the summarizer 400s and nothing compacts.
   */
  private async summarizeForAnchor(
    messages: Message[],
    prevSummary: string | undefined,
    cm: any,
    ctxWindow: number,
    resultLimit: number,
    cpt: number,
    imageTokens: number,
  ): Promise<string> {
    const budget = Math.floor(ctxWindow * (cm.stagedSummaryBudget ?? 0.5));
    const overhead = textTokens(SUMMARY_TEMPLATE, cpt) + (prevSummary ? textTokens(prevSummary, cpt) : 0) + 300;
    const chunks = chunkByBudget(messages, Math.max(2000, budget - overhead), cpt, imageTokens, resultLimit);

    if (chunks.length <= 1) {
      return this.runSummaryRequest(this.summaryEntries(messages, resultLimit), buildAnchor(prevSummary));
    }

    console.log(`[agent] staging compaction across ${chunks.length} chunks`);
    const partials: string[] = [];
    for (const chunk of chunks) {
      const partial = await this.runSummaryRequest(this.summaryEntries(chunk, resultLimit), CREATE_ANCHOR);
      if (partial) partials.push(partial);
    }
    if (partials.length === 0) return '';

    const merged = partials
      .map((p, i) => `<partial-summary index="${i + 1}">\n${p}\n</partial-summary>`)
      .join('\n\n');
    return this.runSummaryRequest([{ role: 'user', content: merged }], buildAnchor(prevSummary));
  }

  /** Tool results are included: they are usually the substance being compacted. */
  private summaryEntries(messages: Message[], resultLimit: number): Array<Record<string, any>> {
    const entries: Array<Record<string, any>> = [];
    for (const m of messages) {
      const entry: Record<string, any> = { role: m.role, content: m.content || '' };
      if (m.reasoningContent) entry.reasoning_content = m.reasoningContent;
      if (m.toolCalls?.length) {
        entry.tool_calls = m.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.parameters) },
        }));
      }
      entries.push(entry);
      for (const tc of m.toolCalls || []) {
        if (tc.result) {
          entries.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: capToolResult(tc.name, tc.parameters, tc.result, resultLimit),
          });
        }
      }
    }
    return entries;
  }

  private async runSummaryRequest(history: Array<Record<string, any>>, anchor: string): Promise<string> {
    const openai = this.getOpenAI();
    const agentCfg = getAgentModel();
    const response = await withModelLoadRetry(
      () => openai.chat.completions.create({
        model: agentCfg.model,
        messages: [
          { role: 'system', content: 'You are an anchored context summarization assistant for coding sessions.' },
          ...(history as any[]),
          { role: 'user', content: [anchor, SUMMARY_TEMPLATE].join('\n\n') },
        ],
        max_tokens: 4096,
        stream: false,
      }),
      2, 3000, 'context compaction',
    );
    return response.choices?.[0]?.message?.content || '';
  }

  private sendToClient(ws: WebSocket, type: string, data: any): void {
    try {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type, data }));
      }
    } catch {
      // Connection may be closing
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  /**
   * Ask the model for a short label AND a 1-2 sentence topic summary based on
   * the first exchange. Returns { label, summary } - empty strings on failure.
   */
  async suggestSessionSummary(
    firstUserText: string,
    assistantReply?: string,
  ): Promise<{ label: string; summary: string }> {
    try {
      const openai = this.getOpenAI();
      const agentCfg = getAgentModel();
      const userText = firstUserText ? String(firstUserText).slice(0, 2000) : '';
      if (!userText.trim()) return { label: '', summary: '' };
      const reply = assistantReply ? String(assistantReply).slice(0, 1500) : '';

      const context = reply
        ? `User: ${userText}\n\nAssistant: ${reply}`
        : userText;

      const response = await withModelLoadRetry(
        () => openai.chat.completions.create({
          model: agentCfg.model,
          messages: [
            {
              role: 'system',
              content: `You produce two short outputs about a conversation topic:
1. A label: 2-5 words, no punctuation, no quotes.
2. A summary: one concise sentence (max 30 words) describing what the session is about.

Reply in this exact JSON format only:
{"label": "the short label", "summary": "the one-sentence summary"}

Do not include any other text.`,
            },
            { role: 'user', content: context },
          ],
          max_tokens: 100,
          stream: false,
        }),
        2, 3000, 'session summary',
      );

      const raw = response.choices?.[0]?.message?.content || '';
      
      // Try to parse JSON
      let label = '';
      let summary = '';
      try {
        // Strip possible markdown code fences
        const jsonStr = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?\s*```$/g, '').trim();
        const parsed = JSON.parse(jsonStr);
        label = String(parsed.label || '').trim().replace(/^["'`]+|["'`]+$/g, '').replace(/[.,;:!?]+$/g, '').trim();
        summary = String(parsed.summary || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
      } catch {
        // Fallback: treat the whole response as a summary
        const cleaned = raw
          .trim()
          .replace(/^["'`]+|["'`]+$/g, '')
          .replace(/[.,;:!?]+$/g, '')
          .trim();
        if (cleaned) {
          const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 5);
          label = words.join(' ');
          summary = cleaned;
        }
      }

      if (!label) return { label: '', summary: '' };
      return { label, summary };
    } catch (err) {
      console.error('[agent] session summary suggestion failed:', err);
      return { label: '', summary: '' };
    }
  }
}

function buildMultimodalContent(text: string, images: string[]): Array<Record<string, any>> {
  const content: Array<Record<string, any>> = [{ type: 'text', text }];
  for (const img of images) {
    content.push({ type: 'image_url', image_url: { url: img } });
  }
  return content;
}

const TEXT_MIME_HINTS = /^(text\/|application\/(json|xml|javascript|x-javascript|yaml|yml|toml|sql|sh|shell|python|csv|rtf))|\.(txt|md|json|xml|js|ts|py|rb|go|rs|java|c|cpp|h|cs|html|css|scss|sh|yaml|yml|toml|ini|conf|cfg|log|csv|sql|env|gitignore|dockerfile)$/i;

function buildUserContent(text: string, images: string[], attachments: Attachment[]): string | Array<Record<string, any>> {
  const content: Array<Record<string, any>> = [];
  const textChunks: string[] = [];
  const visionUrls = new Set<string>();

  if (text) textChunks.push(text);

  // Pasted images â€” always sent as vision parts
  for (const img of images) {
    visionUrls.add(img);
    content.push({ type: 'image_url', image_url: { url: img } });
  }

  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];

    if (att.isImage) {
      if (att.dataUrl && !visionUrls.has(att.dataUrl)) {
        visionUrls.add(att.dataUrl);
        content.push({ type: 'image_url', image_url: { url: att.dataUrl } });
      }
      textChunks.push(`\n\n[Attached image ${i}: ${att.name} (${att.type}, ${att.size} bytes). The user pasted/shared this image. Describe what you see in it. If you need to save it to disk, call save_attached_file with index=${i}.]`);
      continue;
    }

    let textFile = '';
    if (TEXT_MIME_HINTS.test(`${att.name}`)) {
      try {
        textFile = fs.readFileSync(att.path, 'utf-8').slice(0, 40000);
      } catch { /* ignore */ }
    }

    if (textFile) {
      textChunks.push(`\n\n[Attachment ${i}: ${att.name} (${att.type}, ${att.size} bytes)]\n\`\`\`\n${textFile}\n\`\`\``);
    } else {
      textChunks.push(`\n\n[Attachment ${i}: ${att.name} (${att.type}, ${att.size} bytes). The full file is available on disk â€” use attachment_list and save_attached_file to read or save it.]`);
    }
  }

  if (content.length === 0) return textChunks.join('');

  content.unshift({ type: 'text', text: textChunks.join('') });
  return content;
}

// llama.cpp returns 503 "Loading model" transiently while it loads/rebinds a
// model. Retry with linear backoff rather than failing the request.
async function withModelLoadRetry<T>(
  fn: () => Promise<T>,
  retries: number,
  baseDelayMs: number,
  label: string,
): Promise<T> {
  for (let attempt = 0;; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status ?? err?.statusCode ?? 0;
      const isModelLoading = status === 503 || /loading model/i.test(`${err?.message || ''}`);
      if (!isModelLoading || attempt >= retries) throw err;
      const wait = baseDelayMs * (attempt + 1);
      console.log(`[agent] ${label}: model loading (503), retrying in ${wait}ms (${attempt + 1}/${retries})`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
