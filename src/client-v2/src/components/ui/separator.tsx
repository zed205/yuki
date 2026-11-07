import { splitProps, type Component } from 'solid-js';
import { cn } from '@/lib/utils';

export interface SeparatorProps {
  orientation?: 'horizontal' | 'vertical';
  decorative?: boolean;
  class?: string;
}

export const Separator: Component<SeparatorProps> = (props) => {
  const [local, rest] = splitProps(props, ['orientation', 'decorative', 'class']);

  const isVertical = local.orientation === 'vertical';

  return (
    <div
      class={cn(
        'shrink-0 bg-border',
        isVertical
          ? 'w-px h-full'
          : 'h-px w-full',
        local.class
      )}
      role={local.decorative === false ? 'separator' : undefined}
      aria-orientation={local.decorative === false ? (isVertical ? 'vertical' : 'horizontal') : undefined}
      {...rest}
    />
  );
};
