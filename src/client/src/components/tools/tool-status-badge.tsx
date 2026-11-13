'use client';

import { cn } from '@/lib/utils';

export type ToolStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'queued'
  | 'pending';

interface ToolStatusBadgeProps {
  status: ToolStatus;
  size?: 'sm' | 'md';
}

const STATUS_CONFIG: Record<
  ToolStatus,
  { color: string; bg: string; border: string; label: string; dot: string }
> = {
  running: {
    color: 'text-primary',
    bg: 'bg-primary/10',
    border: 'border-primary/20',
    label: 'Running',
    dot: 'bg-primary animate-pulse',
  },
  completed: {
    color: 'text-green-500',
    bg: 'bg-green-500/10',
    border: 'border-green-500/20',
    label: 'Completed',
    dot: 'bg-green-500',
  },
  failed: {
    color: 'text-red-500',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    label: 'Failed',
    dot: 'bg-red-500',
  },
  cancelled: {
    color: 'text-muted-foreground',
    bg: 'bg-muted',
    border: 'border-border',
    label: 'Cancelled',
    dot: 'bg-muted-foreground',
  },
  queued: {
    color: 'text-muted-foreground',
    bg: 'bg-muted',
    border: 'border-border',
    label: 'Queued',
    dot: 'bg-muted-foreground',
  },
  pending: {
    color: 'text-muted-foreground',
    bg: 'bg-muted',
    border: 'border-border',
    label: 'Pending',
    dot: 'bg-muted-foreground',
  },
};

export function ToolStatusBadge(props: ToolStatusBadgeProps) {
  const config = STATUS_CONFIG[props.status] ?? STATUS_CONFIG.pending;
  const size = props.size || 'sm';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium',
        config.bg,
        config.border,
        config.color,
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', config.dot)} />
      {config.label}
    </span>
  );
}
