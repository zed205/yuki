'use client';

import { cn } from '@/lib/utils';
import { useSession, isSummaryMessage } from '@/context/session-context';
import { useAudio } from '@/context/audio-context';
import { useWebSocket } from '@/context/websocket-context';
import { MessageBubble } from './message-bubble';
import { Composer, type FileAttachment } from './composer';
import { useScrollToBottom } from './scroll-manager';
import { Text } from '@/components/ui/box';
import { PlanBar } from './plan-bar';
import type { Message } from '@/lib/types';

/**
 * A "working" assistant turn (thinking and/or tool calls, no final text yet)
 * collapses into a single dashed TT-group pill (legacy collapseThinkingTools).
 */
function isTTMessage(m: Message): boolean {
  if (m.role !== 'assistant') return false;
  if (m.stoppedNotice || m.observerFeedback || m.agentId) return false;
  if (isSummaryMessage(m)) return false;
  const hasOps = (m.toolCalls && m.toolCalls.length > 0) || !!m.reasoningContent;
  const hasText = typeof m.content === 'string' && m.content.trim().length > 0;
  return hasOps && !hasText;
}

interface ChatPanelProps {
  className?: string;
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyChatState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-primary"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <Text size="lg" weight="semibold" className="mb-2 text-foreground">
        Start a conversation
      </Text>
      <Text size="sm" className="max-w-sm text-muted-foreground">
        Send a message to begin. Yuki can help you code, browse the web, manage
        files, and more.
      </Text>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatPanel — main component
// ---------------------------------------------------------------------------

export function ChatPanel(props: ChatPanelProps) {
  const { className } = props;
  const { send } = useWebSocket();
  const {
    messages,
    sendMessage,
    stopResponse,
    isStreaming,
    isWaiting,
    plan,
    subagents,
    currentSessionId,
    forkedParentId,
    messageForks,
    switchSession,
    compactContext,
    forkSession,
    revertMessage,
  } = useSession();
  const { voiceMode, speak } = useAudio();
  const busy = isWaiting || isStreaming;
  const { containerRef } = useScrollToBottom();

  const handleSend = (content: string, attachments: FileAttachment[]) => {
    const images = attachments
      .filter((a) => a.type === 'image' && a.dataUrl)
      .map((a) => a.dataUrl!);
    const files = attachments
      .filter((a) => a.type === 'file' && a.dataUrl)
      .map((a) => ({
        name: a.name,
        type: a.file?.type || 'application/octet-stream',
        dataUrl: a.dataUrl!,
      }));

    if (isStreaming) {
      // Steer the in-flight turn (text only)
      send('chat:message', { message: content });
      return;
    }

    const ok =
      images.length > 0 || files.length > 0
        ? send('chat:message', {
            message: content,
            images,
            files,
          })
        : sendMessage(content);
    if (ok) {
      // Optimistic: the server echoes the message back over WS, but flag
      // waiting immediately for snappier UI.
    }
  };

  return (
    <main className={cn('flex h-full flex-col bg-background', className)}>
      {/* Plan bar */}
      <PlanBar plan={plan} />

      {/* Messages area */}
      <div ref={containerRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 && !busy ? (
          <EmptyChatState />
        ) : (
          <div className="py-4">
            {messages.map((msg) => {
              // Forked-from marker: render the centered "⟿ Forked from session" pill
              // (legacy parity) when this session was forked from another.
              if (msg.forkNote && forkedParentId) {
                return (
                  <div key={msg.id} className="my-2 flex justify-center">
                    <button
                      type="button"
                      className="inline-flex cursor-pointer select-none items-center gap-2 rounded-lg border border-[#30363d] bg-[#161b22]/30 px-3 py-1.5 text-xs text-[#58a6ff]/80 transition-colors hover:text-[#58a6ff]"
                      title="Click to view original session"
                      onClick={() => switchSession(forkedParentId)}
                    >
                      ⟿ Forked from session
                    </button>
                  </div>
                );
              }
              return (
                <MessageBubble
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  toolCalls={msg.toolCalls}
                  reasoningContent={msg.reasoningContent}
                  isStreaming={msg.isStreaming}
                  compacted={msg.compacted}
                  timestamp={msg.timestamp}
                  agentId={msg.agentId}
                  subAgent={msg.agentId ? subagents.find((a) => a.agentId === msg.agentId) : undefined}
                  observerFeedback={msg.observerFeedback}
                  stoppedNotice={msg.stoppedNotice}
                  isTTGroup={isTTMessage(msg)}
                  forks={msg.id ? messageForks[msg.id] : undefined}
                  onForkNavigate={(sessionId) => switchSession(sessionId)}
                  onRevert={() => {
                    if (msg.role === 'user' && msg.id) {
                      revertMessage(msg.id);
                    }
                  }}
                  onCompact={() => {
                    compactContext();
                  }}
                  onFork={() => {
                    if (currentSessionId && msg.serverIndex != null && msg.role === 'assistant') {
                      forkSession(currentSessionId, msg.serverIndex);
                    }
                  }}
                  onRead={() => {
                    if (typeof msg.content === 'string' && msg.content.trim()) {
                      void speak(msg.content);
                    }
                  }}
                />
              );
            })}
            {/* Typing indicator (legacy "Yuki is processing...") while a turn is in flight */}
            {busy && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md border border-[#30363d] bg-[#161b22] px-4 py-2 text-xs text-[#8b949e]">
                  Yuki is processing
                  <span className="animate-pulse">...</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Composer area */}
      <Composer
        onSubmit={handleSend}
        onStop={stopResponse}
        placeholder={
          voiceMode ? 'Voice mode is on — speak or tap the mic' : 'Type a message...'
        }
      />
    </main>
  );
}
