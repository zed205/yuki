import { Show } from 'solid-js';
import { Box, Text } from '../ui';
import { cn } from '../../lib/utils';

export interface ToolEntry {
  id: string;
  timestamp: number;
  tool: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  input?: Record<string, unknown>;
  output?: string;
  duration?: number;
}

interface ToolLogProps {
  entry?: ToolEntry | null;
}

export function ToolLog(props: ToolLogProps) {
  if (!props.entry) return null;

  const entry = props.entry;

  return (
    <div class="p-4 space-y-4">
      {/* Header */}
      <div class="flex items-center gap-2">
        <ToolStatusBadge status={entry.status} />
        <Text weight="semibold" size="sm">{entry.tool}</Text>
      </div>

      {/* Timestamp */}
      <Text size="xs" class="text-muted-foreground">
        {new Date(entry.timestamp).toLocaleString()}
        <Show when={entry.duration}>
          <span class="ml-2">·</span>
          <span>{entry.duration ? `${(entry.duration / 1000).toFixed(1)}s` : ''}</span>
        </Show>
      </Text>

      {/* Input */}
      <Show when={entry.input}>
        <div class="space-y-1">
          <Text size="xs" weight="semibold" class="text-muted-foreground">INPUT</Text>
          <pre class="text-xs bg-surface2 border border-border rounded p-3 overflow-x-auto font-mono text-[#c9d1d9]">
            {JSON.stringify(entry.input, null, 2)}
          </pre>
        </div>
      </Show>

      {/* Output */}
      <Show when={entry.output}>
        <div class="space-y-1">
          <Text size="xs" weight="semibold" class="text-muted-foreground">OUTPUT</Text>
          <pre class="text-xs bg-surface2 border border-border rounded p-3 overflow-x-auto font-mono text-[#c9d1d9]">
            {entry.output}
          </pre>
        </div>
      </Show>
    </div>
  );
}
