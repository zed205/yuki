'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ThinkingPill, ToolCallPill, ToolCallList } from './message-bubble';
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
  message: Message;
}

/**
 * Renders an assistant turn as a Codex Desktop-style accordion:
 *
 * - While streaming: all parts expand live (thinking, tools, text).
 * - After streaming: collapses into a single-line header
 *   "Thinking · 3 tools · lasted 1m 12s", with the final reply always
 *   visible below. Clicking the header re-expands the full trace.
 *
 * This mirrors Codex Desktop's "Worked for X" accordion pattern.
 */
export function TurnGroup({ message }: TurnGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const hasThinking = !!message.reasoningContent;
  const hasTools = !!message.toolCalls?.length;
  const hasText =
    typeof message.content === 'string' && message.content.trim().length > 0;
  const hasProcess = hasThinking || hasTools;
  const isStreaming = message.isStreaming;

  // Auto-expand while streaming, collapse when done.
  useEffect(() => {
    if (isStreaming) {
      setExpanded(true);
    }
  }, [isStreaming]);

  // Calculate duration from message timestamp to now (or to the last tool call).
  const durationRef = useRef<HTMLSpanElement>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isStreaming) return;
    // Update every second while streaming for live duration
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isStreaming]);

  const durationMs = Date.now() - new Date(message.timestamp).getTime();
  const durationSec = Math.max(0, Math.floor(durationMs / 1000));
  const durationLabel = formatDuration(durationSec);
  const toolCount = hasTools ? message.toolCalls!.length : 0;

  // Build the accordion label
  const labelParts: string[] = [];
  if (hasThinking) labelParts.push('Thinking');
  if (toolCount > 0) {
    labelParts.push(`${toolCount} tool${toolCount > 1 ? 's' : ''}`);
  }

  return (
    <div className="mb-2 flex flex-col gap-2">
      {/* Accordion wrapper for process content (thinking + tools) */}
      {hasProcess && (
        <div className="flex justify-start">
          <div className="min-w-0 max-w-[90%]">
            {/* Collapsed header — always visible */}
            {!expanded && (
              <button
                type="button"
                className="flex w-full cursor-pointer select-none items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground hover:bg-muted/50"
                onClick={() => setExpanded(true)}
                title="Expand turn details"
              >
                <ChevronRight
                  size={12}
                  className="shrink-0 text-[#8b949e]"
                />
                <span className="truncate font-medium">
                  {labelParts.join(' · ')}
                </span>
                <span className="ml-auto shrink-0 text-[#8b949e]">
                  {durationLabel}
                </span>
              </button>
            )}

            {/* Expanded content */}
            {expanded && (
              <div className="mt-1.5 flex flex-col gap-2">
                {/* Expanded header (retractable) */}
                <button
                  type="button"
                  className="flex w-full cursor-pointer select-none items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => setExpanded(false)}
                  title="Collapse turn details"
                >
                  <ChevronDown
                    size={12}
                    className="shrink-0 text-[#8b949e]"
                  />
                  <span className="truncate font-medium">
                    {labelParts.join(' · ')}
                  </span>
                  {/* Live duration */}
                  <span
                    ref={durationRef}
                    className="ml-auto shrink-0 text-[#8b949e]"
                  >
                    {isStreaming ? durationLabel : ''}
                  </span>
                  <span className="ml-1 shrink-0 text-[#8b949e]">
                    {isStreaming ? ' · active' : ''}
                  </span>
                </button>

                {/* Thinking block */}
                {hasThinking && (
                  <ThinkingPill
                    content={message.reasoningContent!}
                    streaming={isStreaming}
                    compacted={message.compacted}
                  />
                )}

                {/* Tool calls */}
                {hasTools && (
                  <ToolCallList toolCalls={message.toolCalls!} />
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Final reply — always visible below the accordion */}
      {hasText && (
        <div className="flex justify-start">
          <div className="min-w-0 max-w-[90%]">
            <MessageBubble
              role={message.role}
              content={message.content}
              isStreaming={isStreaming}
              compacted={message.compacted}
              timestamp={message.timestamp}
            />
          </div>
        </div>
      )}
    </div>
  );
}
