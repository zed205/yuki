/**
 * Observer/Conductor agent — monitors the main agent's progress and provides
 * structured feedback to keep it on track.
 *
 * Runs after the main agent completes a turn (or periodically), evaluates the
 * action against the plan and recent history, and returns structured feedback
 * that gets injected into the next main-agent turn.
 */

import OpenAI from 'openai';
import { Message, ToolCall } from '../shared/types';
import { getObserverModelConfig, getObserverTimeoutMs } from './config';
import { planGet } from './plan';

/** Structured feedback from the observer. */
export interface ObserverFeedback {
  /** Overall assessment: 'on_track', 'drifting', 'stuck', 'off_track', 'complete' */
  status: string;
  /** Brief explanation of the assessment */
  concern?: string | null;
  /** Actionable suggestion (undefined if none needed) */
  suggestion?: string;
  /** Confidence 0-1 in this assessment */
  confidence: number;
}

/** Snapshot of the most recent agent activity for the observer to evaluate. */
interface ActivitySnapshot {
  /** The plan (if any) the agent is following */
  planTitle?: string;
  planSteps?: Array<{ id: string; description: string; status: string }>;
  /** Recent turns (last N) for context */
  recentTurns: Array<{
    turn: number;
    action: string;
    tool?: string;
    resultSummary?: string;
    content?: string;
    toolCalls?: Array<{ name: string; args: string; result?: string }>;
  }>;

  /** The very last assistant output */
  lastOutput: {
    content: string;
    toolCalls?: Array<{ name: string; args: string; result?: string }>;
  };
  /** Total turns so far */
  totalTurns: number;
}

/**
 * Build a snapshot of recent agent activity for the observer.
 * We take the last N turns to keep the observer prompt manageable.
 */
function buildSnapshot(
  messages: Message[],
  toolResults: Map<string, string>,
  maxTurns: number = 5,
): ActivitySnapshot {
  const plan = planGet(''); // We'll pass sessionId separately
  // Reconstruct turns from messages
  const turns: ActivitySnapshot['recentTurns'] = [];
  let turnNum = 0;

  // Walk backwards through messages to find recent assistant/tool pairs
  const recentMsgs = messages.slice(-maxTurns * 3);
  for (let i = 0; i < recentMsgs.length; i++) {
    const msg = recentMsgs[i];
    if (msg.role === 'assistant' && msg.toolCalls) {
      turnNum++;
      const turn: ActivitySnapshot['recentTurns'][0] = {
        turn: turnNum,
        action: msg.content || '',
        content: msg.content,
        toolCalls: msg.toolCalls.map(tc => ({
          name: tc.name,
          args: JSON.stringify(tc.parameters),
          result: toolResults.get(tc.id) || '',
        })),
      };
      for (const tc of msg.toolCalls) {
        turn.tool = tc.name;
        const result = toolResults.get(tc.id) || '';
        turn.resultSummary = result.length > 200 ? result.substring(0, 200) + '...' : result;
        turn.toolCalls = [{
          name: tc.name,
          args: JSON.stringify(tc.parameters),
          result: result,
        }];
      }
      turns.push(turn);
    } else if (msg.role === 'assistant' && !msg.toolCalls) {
      // Final response (no tool calls) — this is the last turn
      turnNum++;
      turns.push({
        turn: turnNum,
        action: msg.content || '',
        content: msg.content,
      });
    }
  }

  // Reverse so turns are in chronological order
  turns.reverse();

  const lastOutput = turns.length > 0 ? turns[turns.length - 1] : { action: '', content: '', toolCalls: undefined };

  return {
    planTitle: plan?.title,
    planSteps: plan?.steps.map(s => ({ id: s.id, description: s.description, status: s.status })),
    recentTurns: turns.slice(-maxTurns),
    lastOutput: {
      content: lastOutput.action,
      toolCalls: lastOutput.toolCalls,
    },
    totalTurns: turns.length,
  };
}

/**
 * Build the observer prompt from the activity snapshot.
 */
function buildObserverPrompt(snapshot: ActivitySnapshot): string {
  const planSection = snapshot.planTitle
    ? `**PLAN**: "${snapshot.planTitle}"
${snapshot.planSteps?.map(s => `  - [${s.status.toUpperCase()}] ${s.description}`).join('\n') || ''}
`
    : '**PLAN**: No explicit plan.\n';

  const turnsSection = snapshot.recentTurns.map(t => {
    const toolInfo = t.tool ? ` (tool: ${t.tool})` : '';
    const resultInfo = t.resultSummary ? `\n    Result: ${t.resultSummary}` : '';
    return `  Turn ${t.turn}: ${t.action}${toolInfo}${resultInfo}`;
  }).join('\n');

  return `You are the Observer/Conductor for an AI agent system. Your job is to evaluate whether the agent is making progress toward its goals and intervene when it isn't.

${planSection}
**RECENT ACTIVITY** (last ${snapshot.recentTurns.length} turns):
${turnsSection}

**LAST OUTPUT**:
${snapshot.lastOutput.content || '(no visible content)'}
${snapshot.lastOutput.toolCalls?.map(tc => `  - Called ${tc.name}(${tc.args})`).join('\n') || ''}

**TOTAL TURNS SO FAR**: ${snapshot.totalTurns}

## EVALUATION CRITERIA

1. **ON_TRACK**: The agent is making clear progress toward plan goals or its stated objectives. Actions are logical and building on previous work.

2. **DRIFTING**: The agent is taking actions but they seem tangential to the main goal. It may be over-focusing on a minor detail or exploring unproductive paths.

3. **STUCK**: The agent is repeating similar actions without progress. It may be looping on an error, retrying the same approach, or unable to move forward.

4. **OFF_TRACK**: The agent has deviated significantly from its goals. It may be working on the wrong problem entirely.

5. **COMPLETE**: The agent has finished its task. All plan steps are done, or the user's request has been satisfied.

## WHAT TO LOOK FOR

- **Loops**: Same tool call or similar action repeated 2+ times
- **Diminishing returns**: Actions that produce the same result or add no new information
- **Scope creep**: Agent working on tangential problems not asked for by the user
- **Error fixation**: Agent stuck fixing the same error without trying alternatives
- **Abandonment**: Agent dropped its plan mid-way without reason

## OUTPUT FORMAT

Respond with ONLY a JSON object (no markdown, no explanation):

{
  "status": "on_track|drifting|stuck|off_track|complete",
  "concern": "Brief explanation of your assessment (or null if on_track)",
  "suggestion": "Specific actionable advice (or null if none needed). If stuck, suggest what to do instead. If drifting, redirect to the main goal.",
  "confidence": 0.0-1.0
}

Be decisive. If you see a problem, flag it. If the agent is doing well, say so briefly. Your suggestions should be concrete — not "focus on the goal" but "stop debugging X, move to implementing Y."`;
}

