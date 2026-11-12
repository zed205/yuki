'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message, SubAgentInfo } from '@/lib/types';
import { MarkdownContent } from './markdown';
import { ObserverFeedbackBlock } from './observer-feedback';

/** Compaction summary messages begin with this prefix (legacy parity). */
const SUMMARY_PREFIX = 'Summary of previous conversation:';
const isSummaryMessage = (m: { role: string; content: string }) =>
  m.role === 'system' &&
  typeof m.content === 'string' &&
  m.content.startsWith(SUMMARY_PREFIX);

export interface MessageBubbleProps {
  role: Message['role'] | 'agent';
  content: string;
  toolCalls?: Message['toolCalls'];
  reasoningContent?: string;
  isStreaming?: boolean;
  compacted?: boolean;
  timestamp?: Date | number;
  agentName?: string;
  /** Forked from session id (legacy "⟿ Forked from session" indicator). */
  forkedFrom?: string;
  /** Observer feedback block (amber). */
  observerFeedback?: Message['observerFeedback'];
  /** Whether this message is a "stopped" notice pill. */
  stoppedNotice?: boolean;
  /** Sub-agent ID — used to look up status from subagents state. */
  agentId?: string;
  /** Live sub-agent data (status, model, nested thinking/tools/response). */
  subAgent?: SubAgentInfo;
  /** Callback when user clicks Revert on this message. */
  onRevert?: () => void;
  /** Callback when user clicks Compact on this message. */
  onCompact?: () => void;
  /** Callback when user clicks Fork on this message. */
  onFork?: () => void;
  /** Callback when user clicks Read (assistant messages). */
  onRead?: () => void;
  /** Forks created from this message (original-session "(N) [fork links]"). */
  forks?: Array<{ sessionId: string; title?: string }>;
  /** Callback to navigate to a fork session. */
  onForkNavigate?: (sessionId: string) => void;
  /** Whether this message is part of a TT-group (consecutive thinking/tool). */
  isTTGroup?: boolean;
  /** Index within the TT-group (for dashed border styling). */
  ttGroupIndex?: number;
  /** Total in the TT-group. */
  ttGroupTotal?: number;
}

/**
 * Renders a chat message bubble with role-appropriate styling.
 * Supports markdown, code blocks, thinking blocks, tool calls, and streaming cursors.
 */

function ThinkingBlock({ content, streaming }: { content: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-[#d29922]/20 bg-[#161b22]/60 text-xs">
      <button
        className="flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-3 py-1.5 text-[#8b949e] hover:text-[#c9d1d9]"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronRight size={10} className="rotate-90 text-[#8b949e]" />
        ) : (
          <ChevronRight size={10} className="text-[#8b949e]" />
        )}
        <span className="font-medium text-[#d29922]">
          {streaming ? 'Thinking…' : open ? 'Thought' : 'Thought'}
        </span>
      </button>
      <div className="mt-1 border-t border-[#d29922]/10 px-3 pb-2 pt-2 font-mono text-xs leading-relaxed text-[#8b949e] whitespace-pre-wrap break-words">
        {content}
      </div>
    </div>
  );
}

