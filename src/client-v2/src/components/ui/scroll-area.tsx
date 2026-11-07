import { type Component, type ComponentProps, splitProps } from 'solid-js';
import { cn } from '../../lib/utils';

// =============================================================================
// ScrollArea — shadcn/ui style scroll area (CSS-only, no external deps)
// =============================================================================

export interface ScrollAreaProps extends ComponentProps<'div'> {
  orientation?: 'vertical' | 'horizontal' | 'both';
}

const ScrollArea: Component<ScrollAreaProps> = (props) => {
  const [rest, others] = splitProps(
    props,
    ['class', 'orientation', 'children'],
  );

  const orientationClass = rest.orientation === 'horizontal'
    ? 'overflow-x-auto overflow-y-hidden'
    : rest.orientation === 'both'
      ? 'overflow-auto'
      : 'overflow-y-auto';

  return (
    <div
      class={cn(
        'relative overflow-hidden',
        rest.class,
      )}
      {...others}
    >
      <div class={cn('h-full w-full', orientationClass)}>
        {rest.children}
      </div>
    </div>
  );
};

// =============================================================================
// ScrollViewport — wraps scrollable content
// =============================================================================

const ScrollViewport: Component<ComponentProps<'div'>> = (props) => {
  const [rest] = splitProps(props, ['class', 'children']);

  return (
    <div class={cn('size-full overflow-auto p-4', rest.class)}>
      {rest.children}
    </div>
  );
};

// =============================================================================
// ScrollBar — optional scrollbar gutter
// =============================================================================

const ScrollBar: Component<{
  orientation?: 'vertical' | 'horizontal';
  class?: string;
}> = (props) => {
  const [rest] = splitProps(props, ['class', 'orientation']);

  return (
    <div
      class={cn(
        'flex touch-none select-none transition-colors',
        rest.orientation === 'vertical'
          ? 'h-full w-2.5 border-l border-l-transparent p-px'
          : 'h-2.5 border-t border-t-transparent p-px',
        rest.class,
      )}
    >
      <div class="relative flex-1 bg-muted/20 rounded-full" />
    </div>
  );
};

export { ScrollArea, ScrollViewport, ScrollBar };
