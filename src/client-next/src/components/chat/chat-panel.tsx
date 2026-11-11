'use client';

import { useSession } from '@/context/session-context';

/**
 * Chat panel placeholder — the full chat UI (message list, composer, markdown,
 * tool logs) is ported in Phase 6. This stub proves the layout + state wiring.
 */
export function ChatPanel() {
  const { messages, sendMessage, isWaiting } = useSession();

  const handleSend = async () => {
    const text = window.prompt('Message:');
    if (text && text.trim()) sendMessage(text);
  };

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              {isWaiting ? 'Waiting for response…' : 'No messages yet — send one to start.'}
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === 'user'
                ? 'ml-auto max-w-[70%] rounded-lg bg-primary/15 px-3 py-2 text-sm'
                : 'mr-auto max-w-[70%] rounded-lg bg-muted px-3 py-2 text-sm'
            }
          >
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
              {m.role}
            </span>
            <span className="whitespace-pre-wrap break-words">{m.content}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-border/50 p-3">
        <button
          onClick={() => void handleSend()}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Send message (stub composer)
        </button>
      </div>
    </main>
  );
}
