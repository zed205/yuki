import { createSignal, Show, For, splitProps } from 'solid-js';
import { CodeBlock } from './CodeBlock';
import { useSession } from '../../context/SessionContext';

export interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system' | 'agent';
  content: string;
  isStreaming?: boolean;
  compacted?: boolean;
  timestamp?: number;
  agentName?: string;
}

/**
 * Renders a chat message bubble with role-appropriate styling.
 * Supports markdown, code blocks, thinking blocks, and streaming cursors.
 */
export function MessageBubble(props: MessageBubbleProps) {
  const { isStreaming } = useSession();

  const [local] = splitProps(props, [
    'role',
    'content',
    'isStreaming',
    'compacted',
    'timestamp',
    'agentName',
  ]);

  // --- Theme classes ---
  const opacityClass = local.compacted ? 'opacity-40' : '';

  const isUser = local.role === 'user';
  const isAssistant = local.role === 'assistant';
  const isSystem = local.role === 'system';
  const isAgent = local.role === 'agent';

  // --- Render time string ---
  const timeString = () => {
    if (!local.timestamp) return '';
    return new Date(local.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // --- Streaming cursor indicator ---
  const StreamingCursor = () => (
    <span class="inline-block w-2 h-4 bg-[#58a6ff] animate-pulse ml-1 align-middle" />
  );

  // --- Render thinking block ---
  const ThinkingBlock = (props: { content: string }) => {
    const [open, setOpen] = createSignal(false);

    return (
      <details
        class={`bg-[#161b22]/60 border border-[#d29922]/20 rounded-md text-xs group ${opacityClass}`}
      >
        <summary
          class="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-[#8b949e] hover:text-[#c9d1d9] rounded-md list-none select-none"
          onClick={(e) => {
            e.preventDefault();
            setOpen(!open());
          }}
        >
          <span
            class={`text-[#8b949e] transition-transform text-[10px] ${open() ? 'rotate-90' : ''}`}
          >
            ▶
          </span>
          <span class="text-[#d29922] font-medium">
            {open() ? 'Thinking...' : 'Thought'}
          </span>
        </summary>
        <div class="px-3 pb-2 pt-2 text-[#8b949e] border-t border-[#d29922]/10 mt-1 text-xs leading-relaxed whitespace-pre-wrap break-words font-mono">
          {props.content}
        </div>
      </details>
    );
  };

  // --- Parse assistant content into thinking blocks and text ---
  const renderAssistantContent = () => {
    const content = local.content;
    if (!content) return null;

    // Split on think blocks
    const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
    const parts: Array<{ type: 'think' | 'text'; content: string }> = [];
    let lastIndex = 0;
    let match;

    while ((match = thinkRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: content.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'think', content: match[1].trim() });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < content.length) {
      parts.push({ type: 'text', content: content.slice(lastIndex) });
    }

    // If no think blocks found, render as plain text content
    if (parts.length === 0) {
      return <MarkdownContent content={content} />;
    }

    return (
      <div class="flex flex-col gap-1">
        <For each={parts}>
          {(part) =>
            part.type === 'think' ? (
              <ThinkingBlock key={`think-${part.content.slice(0, 30)}`} content={part.content} />
            ) : (
              <MarkdownContent key={`text-${part.content.slice(0, 30)}`} content={part.content} />
            )
          }
        </For>
      </div>
    );
  };

  // --- Markdown content renderer (SolidJS-compatible) ---
  const MarkdownContent = (props: { content: string }) => {
    const { escapeForHtml, parseInlineMarkdown } = useMarkdownHelpers();

    const text = props.content;
    if (!text) return null;

    // First, extract fenced code blocks and replace with placeholders
    const codeBlocks: Array<{ lang: string; code: string }> = [];
    let processed = text.replace(
      /```(\w*)\n([\s\S]*?)```/g,
      (_, lang, code) => {
        const idx = codeBlocks.length;
        codeBlocks.push({ lang: lang || '', code });
        return `%%CODEBLOCK_${idx}%%`;
      }
    );

    // Parse inline markdown (bold, italic, code, links)
    // Process inline code blocks first to protect them
    const inlineCodeBlocks: string[] = [];
    processed = processed.replace(/`([^`]+)`/g, (_, code) => {
      const idx = inlineCodeBlocks.length;
      inlineCodeBlocks.push(code);
      return `%%INLINECODE_${idx}%%`;
    });

    // Escape HTML
    processed = escapeForHtml(processed);

    // Bold
    processed = processed.replace(/\*\*(.+?)\*\*/g, '<strong class="text-[#58a6ff] font-medium">$1</strong>');

    // Italic
    processed = processed.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Links
    processed = processed.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" class="text-[#58a6ff] hover:text-[#79c0ff] underline-offset-2 hover:underline" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    // Restore inline code
    processed = processed.replace(
      /%%INLINECODE_(\d+)%%/g,
      (_, idx) => {
        const code = inlineCodeBlocks[parseInt(idx)];
        return `<code class="bg-[#21262d] border border-[#30363d] rounded px-1 py-0.5 text-[#c9d1d9] text-sm font-mono">${code}</code>`;
      }
    );

    // Restore code blocks
    processed = processed.replace(
      /%%CODEBLOCK_(\d+)%%/g,
      (_, idx) => {
        const block = codeBlocks[parseInt(idx)];
        return `<div data-codeblock-idx="${idx}"></div>`;
      }
    );

    // Line breaks to <br>
    processed = processed.replace(/\n/g, '<br />');

    return (
      <div class="flex flex-col gap-0.5">
        <For each={codeBlocks}>
          {(block, idx) => (
            <Show when={idx() < codeBlocks.length}>
              <div
                key={`cb-${idx()}`}
                id={`cb-container-${idx()}`}
              />
            </Show>
          )}
        </For>
        <div
          class="message-content"
          innerHTML={processed}
        />
        {/* Render code blocks after the HTML content so SolidJS can hydrate them */}
        <For each={codeBlocks}>
          {(block, idx) => (
            <CodeBlock
              key={`cb-${idx()}`}
              language={block.lang}
              code={block.code}
            />
          )}
        </For>
      </div>
    );
  };

  // --- Determine wrapper alignment ---
  const justifyContent = () => (isUser ? 'justify-end' : 'justify-start');

  return (
    <div class={`flex ${justifyContent()} mb-2 ${opacityClass}`}>
      <div class="relative group max-w-[90%] md:max-w-[80%] lg:max-w-[75%]">
        {/* Message bubble */}
        <div
          class={[
            'rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
            // User: right-aligned, blue background
            isUser &&
              'bg-[#1c3a5f] border border-[#2e5a8f] rounded-br-md text-[#e6edf3]',
            // Assistant: left-aligned, dark background with subtle border
            isAssistant &&
              'bg-[#161b22] border border-[#30363d] rounded-2xl text-[#c9d1d9]',
            // System: compact, dimmed
            isSystem &&
              'bg-[#1c2028] border border-[#30363d] rounded-xl text-xs text-[#8b949e]',
            // Agent: left-aligned, blue-tinted
            isAgent &&
              'bg-[#162032] border border-[#2d4a6e] rounded-2xl text-[#79c0ff]',
          ].join(' ')}
        >
          {/* Agent header */}
          <Show when={isAgent}>
            <div class="flex items-center gap-2 mb-2 pb-2 border-b border-[#2d4a6e]/50">
              <span class="text-[#58a6ff] text-xs font-medium">Agent</span>
              <Show when={local.agentName}>
                <span class="text-xs text-[#79c0ff]/70 truncate">{local.agentName}</span>
              </Show>
            </div>
          </Show>

          {/* Content */}
          <div class="message-content break-words">
            <Show
              when={isAssistant}
              fallback={
                isUser ? (
                  <p class="whitespace-pre-wrap break-words">{local.content}</p>
                ) : (
                  <p>{local.content}</p>
                )
              }
            >
              {renderAssistantContent()}
            </Show>

            {/* Streaming cursor */}
            <Show when={local.isStreaming && isAssistant}>
              <StreamingCursor />
            </Show>
          </div>

          {/* Timestamp */}
          <Show when={timeString()}>
            <div
              class={[
                'text-[10px] text-[#8b949e]/60 mt-1.5',
                isUser ? 'text-right' : '',
              ].join(' ')}
            >
              {timeString()}
            </div>
          </Show>
        </div>

        {/* Action menu button (appears on hover) */}
        <div class="absolute top-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Show when={isUser}>
            <button
              class="msg-menu-btn -left-6 text-[#8b949e] hover:text-[#c9d1d9] text-xs leading-none p-0.5"
              title="Options"
            >
              ···
            </button>
          </Show>
          <Show when={isAssistant}>
            <button
              class="msg-menu-btn -right-6 text-[#8b949e] hover:text-[#c9d1d9] text-xs leading-none p-0.5"
              title="Options"
            >
              ···
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
}

/**
 * Markdown helper utilities as a SolidJS signal-based context.
 */
function useMarkdownHelpers() {
  const escapeForHtml = (text: string) =>
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  return { escapeForHtml };
}
