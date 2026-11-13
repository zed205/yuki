'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ScrollArea,
  ScrollBar,
} from '@/components/ui/scroll-area';
import { ToolLog, type ToolEntry } from '@/components/tools/tool-log';
import { ToolStatusBadge } from '@/components/tools/tool-status-badge';

export interface ToolModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** External entries to merge with internally tracked ones. */
  entries?: ToolEntry[];
}

const FILTERS = ['all', 'running', 'completed', 'failed'] as const;

export function ToolModal(props: ToolModalProps) {
  const [internalEntries, setInternalEntries] = useState<ToolEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<ToolEntry | null>(null);
  const [filter, setFilter] = useState<string>('all');

  const entries = props.entries ?? internalEntries;
  const setEntries = props.entries ? undefined : setInternalEntries;

  const visible = entries.filter(
    (e) => filter === 'all' || e.status === filter,
  );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-4xl">
        <DialogHeader>
          <DialogTitle>Tool Execution Log</DialogTitle>
        </DialogHeader>

        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-border px-1 py-1">
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                className={cn(
                  'rounded px-2 py-1 text-xs capitalize',
                  filter === f
                    ? 'bg-primary/20 text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="ml-auto text-xs text-muted-foreground">
            {entries.length} entries
          </div>
        </div>

        {/* Split view: list + details */}
        <div className="flex h-[50vh]">
          <div className="w-1/2 border-r border-border">
            <ScrollArea className="h-full">
              <div>
                {visible.map((entry) => (
                  <button
                    key={entry.id}
                    className={cn(
                      'w-full border-b border-border/50 px-3 py-2 text-left transition-colors hover:bg-muted/50',
                      selectedEntry?.id === entry.id && 'bg-primary/10',
                    )}
                    onClick={() => setSelectedEntry(entry)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ToolStatusBadge status={entry.status} />
                        <span className="truncate text-xs font-medium">
                          {entry.tool}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </button>
                ))}
                {entries.length === 0 && (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    No tool executions yet
                  </div>
                )}
              </div>
              <ScrollBar orientation="vertical" />
            </ScrollArea>
          </div>

          <div className="flex-1 overflow-hidden">
            {selectedEntry ? (
              <ScrollArea className="h-full">
                <ToolLog entry={selectedEntry} />
                <ScrollBar orientation="vertical" />
              </ScrollArea>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                Select a tool execution to view details
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
