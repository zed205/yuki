import {
  splitProps,
  type Component,
  type JSX,
  createSignal,
  createEffect,
  onCleanup,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { cn } from '@/lib/utils';

export interface TooltipProps {
  content: string;
  children: JSX.Element;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  delay?: number;
}

export const Tooltip: Component<TooltipProps> = (props) => {
  const [open, setOpen] = createSignal(false);
  const [position, setPosition] = createSignal<null | { x: number; y: number }>(null);
  const timeoutRef = { current: 0 as unknown as ReturnType<typeof setTimeout> };

  const side = props.side ?? 'top';
  const align = props.align ?? 'center';
  const delay = props.delay ?? 700;

  const positionStyle: Record<string, string> = {
    'top-center': 'left-1/2 -translate-x-1/2 -translate-y-2',
    'top-start': 'left-0 -translate-y-2',
    'top-end': 'right-0 -translate-y-2',
    'right-center': 'left-full top-1/2 -translate-y-1/2 ml-2',
    'right-start': 'left-full top-0 ml-2',
    'right-end': 'left-full bottom-0 ml-2',
    'bottom-center': 'left-1/2 -translate-x-1/2 translate-y-2',
    'bottom-start': 'left-0 translate-y-2',
    'bottom-end': 'right-0 translate-y-2',
    'left-center': 'right-full top-1/2 -translate-y-1/2 mr-2',
    'left-start': 'right-full top-0 mr-2',
    'left-end': 'right-full bottom-0 mr-2',
  };

  const arrowStyle: Record<string, string> = {
    'top-center': 'left-1/2 -translate-x-1/2',
    'bottom-center': 'left-1/2 -translate-x-1/2',
    'right-center': 'top-1/2 -translate-y-1/2',
    'left-center': 'top-1/2 -translate-y-1/2',
  };

  function handleMouseEnter() {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setOpen(true), delay) as unknown as ReturnType<typeof setTimeout>;
  }

  function handleMouseLeave() {
    clearTimeout(timeoutRef.current);
    setOpen(false);
  }

  function handleFocus() {
    timeoutRef.current = setTimeout(() => setOpen(true), delay) as unknown as ReturnType<typeof setTimeout>;
  }

  function handleBlur() {
    clearTimeout(timeoutRef.current);
    setOpen(false);
  }

  onCleanup(() => clearTimeout(timeoutRef.current));

  return (
    <div
      class={cn('relative inline-flex', props.side)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <div
        class="outline-none"
        tabIndex={0}
        role="button"
        aria-describedby={open() ? 'yuki-tooltip-content' : undefined}
      >
        {props.children}
      </div>
      <Show when={open()}>
        <Portal>
          <div
            id="yuki-tooltip-content"
            role="tooltip"
            class={cn(
              'z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95',
              positionStyle[`${side}-${align}`],
              'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95'
            )}
            data-state={open() ? 'open' : 'closed'}
          >
            {props.content}
            <div
              class={cn(
                'absolute z-[-1] w-2 h-2 rotate-45 bg-popover border border-border',
                arrowStyle[`${side}-${align}`]
              )}
            />
          </div>
        </Portal>
      </Show>
    </div>
  );
};

// ─── Tooltip Trigger (shorthand wrapper) ─────────────────────────────────────

export interface TooltipTriggerProps {
  class?: string;
  children: JSX.Element;
}

export const TooltipTrigger: Component<TooltipTriggerProps> = (props) => {
  const [local, rest] = splitProps(props, ['class']);

  return (
    <span class={cn('inline-flex', local.class)} {...rest}>
      <slot />
    </span>
  );
};

// ─── Tooltip Content (shorthand wrapper) ─────────────────────────────────────

export interface TooltipContentProps {
  content: string;
  class?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

export const TooltipContent: Component<TooltipContentProps> = (props) => (
  <span>{props.content}</span>
);
