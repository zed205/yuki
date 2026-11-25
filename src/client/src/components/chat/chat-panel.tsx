'use client';

import { cn } from '@/lib/utils';
import { useSession, isSummaryMessage } from '@/context/session-context';
import { useAudio } from '@/context/audio-context';
import { useWebSocket } from '@/context/websocket-context';
import { MessageBubble, ThinkingPill, ToolCallPill } from './message-bubble';
import { TurnGroup } from './turn-group';
import { Composer } from './composer';
import { useScrollToBottom } from './scroll-manager';
import { Text } from '@/components/ui/box';
import { PlanBar } from './plan-bar';
import type { Message } from '@/lib/types';

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
  const { containerRef, scrollToBottom } = useScrollToBottom({
    content: messages,
    resetKey: currentSessionId,
  });

  const handleSend = (content: string) => {
    if (isStreaming) {
      // Steer the in-flight turn (text only)
      send('chat:message', { message: content });
      scrollToBottom(true);
      return;
    }
    sendMessage(content);
    // Force the view to the bottom (legacy: scrollToBottom(true) on send).
    scrollToBottom(true);
  };

  return (
    <main className={cn('flex h-full flex-col bg-background', className)}>
      {/* Messages area (legacy parity — max-w-5xl centered column, space-y-4) */}
      <div ref={containerRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 && !busy ? (
          <EmptyChatState />
        ) : (
          <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-4">
            {(() => {
              // ── Group consecutive assistant messages without text content ─────
              // Messages streamed during multi-tool turns may have only
              // reasoningContent / toolCalls. These get merged into a single
              // TurnGroup accordion; the final message with text renders below it.
              const hasText = (m: Message) =>
                m.role === 'assistant' &&
                typeof m.content === 'string' &&
                m.content.trim().length > 0;

              const groups: Array<
                | { type: 'forkNote'; msg: Message }
                | { type: 'grouped'; processMessages: Message[]; finalMessage: Message }
                | { type: 'single'; msg: Message }
              > = [];

              let i = 0;
              while (i < messages.length) {
                const msg = messages[i];

                // Fork note — always rendered individually
                if (msg.forkNote && forkedParentId) {
                  groups.push({ type: 'forkNote', msg });
                  i++;
                  continue;
                }

                // Sub-agent messages — always rendered individually
                if (msg.role === 'assistant' && msg.agentId) {
                  groups.push({ type: 'single', msg });
                  i++;
                  continue;
                }

                // Non-assistant → render individually
                if (msg.role !== 'assistant') {
                  groups.push({ type: 'single', msg });
                  i++;
                  continue;
                }

                // ── Normal assistant turn: collect consecutive messages ─────
                // Gather all consecutive assistant messages until we hit one
                // with text content (the "final" message) or a non-assistant.
                const processMessages: Message[] = [];
                let hasFinal = false;
                let j = i;

                while (j < messages.length && messages[j].role === 'assistant') {
                  const m = messages[j];
                  // Skip sub-agent messages in the middle (treat as boundary)
                  if (m.agentId) break;

                  if (hasText(m)) {
                    // This is the final message with text content
                    // Any accumulated process messages become the accordion
                    if (processMessages.length > 0) {
                      groups.push({ type: 'grouped', processMessages, finalMessage: m });
                    } else {
                      groups.push({ type: 'single', msg: m });
                    }
                    hasFinal = true;
                    j++;
                    break;
                  } else {
                    // Accumulate as process (thinking / tool-calls only)
                    processMessages.push(m);
                    j++;
                  }
                }

                if (!hasFinal) {
                  // All remaining consecutive messages lack text content.
                  // If we have process messages, group them with undefined final.
                  // Otherwise render each individually.
                  if (processMessages.length > 1) {
                    groups.push({
                      type: 'grouped',
                      processMessages,
                      finalMessage: processMessages[processMessages.length - 1],
                    });
                  } else if (processMessages.length === 1) {
                    groups.push({ type: 'single', msg: processMessages[0] });
                  }
                  i = j;
                  continue;
                }

                i = j;
              }

              // ── Render the groups ───────────────────────────────────────
              return groups.map((group, idx) => {
                if (group.type === 'forkNote') {
                  const msg = group.msg;
                  return (
                    <div key={msg.id} className="my-2 flex justify-center">
                      <button
                        type="button"
                        className="inline-flex cursor-pointer select-none items-center gap-2 rounded-lg border border-[#30363d] bg-[#161b22]/30 px-3 py-1.5 text-xs text-[#58a6ff]/80 transition-colors hover:text-[#58a6ff]"
                        title="Click to view original session"
                        onClick={() => forkedParentId && switchSession(forkedParentId)}
                      >
                        ⟿ Forked from session
                      </button>
                    </div>
                  );
                }

                if (group.type === 'grouped') {
                  const { processMessages, finalMessage } = group;
                  const key = finalMessage.id || `group-${idx}`;
                  return (
                    <TurnGroup
                      key={key}
                      processMessages={processMessages}
                      finalMessage={finalMessage}
                    />
                  );
                }

                // Single message
                const msg = group.msg;
                if (msg.role === 'assistant' && msg.agentId) {
                  const sub = subagents.find((a) => a.agentId === msg.agentId);
                  return (
                    <div key={msg.id} className="mb-2 flex justify-start">
                      <div className="min-w-0 max-w-[90%]">
                        <MessageBubble
                          role={msg.role}
                          content={msg.content}
                          isStreaming={msg.isStreaming}
                          compacted={msg.compacted}
                          timestamp={msg.timestamp}
                          agentId={msg.agentId}
                          subAgent={sub}
                          observerFeedback={msg.observerFeedback}
                          stoppedNotice={msg.stoppedNotice}
                          forks={msg.id ? messageForks[msg.id] : undefined}
                          onForkNavigate={(sessionId) => switchSession(sessionId)}
                          onFork={() => {
                            if (currentSessionId && msg.serverIndex != null) {
                              forkSession(currentSessionId, msg.serverIndex);
                            }
                          }}
                        />
                      </div>
                    </div>
                  );
                }

                return (
                  <MessageBubble
                    key={msg.id}
                    role={msg.role}
                    content={msg.content}
                    isStreaming={msg.isStreaming}
                    compacted={msg.compacted}
                    timestamp={msg.timestamp}
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
                  />
                );
              });
            })()}
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

      {/* Plan bar (legacy parity — between messages and composer, at the bottom) */}
      <PlanBar plan={plan} />

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
