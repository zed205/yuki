'use client';

import { useState, useRef, useEffect, memo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ThinkingPill, ToolCallList } from './message-bubble';
import { MessageBubble } from './message-bubble';
import type { Message } from '@/lib/types';

// ---------------------------------------------------------------------------
// Utility: format seconds into "Xm Ys"
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

// ---------------------------------------------------------------------------
// TurnGroup: Codex Desktop-style accordion for a single assistant turn
// ---------------------------------------------------------------------------

export interface TurnGroupProps {
  /** Messages containing thinking/tool calls (no text content). */
  processMessages?: Message[];
  /** Message with the final text content. */
  finalMessage?: Message;
  /** Backwards compatibility: single message (used when no group is provided). */
  message?: Message;
}

/**
 * Renders an assistant turn as a Codex Desktop-style accordion:
 *
 * - While streaming: all parts expand live (thinking, tools, text).
 * - After streaming: collapses into a single-line header
 *   "thought 3 · 5 tools", with the final reply always visible below.
 * - Clicking the header re-expands the full trace.
 *
 * Accepts either:
 *  - `processMessages` + `finalMessage` for grouped turns (multiple messages)
 *  - `message` (legacy) for single-message turns
 */

/** Compare TurnGroup props by message identity rather than reference equality.
 * processMessages arrays are recreated every parent render, so we compare the
 * contained message IDs and key content fields to decide if re-render is needed. */
function turnGroupShouldUpdate(prev: TurnGroupProps, next: TurnGroupProps) {
  // If either legacy `message` prop changed identity, update
  if (prev.message !== next.message) return false;

  const prevProc = prev.processMessages || [];
  const nextProc = next.processMessages || [];
  
  // Compare arrays by message ID at each position
  const maxLen = Math.max(prevProc.length, nextProc.length);
  for (let i = 0; i < maxLen; i++) {
    if ((prevProc[i]?.id ?? null) !== (nextProc[i]?.id ?? null)) return false;
  }

  // Compare finalMessage by identity and key streaming-relevant fields
  const pf = prev.finalMessage;
  const nf = next.finalMessage;
  if (!pf && !nf) return true;
  if (!pf || !nf) return false;
  
  // If content identity hasn't changed, nothing in this turn-group materially changed
  return (
    pf.id === nf.id &&
    pf.content === nf.content &&
    pf.isStreaming === nf.isStreaming &&
    pf.compacted === nf.compacted
  );
}

