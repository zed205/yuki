import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { WebSocket } from 'ws';
import { getConfig } from './config';
import { tools, toolDefinitions, planToolNames, truncateOutput } from './tools';
import { Message, ToolCall, Session, Plan, PlanStep, Attachment } from '../shared/types';
import { planCreate, planUpdate, planGet, planRemove, getPlanSummary } from './plan';
import { getAgentModel, getActiveModelName, setActiveModelName, getBackupModelName, getNamedModels, loadVoiceSystemPrompt, getEffectiveThinking } from './config';
import { getProject } from './project';
import { AudioPipeline } from './audio';
import { BrowserAutomation } from './browser';
import { DesktopAutomation } from './automation';
import { MCPManager } from './mcp';
import { logLLMRequestResponse } from './llm-logger';
import { Observer } from './observer';

function getSystemInfo(projectPath?: string): string {
  const maxLines = getConfig().maxToolOutputLines || 20;
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
    `${maxLines < 0 ? 'Tool output truncation is disabled (maxToolOutputLines=-1).' : `Tool outputs for read, web_fetch, and shell are truncated to ${maxLines} lines. The truncation message includes the full output file path. Use read(..., offset, limit) where offset and limit are line numbers to page through output.`}`,
  ];
  return lines.join('\n');
}

