import {
  createSignal,
  createEffect,
  createMemo,
  onMount,
  Show,
  For,
  type JSX,
  splitProps,
} from 'solid-js';
import Textarea from '../ui/Textarea';
import { IconButton } from '../ui/IconButton';
import { Text } from '../ui/Box';
import Badge from '../ui/Badge';
import { cn } from '../../lib/utils';
import { useWebSocket } from '../../context/WebSocketContext';
import { useSession } from '../../context/SessionContext';
import { useAudio } from '../../context/AudioContext';

interface ChatPanelProps {
  className?: string;
}

// ---------------------------------------------------------------------------
// Chat message display component
// ---------------------------------------------------------------------------

function ChatMessage(props: {
  role: string;
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    parameters?: Record<string, unknown>;
    result?: string;
    status?: string;
  }>;
  isStreaming?: boolean;
}) {
  const [collapsedTools, setCollapsedTools] = createSignal<Set<string>>(new Set());

  const toggleTool = (toolId: string) => {
    setCollapsedTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  };

  const formatContent = (text: string) => {
    // Basic markdown-like formatting: code blocks, inline code, bold, etc.
    return text
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-surface2/50 p-3 rounded-lg my-2 text-xs overflow-x-auto font-mono"><code>$2</code></pre>')
      .replace(/`([^`]+)`/g, '<code class="bg-surface2/50 px-1.5 py-0.5 rounded text-xs font-mono">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br/>');
  };

  return (
    <div class={cn(
      'flex gap-3 px-4 py-4 max-w-3xl mx-auto',
      props.role === 'user' ? '' : '',
    )}>
      {/* Avatar */}
      <div class={cn(
        'w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-medium',
        props.role === 'user'
          ? 'bg-primary/20 text-primary'
          : props.role === 'assistant' || props.role === 'agent'
            ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
            : 'bg-surface2 text-muted-foreground',
      )}>
        {props.role === 'user' ? 'U' : props.role === 'assistant' || props.role === 'agent' ? 'A' : 'S'}
      </div>

      {/* Message content */}
      <div class="flex-1 min-w-0">
        {/* Role label + metadata */}
        <div class="flex items-center gap-2 mb-1">
          <Text size="xs" weight="semibold" class="text-muted-foreground">
            {props.role === 'user'
              ? 'You'
              : props.role === 'assistant'
                ? 'Assistant'
                : props.role === 'agent'
                  ? 'Agent'
                  : 'System'}
          </Text>
          <Show when={props.isStreaming}>
            <Badge variant="outline" class="text-[10px] px-1.5 py-0 animate-pulse">Streaming</Badge>
          </Show>
        </div>

        {/* Content */}
        {props.role === 'system' ? (
          <Text size="sm" class="text-muted-foreground italic">{props.content}</Text>
        ) : (
          <div
            class={cn(
              'text-sm leading-relaxed',
              props.role === 'user' ? 'text-foreground' : 'text-foreground/90',
            )}
            innerHTML={formatContent(props.content)}
          />
        )}

        {/* Tool calls */}
        <For each={props.toolCalls}>
          {(tool) => (
            <div class="mt-2">
              <button
                class={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                  'border border-border/50 hover:border-border',
                  tool.status === 'error' || tool.status === 'failed'
                    ? 'border-red-500/30 bg-red-500/10 text-red-400'
                    : tool.status === 'success'
                      ? 'border-green-500/30 bg-green-500/10 text-green-400'
                      : 'bg-surface2/50 text-muted-foreground hover:text-foreground',
                )}
                onClick={() => toggleTool(tool.id)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" strokeLinecap="round" strokeLinejoin="round">
                  {collapsedTools() && collapsedTools().has(tool.id) ? <polyline points="9 18 15 12 9 6" /> : <polyline points="6 9 12 15 18 9" />}
                </svg>
                {tool.name}
                <Show when={tool.status === 'running'}>
                  <span class="animate-pulse">...</span>
                </Show>
              </button>
              <Show when={collapsedTools() && collapsedTools().has(tool.id)}>
                <div class="mt-1 ml-2">
                  <pre class="bg-surface2/50 p-3 rounded-lg text-xs overflow-x-auto font-mono">
                    <code>
                      Input: {JSON.stringify(tool.parameters || {}, null, 2)}
                      {'\n\n'}
                      Output: {tool.result || 'No output'}
                    </code>
                  </pre>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state component
// ---------------------------------------------------------------------------

function EmptyChatState() {
  return (
    <div class="flex flex-col items-center justify-center h-full px-4 text-center">
      <div class="w-12 h-12 rounded-full bg-[hsl(var(--primary))/10 flex items-center justify-center mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" strokeLinecap="round" strokeLinejoin="round" class="text-[hsl(var(--primary))]">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <Text size="lg" weight="semibold" class="text-foreground mb-2">
        Start a conversation
      </Text>
      <Text size="sm" class="text-muted-foreground max-w-sm">
        Send a message to begin. Yuki can help you code, browse the web, manage files, and more.
      </Text>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatPanel — main component
// ---------------------------------------------------------------------------

export function ChatPanel(props: ChatPanelProps) {
  const { className } = props;
  const { send, messageRouter } = useWebSocket();
  const { isStreaming, setIsStreaming } = useSession();
  const { voiceMode, voiceListening, toggleMic } = useAudio();

  // Local message store (mirrors server-sent messages)
  const [messages, setMessages] = createSignal<Array<{
    id: string;
    role: string;
    content: string;
    toolCalls?: Array<{
      id: string;
      name: string;
      parameters?: Record<string, unknown>;
      result?: string;
      status?: string;
    }>;
    isStreaming?: boolean;
  }>>([]);

  const [inputValue, setInputValue] = createSignal('');
  const [isComposing, setIsComposing] = createSignal(false);

  // Track the streaming message ID
  let streamingMessageId = '';

  // Register message handlers
  createEffect(() => {
    const unsubChatMessage = messageRouter.on('chat:message', (data: unknown) => {
      const msgData = data as { message: string; messageId: string; sessionId?: string };
      setMessages((prev) => [
        ...prev,
        {
          id: msgData.messageId,
          role: 'user',
          content: msgData.message || '',
        },
      ]);
    });

    const unsubChatChunk = messageRouter.on('chat:chunk', (data: unknown) => {
      const chunkData = data as { chunk: string; messageId: string };
      streamingMessageId = chunkData.messageId;

      // Update or create the streaming message
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === chunkData.messageId);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], content: updated[idx].content + chunkData.chunk, isStreaming: true };
          return updated;
        }
        return [
          ...prev,
          {
            id: chunkData.messageId,
            role: 'assistant',
            content: chunkData.chunk,
            isStreaming: true,
          },
        ];
      });
    });

    const unsubChatResponse = messageRouter.on('chat:response', (data: unknown) => {
      const responseData = data as { message: string; sessionId?: string; error?: string };
      // Finalize streaming message
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === streamingMessageId || m.isStreaming);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], content: responseData.message, isStreaming: false };
          streamingMessageId = '';
          return updated;
        }
        // If no streaming message found, append as new
        return [
          ...prev,
          {
            id: `${Date.now()}-response`,
            role: responseData.error ? 'system' : 'assistant',
            content: responseData.message || '',
            isStreaming: false,
          },
        ];
      });
      setIsStreaming(false);
    });

    const unsubChatStopped = messageRouter.on('chat:stopped', () => {
      setMessages((prev) => prev.map((m) => ({ ...m, isStreaming: false })));
      streamingMessageId = '';
      setIsStreaming(false);
    });

    // Tool events
    const unsubToolCall = messageRouter.on('tool:call', (data: unknown) => {
      const toolData = data as { toolCall: { id: string; name: string; parameters?: Record<string, unknown>; status?: string } };
      if (toolCallData.toolCall) {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.role === 'assistant' && m.isStreaming);
          if (idx >= 0) {
            const updated = [...prev];
            const existing = updated[idx].toolCalls || [];
            // Update existing tool call or add new one
            const existingIdx = existing.findIndex((tc) => tc.id === toolData.toolCall.id);
            if (existingIdx >= 0) {
              existing[existingIdx] = { ...existing[existingIdx], ...toolData.toolCall };
            } else {
              existing.push({ ...toolData.toolCall, status: 'running' });
            }
            updated[idx] = { ...updated[idx], toolCalls: existing };
            return updated;
          }
          return prev;
        });
      }
    });

    const unsubToolResult = messageRouter.on('tool:result', (data: unknown) => {
      const toolResultData = data as { toolCall: { id: string; result?: string; status?: string } };
      if (toolResultData.toolCall) {
        setMessages((prev) => prev.map((m) => {
          if (!m.toolCalls?.length) return m;
          return {
            ...m,
            toolCalls: m.toolCalls.map((tc) =>
              tc.id === toolResultData.toolCall.id
                ? { ...tc, result: toolResultData.toolCall.result, status: toolResultData.toolCall.status || 'completed' }
                : tc
            ),
          };
        }));
      }
    });

    const unsubThinkingChunk = messageRouter.on('thinking:chunk', (data: unknown) => {
      const thinkingData = data as { chunk: string; messageId: string };
      streamingMessageId = thinkingData.messageId;
      // Thinking is part of the assistant's response, merged in on chat:response
    });

    const unsubMessageReverted = messageRouter.on('message:reverted', (data: unknown) => {
      const revertedData = data as { messageId: string; text: string };
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === revertedData.messageId);
        if (idx >= 0) {
          const updated = [...prev];
          updated.splice(idx, 1);
          return updated;
        }
        return prev;
      });
    });

    // Session switch: clear messages
    const unsubSessionSwitched = messageRouter.on('session:switched', (data: unknown) => {
      setMessages([]);
    });

    // Session cleared: clear messages
    const unsubSessionCleared = messageRouter.on('session:cleared', () => {
      setMessages([]);
    });

    // Auto-summary: update session title (handled by SessionContext)
    const unsubSessionRenamed = messageRouter.on('session:renamed', (data: unknown) => {
      // Title updates are handled by SessionContext
    });

    // Context update: update token usage (handled by TopBar)
    const unsubContextUpdate = messageRouter.on('context:update', () => {
      // Token update handled in TopBar
    });

    return () => {
      unsubChatMessage();
      unsubChatChunk();
      unsubChatResponse();
      unsubChatStopped();
      unsubToolCall();
      unsubToolResult();
      unsubThinkingChunk();
      unsubMessageReverted();
      unsubSessionSwitched();
      unsubSessionCleared();
      unsubSessionRenamed();
      unsubContextUpdate();
    };
  });

  // Send message handler
  function sendMessage() {
    const text = inputValue().trim();
    if (!text || isStreaming()) return;

    send('chat:message', { message: text });
    setInputValue('');
    setIsStreaming(true);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !isComposing() && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // Scroll to bottom on new messages (except when streaming user messages)
  const messagesRef = createMemo(() => messages());

  return (
    <main
      class={cn(
        'flex flex-col h-full',
        'bg-background',
        className,
      )}
    >
      {/* Messages area */}
      <div class="flex-1 overflow-y-auto">
        <Show when={messages().length === 0}>
          <EmptyChatState />
        </Show>
        <div class="py-4">
          <For each={messages()}>
            {(msg) => (
              <ChatMessage
                role={msg.role}
                content={msg.content}
                toolCalls={msg.toolCalls}
                isStreaming={msg.isStreaming}
              />
            )}
          </For>
        </div>
      </div>

      {/* Composer area */}
      <div class="border-t border-border/50 px-4 py-3 bg-surface/50 shrink-0">
        <div class="max-w-3xl mx-auto">
          <div class="flex items-end gap-2">
            <div
              class={cn(
                'flex-1 rounded-lg border border-border/50 bg-surface2/50 transition-colors',
                'focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20',
              )}
            >
              <Textarea
                class="border-0 bg-transparent resize-none focus-visible:ring-0 focus-visible:ring-offset-0"
                placeholder={voiceMode() ? 'Voice mode is on — speak or tap the mic' : 'Type a message...'}
                rows={1}
                value={inputValue()}
                onInput={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                disabled={isStreaming()}
              />
            </div>
            <div class="flex items-center gap-1">
              {/* Voice mic button */}
              <Show when={voiceMode()}>
                <IconButton
                  icon={voiceListening() ? 'mic' : 'mic-off'}
                  size="sm"
                  tooltip={voiceListening() ? 'Listening...' : 'Mic off'}
                  class={cn(
                    voiceListening() && 'text-[hsl(var(--primary))] animate-pulse',
                  )}
                  onClick={() => toggleMic()}
                />
              </Show>
              {/* Send button */}
              <button
                class={cn(
                  'p-2.5 rounded-lg transition-colors',
                  'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
                  'hover:bg-[hsl(var(--primary))/90',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                )}
                disabled={isStreaming() || !inputValue().trim()}
                onClick={sendMessage}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m22 2-7 20-4-9-9-4Z" />
                  <path d="M22 2 11 13" />
                </svg>
              </button>
            </div>
          </div>
          {/* Stop generating button */}
          <Show when={isStreaming()}>
            <div class="mt-2 flex justify-center">
              <button
                class="text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => send('chat:stop')}
              >
                Stop generating
              </button>
            </div>
          </Show>
        </div>
      </div>
    </main>
  );
}

