import {
  type Component,
  type ComponentProps,
  type ParentProps,
  splitProps,
} from 'solid-js';
import { cn } from '../../lib/utils';

// =============================================================================
// Toast primitives — shadcn/ui style toast components
// =============================================================================

export type ToastType = 'default' | 'success' | 'error' | 'warning' | 'info';

export interface ToastProps {
  type?: ToastType;
}

const toastStyles: Record<ToastType, string> = {
  default: '',
  success: 'border-green-600/50 text-green-700 dark:text-green-300',
  error: 'border-red-600/50 text-red-700 dark:text-red-300',
  warning: 'border-amber-600/50 text-amber-700 dark:text-amber-300',
  info: 'border-blue-600/50 text-blue-700 dark:text-blue-300',
};

// =============================================================================
// Toast - The toast notification container
// =============================================================================

const Toast: Component<ToastProps & ComponentProps<'div'>> = (props) => {
  const [rest, others] = splitProps(
    props,
    ['class', 'type', 'children'],
  );

  return (
    <div
      class={cn(
        'group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-4 shadow-lg transition-all',
        'bg-background border-border',
        toastStyles[rest.type || 'default'],
        rest.class,
      )}
      role="alert"
      {...others}
    >
      {rest.children}
    </div>
  );
};

// =============================================================================
// ToastViewport - Positioned toast container
// =============================================================================

const ToastViewport: Component<ComponentProps<'div'>> = (props) => {
  const [rest] = splitProps(props, ['class']);

  return (
    <div
      class={cn(
        'fixed top-0 right-0 z-[100] flex max-h-screen w-full flex-col p-4 sm:w-auto sm:max-w-[420px]',
        rest.class,
      )}
      {...rest}
    />
  );
};

// =============================================================================
// ToastProvider - Provider for toast lifecycle
// =============================================================================

const ToastProvider: Component<ComponentProps<'div'>> = (props) => {
  const [rest] = splitProps(props, ['class', 'children']);

  return (
    <div {...rest}>
      {rest.children}
    </div>
  );
};

// =============================================================================
// ToastTitle - Title element
// =============================================================================

const ToastTitle: Component<ComponentProps<'div'>> = (props) => {
  const [rest] = splitProps(props, ['class', 'children']);

  return (
    <div
      class={cn('text-sm font-semibold [&+div]:text-xs', rest.class)}
      {...rest}
    >
      {rest.children}
    </div>
  );
};

// =============================================================================
// ToastDescription - Description element
// =============================================================================

const ToastDescription: Component<ComponentProps<'div'>> = (props) => {
  const [rest] = splitProps(props, ['class', 'children']);

  return (
    <div
      class={cn('text-sm opacity-90', rest.class)}
      {...rest}
    >
      {rest.children}
    </div>
  );
};

// =============================================================================
// ToastClose - Close button for toast
// =============================================================================

const ToastClose: Component = () => {
  return (
    <button
      type="button"
      class="absolute right-2 top-2 rounded-md p-1 opacity-0 transition-opacity hover:opacity-100 focus:outline-none group-hover:opacity-100"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="text-foreground"
      >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
};

export {
  Toast,
  ToastViewport,
  ToastProvider,
  ToastTitle,
  ToastDescription,
  ToastClose,
};