export class Agent {
  private audioPipeline: AudioPipeline | null = null;
  private browser: BrowserAutomation | null = null;
  private desktop: DesktopAutomation | null = null;
  private mcp: MCPManager | null = null;
  private cancelled = false;
  private abortController: AbortController | null = null;
  private disabledTools: Set<string> = new Set();
  private observer: Observer | null = null;
  private observerTurnCount = 0;
  currentProjectPath: string = '';
  currentModelName: string = '';
  private openai: OpenAI | null = null;

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
  /** Evaluate observer feedback and inject it if significant enough. Returns true if feedback was injected. */
  private async getObserverFeedback(
    messages: Array<Record<string, any>>,
    ws: WebSocket,
    session: Session,
    iterations: number,
  ): Promise<boolean> {
    const obsCfg = getConfig().observer;
    if (!obsCfg?.enabled) return false;

    // Check if observer should run this turn
    if (obsCfg.mode === 'periodic' && (iterations % obsCfg.interval!) !== 0) return false;

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
    this.currentAttachments = attachments || [];
    this.abortController = new AbortController();
    const config = { ...getConfig() };
    let systemPrompt = session.messages.find((m) => m.role === 'system')?.content || '';
    if (session.voiceMode) {
      systemPrompt = loadVoiceSystemPrompt();
    }

    const project = getProject(session.projectId || 'default');
    this.currentProjectPath = project?.path || '';

    // Compact if conversation exceeds threshold
    const cm = config.contextManagement;
    if (cm?.enabled) {
      const ctxWindow = getAgentModel().contextWindow || 64000;
      const estimate = this.estimateSessionTokens(session, config);
      if (estimate > ctxWindow * cm.compactionThreshold) {
        await this.compactConversation(session, config, ws);
      }
    }

    let messages: Array<Record<string, any>> = [];

    if (systemPrompt) {
      const envBlock = `\n\n## Environment Context\n${getSystemInfo(this.currentProjectPath)}`;
      const planBlock = `\n\n## Planning\nFor tasks requiring 3 or more sequential steps of moderate or higher complexity, you MUST create a plan before proceeding. Use plan_create to define steps, plan_update to mark steps complete, and plan_remove when all work is finished. When all steps are marked as completed or cancelled, you MUST call plan_remove to clear the plan. Do not leave stale plans behind.\n\n${getPlanSummary(session.id)}`;
      const reasoningNote = '\n\n## Reasoning\nYour previous reasoning is included in the context window inside `<think>` blocks as part of your assistant messages. You can reference it to maintain continuity. The thinking tag formatting is for your context only — the user sees your reasoning through a separate UI toggle, not as raw text.';
      const toolOutputNote = '\n\n## Tool Output Limits\nWhen a tool response says "Output truncated at N lines. Full output saved to: path", you MUST use read(filePath, offset=0, limit=N) to page through results. Never request more output than fits in the limit. This is a hard requirement — the content literally isn\'t in the response.';
      messages.push({ role: 'system', content: systemPrompt + envBlock + planBlock + reasoningNote + toolOutputNote });
    }

    const historyMessages = session.messages
      .filter((m) => m.role !== 'system' && !m.pruned)
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

    messages.push({
      role: 'user',
      content: buildUserContent(userMessage, images, this.currentAttachments),
    });

    let iterations = 0;
    let hasToolCalls = true;
    const cfgIter = getConfig().maxToolIterations;
    const maxIterations = cfgIter === -1 ? Infinity : (cfgIter || 10);

    while (hasToolCalls && iterations < maxIterations) {
      if (this.cancelled) {
        console.log('[agent] cancelled before iter, returning');
        this.cancelled = false;
        return;
      }
      iterations++;
      const streamMsgId = this.generateId();

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
        this.sendContextUpdate(ws, response.usage.promptTokens, getAgentModel().contextWindow || 64000);
      }

      if (this.cancelled) {
        console.log('[agent] cancelled after callLLM, returning');
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

        for (const toolCall of toolCalls) {
          toolCall.status = 'running';
          this.sendToClient(ws, 'tool:call', { toolCall });

          try {
            const result = await this.executeTool(toolCall, session.id);
            toolCall.result = result;
            toolCall.status = 'completed';
          } catch (err: any) {
            toolCall.result = `Error: ${err.message}`;
            toolCall.status = 'error';
          }

          this.sendToClient(ws, 'tool:result', {
            toolCallId: toolCall.id,
            result: toolCall.result,
            status: toolCall.status,
          });

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
              content: toolCall.result || '',
            });
          }
          this.sendContextUpdate(ws, this.estimateSessionTokens(session, config), getAgentModel().contextWindow || 64000);
        }

        session.messages.push(assistantMsg);
        this.sendContextUpdate(ws, this.estimateSessionTokens(session, config), getAgentModel().contextWindow || 64000);

        // Run observer evaluation if enabled
        try {
          await this.getObserverFeedback(messages, ws, session, iterations);
        } catch (obsErr) {
          console.error('[agent] observer error (non-fatal):', obsErr);
        }

        if (this.cancelled) {
          console.log('[agent] cancelled after tool execution, returning');
          this.cancelled = false;
          return;
        }
      } else {
        const content = response.content || '';
        const reasoning = response.reasoningContent || '';

        // If model generated only reasoning with no visible content, surface it
        if (!content && !reasoning) {
          // Completely empty response — send fallback instead of breaking silently
          this.sendToClient(ws, 'chat:response', {
            message: '[The model returned an empty response. This may indicate the thinking budget exhausted available tokens before generating visible output.]',
            reasoningContent: '',
            toolCalls: undefined,
            messageId: streamMsgId,
            sessionId: session.id,
          });
          session.messages.push({
            id: streamMsgId,
            role: 'assistant',
            content: '[Empty response — likely ran out of token budget during thinking.]',
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
          });

          session.messages.push(assistantMsg);
          this.sendContextUpdate(ws, this.estimateSessionTokens(session, config), getAgentModel().contextWindow || 64000);
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
  }

  resetClient(): void {
    this.openai = null;
  }

  private getOpenAI(modelName?: string): OpenAI {
    const target = modelName || this.currentModelName || getActiveModelName();
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
  ): Promise<{ content: string; toolCalls?: ToolCall[]; reasoningContent?: string; usage?: { promptTokens: number } }> {
    const startTime = Date.now();
    const requestBody: Record<string, any> = { messages };

    const targetModel = modelName || this.currentModelName || getActiveModelName();
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
      max_tokens: agentCfg.maxTokens === -1 ? undefined : (agentCfg.maxTokens || 8000),
      ...(agentCfg.temperature !== undefined ? { temperature: agentCfg.temperature } : {}),
      stream: true,
    };

    if (toolDefinitions.length > 0) {
      // Combine agent-level disabled tools (from config) with session-level disabled tools
      const sessionDisabled = new Set(sessionDisabledTools || []);
      const combinedDisabled = new Set([...this.disabledTools, ...sessionDisabled]);
      let enabledTools = toolDefinitions.filter(t => !combinedDisabled.has(t.function.name));
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
      createParams.chat_template_kwargs = { enable_thinking: true, preserve_thinking: agentCfg.preserveThinking ?? true };
      createParams.thinking_budget_tokens = agentCfg.maxTokens === -1 ? 16000 : Math.min(agentCfg.maxTokens || 16000, 64384);
    } else {
      createParams.chat_template_kwargs = { enable_thinking: false };
      createParams.thinking_budget_tokens = 0;
    }

    Object.assign(requestBody, createParams);
    delete requestBody.stream;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.llmTimeoutMs ?? 180000);
    let onAbort: (() => void) | null = null;
    if (signal) {
      onAbort = () => controller.abort();
      signal.addEventListener('abort', onAbort, { once: true });
    }

    let fullContent = '';
    let fullReasoning = '';
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

  private _truncateOrReturn(content: string, maxLines: number, label: string): string {
    const toolName = label.split(':')[0].trim();
    if (this._whitelistTools.has(toolName)) return content;
    return truncateOutput(content, maxLines, label);
  }

  private async executeTool(toolCall: ToolCall, sessionId?: string): Promise<string> {
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
          const maxLines = getConfig().maxToolOutputLines || 20;
          return this._truncateOrReturn(result, maxLines, `glob: ${params.pattern}`);
        }
      case 'grep':
        {
          const result = await tools.grep(params.pattern, params.rootDir, params.include);
          const maxLines = getConfig().maxToolOutputLines || 20;
          return this._truncateOrReturn(result, maxLines, `grep: ${params.pattern}`);
        }
      case 'shell':
        {
          const result = await tools.shell(params.command, params.cwd || this.currentProjectPath || undefined);
          const maxLines = getConfig().maxToolOutputLines || 20;
          return this._truncateOrReturn(result, maxLines, `shell: ${params.command}`);
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
          const maxLines = getConfig().maxToolOutputLines || 20;
          return this._truncateOrReturn(result, maxLines, `web_fetch: ${params.url}`);
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
      default:
        return `Unknown tool: ${toolCall.name}`;
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

  private async compactConversation(session: Session, config: any, ws: WebSocket): Promise<void> {
    const systemMsg = session.messages.find(m => m.role === 'system');
    const nonSystem = session.messages.filter(m => m.role !== 'system');

    const keepCount = Math.min(4, nonSystem.length);
    if (nonSystem.length - keepCount < 1) return;

    const toSummarize = nonSystem.slice(0, -keepCount);
    const keep = nonSystem.slice(-keepCount);

    // Find previous summary to update if it exists
    const prevSummaryMsg = toSummarize.find(m => m.role === 'system' && m.content.startsWith('Summary of previous conversation:'));
    const prevSummary = prevSummaryMsg?.content.replace('Summary of previous conversation:\n', '') || undefined;
    const toSummarizeFiltered = prevSummaryMsg ? toSummarize.filter(m => m !== prevSummaryMsg) : toSummarize;

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

    const anchor = prevSummary
      ? [
          'Update the anchored summary below using the conversation history above.',
          'Preserve still-true details, remove stale details, and merge in the new facts.',
          '<previous-summary>',
          prevSummary,
          '</previous-summary>',
        ].join('\n')
      : 'Create a new anchored summary from the conversation history above.';

    const summaryPrompt: Array<Record<string, any>> = [
      { role: 'system', content: 'You are an anchored context summarization assistant for coding sessions.' },
      ...toSummarizeFiltered.map(m => {
        const entry: Record<string, any> = { role: m.role as string, content: m.content };
        if (m.reasoningContent) entry.reasoning_content = m.reasoningContent;
        return entry;
      }),
      { role: 'user', content: [anchor, SUMMARY_TEMPLATE].join('\n\n') },
    ];

    try {
      const openai = this.getOpenAI();
      const agentCfg = getAgentModel();
      const beforeTokens = this.estimateSessionTokens(session, config);

      const response = await openai.chat.completions.create({
        model: agentCfg.model,
        messages: summaryPrompt as any,
        max_tokens: 4096,
        stream: false,
      });

      const summary = response.choices?.[0]?.message?.content || '';
      if (!summary) return;

      session.messages = [
        ...(systemMsg ? [systemMsg] : []),
        { id: `${session.id}-summary`, role: 'system', content: `Summary of previous conversation:\n${summary}`, timestamp: new Date(), sessionId: session.id },
        ...keep,
      ];
      session.updatedAt = new Date();

      const afterTokens = this.estimateSessionTokens(session, config);
      const saved = Math.max(0, beforeTokens - afterTokens);

      this.sendToClient(ws, 'context:compacted', {
        savedTokens: saved,
        messagesCompacted: toSummarize.length,
        sessionId: session.id,
      });
    } catch (err) {
      console.error('[agent] compaction failed:', err);
    }
  }

  private estimateSessionTokens(session: Session, config: any): number {
    let total = 0;
    for (const msg of session.messages) {
      const content = msg.content || '';
      total += Math.ceil(content.length / 4) + 10;
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          total += Math.ceil(JSON.stringify(tc.parameters).length / 4) + 5;
          if (tc.result) total += Math.ceil(tc.result.length / 4) + 5;
        }
      }
      if (msg.images) total += (msg.images.length * (config.imageTokensPerImage || 1024));
    }
    return total;
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

  // Pasted images — always sent as vision parts
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
      textChunks.push(`\n\n[Attachment ${i}: ${att.name} (${att.type}, ${att.size} bytes). The full file is available on disk — use attachment_list and save_attached_file to read or save it.]`);
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
