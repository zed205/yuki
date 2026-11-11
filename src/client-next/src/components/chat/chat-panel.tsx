'use client';

import { cn } from '@/lib/utils';
import { useSession } from '@/context/session-context';
import { useAudio } from '@/context/audio-context';
import { useWebSocket } from '@/context/websocket-context';
import { MessageBubble } from './message-bubble';
import { Composer, type FileAttachment } from './composer';
import { useScrollToBottom } from './scroll-manager';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/box';

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
  const { messages, sendMessage, stopResponse, isStreaming } = useSession();
  const { voiceMode, voiceListening, toggleMic } = useAudio();
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
      {/* Messages area */}
      <div ref={containerRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <EmptyChatState />
        ) : (
          <div className="py-4">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                role={msg.role}
                content={msg.content}
                toolCalls={msg.toolCalls}
                reasoningContent={msg.reasoningContent}
                isStreaming={msg.isStreaming}
                compacted={msg.compacted}
                timestamp={msg.timestamp}
              />
            ))}
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
      {/* Voice mic shortcut row (kept minimal; full voice UI lands in Phase 7) */}
      {voiceMode && (
        <div className="flex items-center justify-center gap-2 border-t border-border/50 bg-background/50 px-4 py-1.5">
          <IconButton
            icon={voiceListening ? 'mic' : 'mic-off'}
            size="sm"
            tooltip={voiceListening ? 'Listening...' : 'Mic off'}
            className={voiceListening ? 'animate-pulse text-primary' : undefined}
            onClick={() => toggleMic()}
          />
          <Text size="xs" className="text-muted-foreground">
            {voiceListening ? 'Listening…' : 'Voice mode active'}
          </Text>
        </div>
      )}
    </main>
  );
}
