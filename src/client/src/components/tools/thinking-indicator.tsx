'use client';

import { Text } from '@/components/ui/box';

interface ThinkingIndicatorProps {
  visible?: boolean;
  text?: string;
}

export function ThinkingIndicator(props: ThinkingIndicatorProps) {
  const text = props.text || 'Thinking...';
  const visible = props.visible ?? true;

  if (!visible) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2">
      {/* Pulsing dot */}
      <div className="relative">
        <div className="h-2 w-2 animate-ping rounded-full bg-primary" />
        <div className="absolute inset-0 h-2 w-2 rounded-full bg-primary" />
      </div>
      <Text size="xs" className="font-medium text-muted-foreground">
        {text}
      </Text>
    </div>
  );
}
