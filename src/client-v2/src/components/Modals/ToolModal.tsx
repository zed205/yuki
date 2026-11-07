import { createSignal, For, Show } from 'solid-js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from '../ui/dialog';
import { ScrollArea, ScrollBar } from '../ui/scroll-area';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Text } from '../ui/Text';
import { ToolLog } from '../Tools/ToolLog';

export interface ToolModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export interface ToolEntry {
  id: string;
  timestamp: number;
  tool: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  input?: Record<string, unknown>;
  output?: string;
  duration?: number;
}

export function ToolModal(props: ToolModalProps) {
  const [entries, setEntries] = createSignal<ToolEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = createSignal<ToolEntry | null>(null);
  const [filter, setFilter] = createSignal<string>('all');

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent class="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Tool Execution Log</DialogTitle>
        </DialogHeader>
        <DialogBody class="p-0">
          {/* Toolbar */}
          <div class="flex items-center gap-2 px-4 py-2 border-b border-border">
            <div class="flex gap-1">
              <button
                class={`px-2 py-1 rounded text-xs ${filter() === 'all' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => setFilter('all')}
              >
                All
              </button>
              <button
                class={`px-2 py-1 rounded text-xs ${filter() === 'running' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => setFilter('running')}
              >
                Running
              </button>
              <button
                class={`px-2 py-1 rounded text-xs ${filter() === 'completed' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => setFilter('completed')}
              >
                Completed
              </button>
              <button
                class={`px-2 py-1 rounded text-xs ${filter() === 'failed' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => setFilter('failed')}
              >
                Failed
              </button>
            </div>
            <div class="ml-auto text-xs text-muted-foreground">
              {entries().length} entries
            </div>
          </div>

          {/* Split view: list + details */}
          <div class="flex h-[50vh]">
            {/* Tool log list */}
            <div class="w-1/2 border-r border-border">
              <ScrollArea class="h-full">
                <For each={entries().filter(e => filter() === 'all' || e.status === filter())}>
                  {(entry) => (
                    <button
                      class={`w-full text-left px-3 py-2 border-b border-border/50 hover:bg-surface2/50 transition-colors ${selectedEntry()?.id === entry.id ? 'bg-primary/10' : ''}`}
                      onClick={() => setSelectedEntry(entry)}
                    >
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                          <ToolStatusBadge status={entry.status} />
                          <span class="text-xs font-medium truncate">{entry.tool}</span>
                        </div>
                        <span class="text-[10px] text-muted-foreground">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </button>
                  )}
                </For>
                <Show when={entries().length === 0}>
                  <div class="flex items-center justify-center h-full text-muted-foreground text-xs">
                    No tool executions yet
                  </div>
                </Show>
              </ScrollArea>
              <ScrollBar orientation="vertical" />
            </div>

            {/* Selected entry details */}
            <div class="flex-1 overflow-hidden">
              <Show
                when={selectedEntry()}
                fallback={
                  <div class="flex items-center justify-center h-full text-muted-foreground text-xs">
                    Select a tool execution to view details
                  </div>
                }
              >
                <ScrollArea class="h-full">
                  <ToolLog entry={selectedEntry()} />
                </ScrollArea>
                <ScrollBar orientation="vertical" />
              </Show>
            </div>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