function ToolCallList({ toolCalls }: { toolCalls: NonNullable<Message['toolCalls']> }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  if (!toolCalls?.length) return null;

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="mt-2 flex flex-col gap-1">
      {toolCalls.map((tool) => {
        const isExpanded = expanded.has(tool.id);
        const status = tool.status || 'pending';
        return (
          <div key={tool.id}>
            <button
              className={cn(
                'flex items-center gap-2 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium transition-colors hover:border-border',
                status === 'error'
                  ? 'border-red-500/30 bg-red-500/10 text-red-400'
                  : status === 'completed'
                    ? 'border-green-500/30 bg-green-500/10 text-green-400'
                    : 'bg-muted/50 text-muted-foreground hover:text-foreground',
              )}
              onClick={() => toggle(tool.id)}
            >
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span className="font-mono">{tool.name}</span>
              {status === 'running' && <span className="animate-pulse">…</span>}
              {status === 'error' && <span>✗</span>}
            </button>
            {isExpanded && (
              <div className="ml-2 mt-1">
                <pre className="overflow-x-auto rounded-lg bg-[#0d1117] p-3 font-mono text-xs text-[#8b949e]">
                  <code>
                    {`Input: ${JSON.stringify(tool.parameters ?? {}, null, 2)}`}
                    {'\n\n'}
                    {`Output: ${tool.result || 'No output'}`}
                  </code>
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StreamingCursor() {
  return (
    <span className="ml-1 inline-block h-4 w-2 animate-pulse bg-[#58a6ff] align-middle" />
  );
}

/** Status badge text + colors for a sub-agent (legacy agentStatusBadge). */
function agentStatusBadge(status: string): { text: string; cls: string } {
  switch (status) {
    case 'running':
      return { text: 'running', cls: 'bg-blue-500/15 text-blue-300 border-blue-500/30' };
    case 'queued':
      return { text: 'queued', cls: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30' };
    case 'completed':
      return { text: 'done', cls: 'bg-green-500/15 text-green-300 border-green-500/30' };
    case 'error':
      return { text: 'error', cls: 'bg-red-500/15 text-red-300 border-red-500/30' };
    case 'cancelled':
      return { text: 'cancelled', cls: 'bg-muted text-muted-foreground border-border' };
    default:
      return { text: status, cls: 'bg-muted text-muted-foreground border-border' };
  }
}

/**
 * Sub-agent bubble (legacy light-blue Agent bubble): collapsed by default, a
 * single summary line with status/progress; expand to inspect the child's
 * thinking, tool calls and final report.
 */
function SubAgentBubble({ subAgent }: { subAgent?: SubAgentInfo }) {
  const [open, setOpen] = useState(false);
  if (!subAgent) {
    return (
      <div className="rounded-lg border border-[#355975] bg-[#1e3446] px-3 py-2 text-xs text-[#9ed3f5]">
        Agent
      </div>
    );
  }
  const badge = agentStatusBadge(subAgent.status);
  const isLive = subAgent.status === 'running' || subAgent.status === 'queued';
  return (
    <div className="w-full min-w-0 rounded-lg border border-[#355975] bg-[#1e3446] text-sm">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-[#2a4a6b]/40"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight
          size={10}
          className={cn('shrink-0 text-[#9ed3f5]/70 transition-transform', open && 'rotate-90')}
        />
        <span className="shrink-0 font-medium text-[#9ed3f5]">Agent</span>
        <span className="min-w-0 truncate text-[#c9d1d9]/90" title={subAgent.task || subAgent.description || ''}>
          {subAgent.description || subAgent.task || 'Sub-agent'}
        </span>
        {subAgent.model && (
          <span className="hidden shrink-0 text-[10px] text-[#9ed3f5]/60 sm:inline">{subAgent.model}</span>
        )}
        <span
          className={cn(
            'ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium',
            badge.cls,
            isLive && 'animate-pulse',
          )}
        >
          {badge.text}
        </span>
      </button>
      {open && (
        <div className="border-t border-[#355975]/60 px-3 pb-2 pt-1">
          {subAgent.task && (
            <div className="mb-2 max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-[11px] text-[#9ed3f5]/80">
              Task: {subAgent.task}
            </div>
          )}
          <div className="flex flex-col gap-2">
            {subAgent.thinking && (
              <ThinkingBlock content={subAgent.thinking} streaming={isLive} />
            )}
            {subAgent.toolCalls && subAgent.toolCalls.length > 0 && (
              <ToolCallList toolCalls={subAgent.toolCalls} />
            )}
            {(subAgent.content || subAgent.error) && (
              <div className="mt-1">
                {subAgent.error ? (
                  <div className="text-xs text-red-300">{subAgent.error}</div>
                ) : subAgent.content ? (
                  <MarkdownContent content={subAgent.content} />
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compaction summary card (legacy teal "Compaction" card): a collapsible
 * details-style block, collapsed by default, that shows the compaction text.
 */
function SummaryCard({ content, compacted }: { content: string; compacted?: boolean }) {
  const [open, setOpen] = useState(false);
  const body = content.slice(SUMMARY_PREFIX.length).replace(/^\n/, '');
  return (
    <div className={cn('my-2 flex justify-start', compacted && 'opacity-40')}>
      <details
        open={open}
        onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
        className="group w-full rounded-xl border border-[#4d5b5e] bg-[#394548] text-sm"
      >
        <summary className="flex cursor-pointer select-none items-center gap-2 rounded-xl px-4 py-2.5 text-[#c9d1d9] list-none">
          <ChevronRight
            size={10}
            className={cn('text-[#8b949e] transition-transform', open && 'rotate-90')}
          />
          <span className="text-sm leading-relaxed">Compaction</span>
        </summary>
        <div className="border-t border-[#4d5b5e]/50 px-4 pt-1 pb-2.5 text-[#c9d1d9]/70 whitespace-pre-wrap break-words leading-relaxed">
          {body}
        </div>
      </details>
    </div>
  );
}

/**
 * TT-group (legacy `tt-group`): collapses a run of thinking + tool activity
 * into a single dashed pill showing the latest operation. Click to expand the
 * full thinking/tool history.
 */
function TTGroup({
  reasoning,
  toolCalls,
  streaming,
}: {
  reasoning?: string;
  toolCalls?: NonNullable<Message['toolCalls']>;
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const lastTool = toolCalls && toolCalls.length > 0 ? toolCalls[toolCalls.length - 1] : null;
  const label = lastTool ? `${lastTool.name} ${lastTool.status}` : 'Thought';
  return (
    <div className="my-1 flex justify-start">
      <div className="w-full">
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-[#30363d] px-3 py-1.5 text-left text-xs text-[#8b949e] transition-colors hover:border-[#58a6ff]/40 hover:bg-[#21262d]/50 hover:text-[#c9d1d9]"
          onClick={() => setOpen((v) => !v)}
          title={open ? 'Collapse thinking/tool history' : 'Expand thinking/tool history'}
        >
          <span className="shrink-0 text-[10px]">{open ? '▼' : '▶'}</span>
          <span className="min-w-0 truncate">{label}</span>
        </button>
        {open && (
          <div className="mt-2 flex flex-col gap-2">
            {reasoning && <ThinkingBlock content={reasoning} streaming={streaming} />}
            {toolCalls && toolCalls.length > 0 && <ToolCallList toolCalls={toolCalls} />}
          </div>
        )}
      </div>
    </div>
  );
}

/** Split assistant content into think/text parts based on  blocks. */
function splitThinkBlocks(content: string): Array<{ type: 'think' | 'text'; content: string }> {
  const thinkRegex = /&lt;think&gt;([\s\S]*?)&lt;\/think&gt;|<think>([\s\S]*?)<\/think>/g;
  const parts: Array<{ type: 'think' | 'text'; content: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = thinkRegex.exec(content)) !== null) {
    const inner = (match[2] ?? match[1] ?? '').trim();
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: content.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'think', content: inner });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    parts.push({ type: 'text', content: content.slice(lastIndex) });
  }
  return parts;
}

export function MessageBubble(props: MessageBubbleProps) {
  const {
    role,
    content,
    toolCalls,
    reasoningContent,
    isStreaming,
    compacted,
    timestamp,
    observerFeedback,
    stoppedNotice,
    agentId,
    subAgent,
    onRevert,
    onCompact,
    onFork,
    onRead,
    forks,
    onForkNavigate,
    isTTGroup,
  } = props;

  const isUser = role === 'user';
  const isAssistant = role === 'assistant';
  const isSystem = role === 'system';
  const isAgent = role === 'agent' || !!agentId;

  const timeString = timestamp
    ? new Date(timestamp as never).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  // TT-group: dashed border on first/last items
  const ttBorder = isTTGroup
    ? 'border-dashed border-[#58a6ff]/30 bg-[#161b22]/40'
    : undefined;

  // Stopped notice (centered pill, legacy "[Action stopped]")
  if (stoppedNotice) {
    return (
      <div className="my-2 flex justify-center">
        <div className="rounded-xl border border-[#30363d]/50 bg-[#161b22]/60 px-4 py-2 text-sm italic text-[#f85149]/70">
          [Action stopped]
        </div>
      </div>
    );
  }

  // Sub-agent bubble (light-blue, collapsible, live data)
  if (isAgent) {
    return (
      <div className={cn('mb-2 flex justify-start', compacted && 'opacity-40')}>
        <div className="w-full">
          <SubAgentBubble subAgent={subAgent} />
        </div>
      </div>
    );
  }

  // Compaction summary (teal card)
  if (isSummaryMessage({ role, content })) {
    return <SummaryCard content={content} compacted={compacted} />;
  }

  // TT-group: a working assistant turn (thinking/tools, no final text yet)
  // collapses into a single dashed pill.
  if (isTTGroup && role === 'assistant') {
    return (
      <TTGroup reasoning={reasoningContent} toolCalls={toolCalls} streaming={isStreaming} />
    );
  }

  return (
    <div
      className={cn(
        'mb-2 flex',
        isUser ? 'justify-end' : 'justify-start',
        compacted && 'opacity-40',
      )}
    >
      <div
        className={cn(
          'relative group w-full',
        )}
      >
        <div
          className={cn(
            'rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
            isUser &&
              'rounded-br-md border border-[var(--yuki-user-bubble-border)] bg-[var(--yuki-user-bubble-bg)] text-[var(--yuki-user-bubble-text)]',
            isAssistant &&
              'rounded-2xl border border-[var(--yuki-asst-bubble-border)] bg-[var(--yuki-asst-bubble-bg)] text-[var(--yuki-asst-bubble-text)]',
            isSystem &&
              'rounded-xl border border-[#30363d] bg-[#1c2028] text-xs text-[#8b949e]',
            ttBorder,
          )}
        >
          {/* Content */}
          <div className="break-words">
            {isAssistant ? (
              <div className="flex flex-col gap-1">
                {reasoningContent && (
                  <ThinkingBlock content={reasoningContent} streaming={isStreaming} />
                )}
                {(() => {
                  const parts = splitThinkBlocks(content);
                  if (parts.length === 0) return <MarkdownContent content={content} />;
                  return parts.map((part, i) =>
                    part.type === 'think' ? (
                      <ThinkingBlock key={`think-${i}`} content={part.content} />
                    ) : (
                      <MarkdownContent key={`text-${i}`} content={part.content} />
                    ),
                  );
                })()}
                {isStreaming && <StreamingCursor />}
              </div>
            ) : isUser ? (
              <p className="whitespace-pre-wrap break-words">{content}</p>
            ) : (
              <p className="italic">{content}</p>
            )}

            {/* Tool calls (assistant turns) */}
            {toolCalls && toolCalls.length > 0 && (
              <ToolCallList toolCalls={toolCalls} />
            )}

            {/* Observer feedback (amber block) */}
            {observerFeedback && (
              <ObserverFeedbackBlock feedback={observerFeedback} />
            )}
          </div>

          {/* Timestamp */}
          {timeString && (
            <div
              className={cn(
                'mt-1.5 text-[10px] text-[#8b949e]/60',
                isUser ? 'text-right' : '',
              )}
            >
              {timeString}
            </div>
          )}

          {/* Fork links (legacy "(N) [fork links]" on the source message) */}
          {forks && forks.length > 0 && onForkNavigate && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1 text-xs">
              <span className="text-[#8b949e]/60">
                {forks.length} fork{forks.length > 1 ? 's' : ''}
              </span>
              {forks.map((f) => (
                <button
                  key={f.sessionId}
                  type="button"
                  className="text-[#58a6ff]/80 hover:text-[#c9d1d9] cursor-pointer"
                  title={f.title || 'Forked session'}
                  onClick={() => onForkNavigate(f.sessionId)}
                >
                  {f.title || f.sessionId.substring(0, 8)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Hover action menu (legacy parity) */}
        <div
          className={cn(
            'absolute top-2 opacity-0 transition-opacity group-hover:opacity-100',
            isUser ? '-left-6' : '-right-6',
          )}
        >
          <div className="rounded-md border border-[#30363d] bg-[#161b22] px-1.5 py-1 shadow-lg">
            {isUser && (
              <>
                {onRevert && (
                  <button
                    type="button"
                    className="block w-full px-2 py-1 text-left text-xs text-[#8b949e] hover:text-[#c9d1d9]"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRevert();
                    }}
                  >
                    Revert
                  </button>
                )}
                {onCompact && (
                  <button
                    type="button"
                    className="block w-full px-2 py-1 text-left text-xs text-[#8b949e] hover:text-[#c9d1d9]"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCompact();
                    }}
                  >
                    Compact
                  </button>
                )}
              </>
            )}
            {isAssistant && (
              <>
                {onRead && (
                  <button
                    type="button"
                    className="block w-full px-2 py-1 text-left text-xs text-[#8b949e] hover:text-[#c9d1d9]"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRead();
                    }}
                  >
                    Read
                  </button>
                )}
                {onFork && (
                  <button
                    type="button"
                    className="block w-full px-2 py-1 text-left text-xs text-[#8b949e] hover:text-[#c9d1d9]"
                    onClick={(e) => {
                      e.stopPropagation();
                      onFork();
                    }}
                  >
                    Fork
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