/**
 * Parse the observer's response into structured feedback.
 */
function parseObserverResponse(response: string): ObserverFeedback {
  try {
    // Try to extract JSON from the response (handle markdown wrapping)
    let jsonStr = response.trim();
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    const parsed = JSON.parse(jsonStr);
    return {
      status: parsed.status || 'on_track',
      concern: parsed.concern || undefined,
      suggestion: parsed.suggestion || undefined,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
    };
  } catch {
    // Fallback: if parsing fails, return a neutral assessment
    return {
      status: 'on_track',
      concern: undefined,
      suggestion: undefined,
      confidence: 0.0,
    };
  }
}

/**
 * Format feedback as a text block to inject into the main agent's context.
 */
function formatFeedbackForAgent(feedback: ObserverFeedback): string {
  if (!feedback.concern && !feedback.suggestion) {
    return '';
  }

  let block = `\n\n## Observer Feedback\n`;
  block += `**Assessment**: ${feedback.status}\n`;
  if (feedback.concern) {
    block += `**Concern**: ${feedback.concern}\n`;
  }
  if (feedback.suggestion) {
    block += `**Suggestion**: ${feedback.suggestion}\n`;
  }
  block += `**Confidence**: ${Math.round(feedback.confidence * 100)}%\n`;
  block += `Accept this feedback and adjust your approach accordingly.\n`;
  return block;
}

export class Observer {
  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!this.client) {
      const modelConfig = getObserverModelConfig();
      if (!modelConfig) {
        throw new Error('Observer model not configured');
      }
      this.client = new OpenAI({
        baseURL: modelConfig.endpoint,
        apiKey: modelConfig.apiKey || '',
      });
    }
    return this.client;
  }

  /**
   * Evaluate the current state and return structured feedback.
   * @param messages The conversation messages
   * @param toolResults Map of tool_call_id -> result
   * @param sessionId The session ID (for plan lookup)
   */
  async evaluate(
    messages: Message[],
    toolResults: Map<string, string>,
    sessionId: string,
  ): Promise<ObserverFeedback> {
    const modelConfig = getObserverModelConfig();
    if (!modelConfig) {
      return { status: 'on_track', confidence: 0.0 };
    }

    const snapshot = buildSnapshot(messages, toolResults);
    const prompt = buildObserverPrompt(snapshot);

    const timeoutMs = getObserverTimeoutMs();

    try {
      const response = await this.getClient().chat.completions.create({
        model: modelConfig.model,
        messages: [
          { role: 'system', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 1000,
        stream: false,
      }, {
        signal: AbortSignal.timeout(timeoutMs),
      });

      const content = response.choices[0]?.message?.content || '';
      return parseObserverResponse(content);
    } catch (err: any) {
      console.error(`[observer] evaluation failed: ${err.message}`);
      return { status: 'on_track', confidence: 0.0 };
    }
  }

  /**
   * Generate a focused suggestion for a specific problem.
   * Used when we want the observer to provide a targeted recommendation.
   */
  async suggest(messages: Message[], toolResults: Map<string, string>, issue: string): Promise<string> {
    const modelConfig = getObserverModelConfig();
    if (!modelConfig) return '';

    const snapshot = buildSnapshot(messages, toolResults);
    const prompt = `You are the Observer/Conductor. The agent is experiencing this specific issue:

**Issue**: ${issue}

${snapshot.planTitle ? `**Current plan**: "${snapshot.planTitle}"\n${snapshot.planSteps?.map(s => `  - [${s.status}] ${s.description}`).join('\n')}\n` : ''}
**Recent activity**:
${snapshot.recentTurns.map(t => `  Turn ${t.turn}: ${t.action} (tool: ${t.tool || 'none'})`).join('\n')}

Provide ONE specific, actionable suggestion to get the agent back on track. Be concrete — what should the agent do NEXT? Keep it under 2 sentences.`;

    try {
      const response = await this.getClient().chat.completions.create({
        model: modelConfig.model,
        messages: [{ role: 'system', content: prompt }],
        temperature: 0.5,
        max_tokens: 500,
        stream: false,
      }, {
        signal: AbortSignal.timeout(getObserverTimeoutMs()),
      });

      return response.choices[0]?.message?.content?.trim() || '';
    } catch (err: any) {
      console.error(`[observer] suggestion failed: ${err.message}`);
      return '';
    }
  }
}
