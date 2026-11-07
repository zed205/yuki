import {
  splitProps,
  type Component,
  type JSX,
  createSignal,
  createEffect,
  onCleanup,
  Show,
} from 'solid-js';
import { cn } from '@/lib/utils';

// ─── Select Root ─────────────────────────────────────────────────────────────

export interface SelectRootProps {
  value: string;
  onValueChange: (value: string) => void;
  children?: JSX.Element;
}

export const SelectRoot: Component<SelectRootProps> = (props) => {
  return (
    <div class="relative">
      {props.children}
    </div>
  );
};

// ─── Select Trigger ──────────────────────────────────────────────────────────

export interface SelectTriggerProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  class?: string;
  value?: string;
  placeholder?: string;
}

export const SelectTrigger: Component<SelectTriggerProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'value', 'placeholder']);

  return (
    <button
      type="button"
      class={cn(
        'flex h-10 w-full items-center justify-between rounded-md border border-input ',
        'bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground ',
        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ',
        'disabled:cursor-not-allowed disabled:opacity-50 ',
        'appearance-none',
        local.class
      )}
      {...rest}
    >
      <span class={local.value ? '' : 'text-muted-foreground'}>
        {local.value || local.placeholder}
      </span>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="lucide lucide-chevron-down ml-2 h-4 w-4 opacity-50"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
      <slot />
    </button>
  );
};

// ─── Select Content ──────────────────────────────────────────────────────────

export interface SelectContentProps extends JSX.HTMLAttributes<HTMLDivElement> {
  position?: 'popper' | 'item-aligned';
  class?: string;
}

export const SelectContent: Component<SelectContentProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'position']);

  const positionStyle =
    local.position === 'popper'
      ? 'absolute right-0 top-full w-full -translate-y-1'
      : 'absolute top-full left-0 w-full -translate-y-1';

  return (
    <div
      class={cn(
        positionStyle,
        'z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        local.class
      )}
      {...rest}
    >
      <div class="p-1">
        <slot />
      </div>
    </div>
  );
};

// ─── Select Item ─────────────────────────────────────────────────────────────

export interface SelectItemProps {
  value: string;
  onSelect: (value: string) => void;
  children?: JSX.Element;
  class?: string;
}

export const SelectItem: Component<SelectItemProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'value', 'onSelect']);

  return (
    <div
      role="option"
      aria-selected={false}
      class={cn(
        'relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm ',
        'outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground ',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        local.class
      )}
      data-value={props.value}
      onClick={() => props.onSelect(props.value)}
      {...rest}
    >
      <slot />
    </div>
  );
};

// ─── Select Value (display) ──────────────────────────────────────────────────

export interface SelectValueProps {
  value?: string;
  placeholder?: string;
  class?: string;
}

export const SelectValue: Component<SelectValueProps> = (props) => {
  return (
    <span class={props.class}>
      {props.value || props.placeholder}
    </span>
  );
};
