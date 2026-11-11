'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message } from '@/lib/types';
import { MarkdownContent } from './markdown';

export interface MessageBubbleProps {
  role: Message['role'] | 'agent';
  content: string;
  toolCalls?: Message['toolCalls'];
  reasoningContent?: string;
  isStreaming?: boolean;
  compacted?: boolean;
  timestamp?: Date | number;
  agentName?: string;
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
  const { role, content, toolCalls, reasoningContent, isStreaming, compacted, timestamp, agentName } = props;

  const isUser = role === 'user';
  const isAssistant = role === 'assistant';
  const isSystem = role === 'system';
  const isAgent = role === 'agent';

  const timeString = timestamp
    ? new Date(timestamp as never).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

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
          'relative group max-w-[90%] md:max-w-[80%] lg:max-w-[75%]',
        )}
      >
        <div
          className={cn(
            'rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
            isUser &&
              'rounded-br-md border border-[#2e5a8f] bg-[#1c3a5f] text-[#e6edf3]',
            isAssistant &&
              'rounded-2xl border border-[#30363d] bg-[#161b22] text-[#c9d1d9]',
            isSystem &&
              'rounded-xl border border-[#30363d] bg-[#1c2028] text-xs text-[#8b949e]',
            isAgent &&
              'rounded-2xl border border-[#2d4a6e] bg-[#162032] text-[#79c0ff]',
          )}
        >
          {/* Agent header */}
          {isAgent && (
            <div className="mb-2 flex items-center gap-2 border-b border-[#2d4a6e]/50 pb-2">
              <span className="text-xs font-medium text-[#58a6ff]">Agent</span>
              {agentName && (
                <span className="truncate text-xs text-[#79c0ff]/70">{agentName}</span>
              )}
            </div>
          )}

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
        </div>

        {/* Hover action menu */}
        <div
          className={cn(
            'absolute top-2 opacity-0 transition-opacity group-hover:opacity-100',
            isUser ? '-left-6' : '-right-6',
          )}
        >
          <button
            className="p-0.5 text-xs leading-none text-[#8b949e] hover:text-[#c9d1d9]"
            title="Options"
          >
            ···
          </button>
        </div>
      </div>
    </div>
  );
}
