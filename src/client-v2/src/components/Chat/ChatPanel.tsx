import { createSignal, type JSX } from 'solid-js';
import { Box } from '../ui';
import { cn } from '../../lib/utils';

interface ChatPanelProps {
  className?: string;
  children?: JSX.Element;
}

export function ChatPanel(props: ChatPanelProps) {
  const { className, children } = props;

  return (
    <main
      class={cn(
        'flex flex-col h-full',
        'bg-background',
        className
      )}
    >
      {/* Messages area */}
      <div class="flex-1 overflow-y-auto">
        {children}
      </div>

      {/* Composer area - placeholder for Composer component */}
      <div class="border-t border-border/50 px-4 py-3 bg-surface">
        <div class="max-w-3xl mx-auto">
          <div class="flex items-end gap-2">
            <div class="flex-1 rounded-lg border border-border/50 bg-surface2/50 p-3 min-h-[48px]">
              <div class="text-muted-foreground/40 text-xs">
                Type a message...
              </div>
            </div>
            <button class="p-2 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary))/90 transition-colors">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m22 2-7 20-4-9-9-4Z" />
                <path d="M22 2 11 13" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