export const TurnGroup = memo(function TurnGroup({
  message,
  processMessages: incomingProcessMessages,
  finalMessage: incomingFinalMessage,
}: TurnGroupProps) {
  // Support backwards compatibility with single message prop
  const processMessages = incomingProcessMessages ?? (message ? [message] : []);
  const finalMessage = incomingFinalMessage ?? message;

  // ── Aggregate thinking across all process messages ────────────────────────
  const messagesWithThinking = processMessages.filter(
    m => m.reasoningContent && m.reasoningContent.trim().length > 0,
  );
  const thinkingBlockCount = messagesWithThinking.length;
  const allReasoning = messagesWithThinking
    .map(m => m.reasoningContent ?? '')
    .join('\n\n');
  const hasThinking = thinkingBlockCount > 0;

  // ── Aggregate tool calls across all process messages ─────────────────────
  const allToolCalls = processMessages.flatMap(m => m.toolCalls || []);
  const toolCount = allToolCalls.length;
  const hasTools = toolCount > 0;

  // ── Streaming state: true if ANY message in the group is still streaming ─
  const isAnyStreaming =
    processMessages.some(m => m.isStreaming) || finalMessage?.isStreaming;

  // ── Text content check ───────────────────────────────────────────────────
  const hasText =
    finalMessage &&
    typeof finalMessage.content === 'string' &&
    finalMessage.content.trim().length > 0;

  const hasProcess = hasThinking || hasTools;

  // ── Expand / collapse state ──────────────────────────────────────────────
  const [expanded, setExpanded] = useState(isAnyStreaming);

  useEffect(() => {
    if (isAnyStreaming) {
      setExpanded(true);
    } else {
      setExpanded(false);
    }
  }, [isAnyStreaming]);

  // Duration: from the most recent message in the group to when streaming ended.
  // Uses the persisted streamingEndedAt so old turn groups (loaded from history)
  // also show correct durations — the endedRef approach was unreliable for those.
  // endedRef is a fallback for live streaming where streamingEndedAt hasn't been
  // set yet (the chat:response handler sets it when isStreaming transitions to false).
  const endedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isAnyStreaming && endedRef.current === null) {
      endedRef.current = Date.now();
    }
  }, [isAnyStreaming]);

  const allMessages = [
    ...processMessages,
    ...(finalMessage ? [finalMessage] : []),
  ];
  const latestTimestamp = allMessages.length > 0
    ? Math.max(...allMessages.map(m => new Date(m.timestamp).getTime()))
    : Date.now();

  // If any message in the group has streamingEndedAt, use the latest one.
  // Otherwise for old/history messages, use the latest message timestamp as a
  // reasonable approximation (streaming ended shortly after the last message).
  // For live streaming, fall back to endedRef which captures the current time.
  const streamingEndTimes = allMessages
    .map(m => m.streamingEndedAt)
    .filter((t): t is number => t != null);
  const endTime = streamingEndTimes.length > 0
    ? Math.max(...streamingEndTimes)
    : endedRef.current ?? latestTimestamp;

  const durationSec = Math.max(0, Math.floor((endTime - latestTimestamp) / 1000));
  const durationLabel = formatDuration(durationSec);

  // ── Build the accordion label ────────────────────────────────────────────
  // Format: "thought N · M tools" (completed) or "thinking · M tools" (streaming)
  const labelParts: string[] = [];
  if (hasThinking) {
    labelParts.push(isAnyStreaming ? 'thinking' : `thought ${thinkingBlockCount}`);
  }
  if (toolCount > 0) {
    labelParts.push(`${toolCount} tool${toolCount > 1 ? 's' : ''}`);
  }
  const label = labelParts.join(' · ');

  // No process content and no text → render nothing
  if (!hasProcess && !hasText) return null;

  // Only text content (no process) → render as a regular message bubble
  if (!hasProcess && hasText && finalMessage) {
    return (
      <div className="flex justify-start">
        <div className="min-w-0 max-w-[90%]">
          <MessageBubble
            role={finalMessage.role}
            content={finalMessage.content}
            isStreaming={finalMessage.isStreaming}
            compacted={finalMessage.compacted}
            timestamp={finalMessage.timestamp}
          />
        </div>
      </div>
    );
  }

  // ── Main render: accordion + optional text below ─────────────────────────
  return (
    <div className="mb-2 flex flex-col gap-2">
      {/* Accordion wrapper for process content (thinking + tools) */}
      {hasProcess && (
        <div className="flex justify-start">
          <div className="min-w-0 max-w-[90%]">
            {/* Collapsed header — always visible */}
            {!expanded && label && (
              <button
                type="button"
                className="flex w-full cursor-pointer select-none items-center gap-2 px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground hover:bg-muted/50"
                onClick={() => setExpanded(true)}
                title="Expand turn details"
              >
                <span className="flex-1 truncate font-medium">{label}</span>
                <span className="shrink-0 text-[#8b949e]">
                  {durationLabel}
                </span>
                <ChevronRight
                  size={12}
                  className="shrink-0 text-[#8b949e]"
                />
              </button>
            )}

            {/* Expanded content */}
            {expanded && (
              <div className="mt-1.5 flex flex-col gap-2">
                {/* Expanded header (retractable) */}
                <button
                  type="button"
                  className="flex w-full cursor-pointer select-none items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => setExpanded(false)}
                  title="Collapse turn details"
                >
                  <span className="flex-1 truncate font-medium">
                    {label}
                  </span>
                  <span className="shrink-0 text-[#8b949e]">
                    {isAnyStreaming ? durationLabel : ''}
                  </span>
                  <span className="shrink-0 text-[#8b949e]">
                    {isAnyStreaming ? ' · active' : ''}
                  </span>
                  <ChevronDown
                    size={12}
                    className="shrink-0 text-[#8b949e]"
                  />
                </button>

                {/* Thinking block — aggregated from all process messages */}
                {hasThinking && (
                  <ThinkingPill
                    content={allReasoning}
                    streaming={isAnyStreaming}
                    compacted={processMessages[0]?.compacted}
                  />
                )}

                {/* Tool calls — aggregated from all process messages */}
                {hasTools && (
                  <ToolCallList toolCalls={allToolCalls} />
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Final reply — always visible below the accordion */}
      {hasText && finalMessage && (
        <div className="flex justify-start">
          <div className="min-w-0 max-w-[90%]">
            <MessageBubble
              role={finalMessage.role}
              content={finalMessage.content}
              isStreaming={finalMessage.isStreaming}
              compacted={finalMessage.compacted}
              timestamp={finalMessage.timestamp}
            />
          </div>
        </div>
      )}
    </div>
  );
}, turnGroupShouldUpdate);
