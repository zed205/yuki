import { Show } from 'solid-js';
import { Box, Badge, Text } from '../ui';
import { cn } from '../../lib/utils';

export type ToolStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'queued';

interface ToolStatusBadgeProps {
  status: ToolStatus;
  size?: 'sm' | 'md';
}

const STATUS_CONFIG = {
  running: {
    color: 'text-[hsl(var(--primary))]',
    bg: 'bg-[hsl(var(--primary))/10',
    border: 'border-[hsl(var(--primary))/20',
    label: 'Running',
    dot: 'bg-[hsl(var(--primary))] animate-pulse',
  },
  completed: {
    color: 'text-[hsl(var(--success))]',
    bg: 'bg-[hsl(var(--success))/10',
    border: 'border-[hsl(var(--success))/20',
    label: 'Completed',
    dot: 'bg-[hsl(var(--success))]',
  },
  failed: {
    color: 'text-[hsl(var(--danger))]',
    bg: 'bg-[hsl(var(--danger))/10',
    border: 'border-[hsl(var(--danger))/20',
    label: 'Failed',
    dot: 'bg-[hsl(var(--danger))]',
  },
  cancelled: {
    color: 'text-[hsl(var(--muted))]',
    bg: 'bg-[hsl(var(--muted))/10',
    border: 'border-[hsl(var(--muted))/20',
    label: 'Cancelled',
    dot: 'bg-[hsl(var(--muted))]',
  },
  queued: {
    color: 'text-[hsl(var(--muted))]',
    bg: 'bg-[hsl(var(--muted))/10',
    border: 'border-[hsl(var(--muted))/20',
    label: 'Queued',
    dot: 'bg-[hsl(var(--muted))]',
  },
};

export function ToolStatusBadge(props: ToolStatusProps) {
  const config = STATUS_CONFIG[props.status];
  const size = props.size || 'sm';

  return (
    <span class={cn(
      'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border',
      config.bg,
      config.border,
      config.color,
      size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'px-2 py-0.5',
    )}>
      <span class={cn(
        'w-1.5 h-1.5 rounded-full',
        config.dot,
      )} />
      {config.label}
    </span>
  );
}
