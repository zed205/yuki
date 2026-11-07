import { Show } from 'solid-js';
import { Box, Text } from '../ui';
import { cn } from '../../lib/utils';

interface ThinkingIndicatorProps {
  visible?: boolean;
  text?: string;
}

export function ThinkingIndicator(props: ThinkingIndicatorProps) {
  const text = props.text || 'Thinking...';
  const visible = props.visible ?? true;

  if (!visible) return null;

  return (
    <div class="flex items-center gap-2 py-2 px-4">
      {/* Pulsing dot */}
      <div class="relative">
        <div class="w-2 h-2 rounded-full bg-[hsl(var(--primary))] animate-ping" />
        <div class="absolute inset-0 w-2 h-2 rounded-full bg-[hsl(var(--primary))]" />
      </div>
      <Text size="xs" class="text-muted-foreground font-medium">{text}</Text>
    </div>
  );
}
