'use client';

import { Text } from '@/components/ui/box';
import { ToolStatusBadge, type ToolStatus } from './tool-status-badge';

export interface ToolEntry {
  id: string;
  timestamp: number;
  tool: string;
  status: ToolStatus;
  input?: Record<string, unknown>;
  output?: string;
  duration?: number;
}

interface ToolLogProps {
  entry?: ToolEntry | null;
}

/** Detailed view of a single tool execution (input / output / duration). */
export function ToolLog(props: ToolLogProps) {
  const entry = props.entry;
  if (!entry) return null;

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <ToolStatusBadge status={entry.status} />
        <Text weight="semibold" size="sm">
          {entry.tool}
        </Text>
      </div>

      {/* Timestamp */}
      <Text size="xs" className="text-muted-foreground">
        {new Date(entry.timestamp).toLocaleString()}
        {entry.duration ? (
          <>
            <span className="ml-2">·</span>
            <span>{`${(entry.duration / 1000).toFixed(1)}s`}</span>
          </>
        ) : null}
      </Text>

      {/* Input */}
      {entry.input && (
        <div className="space-y-1">
          <Text size="xs" weight="semibold" className="text-muted-foreground">
            INPUT
          </Text>
          <pre className="overflow-x-auto rounded border border-border bg-muted p-3 font-mono text-xs text-[#c9d1d9]">
            {JSON.stringify(entry.input, null, 2)}
          </pre>
        </div>
      )}

      {/* Output */}
      {entry.output && (
        <div className="space-y-1">
          <Text size="xs" weight="semibold" className="text-muted-foreground">
            OUTPUT
          </Text>
          <pre className="overflow-x-auto rounded border border-border bg-muted p-3 font-mono text-xs text-[#c9d1d9]">
            {entry.output}
          </pre>
        </div>
      )}
    </div>
  );
}
