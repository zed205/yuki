import {
  splitProps,
  type Component,
  type JSX,
  createEffect,
  onCleanup,
  createSignal,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { cn } from '@/lib/utils';

// ─── Dialog Root ─────────────────────────────────────────────────────────────

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children?: JSX.Element;
}

export const Dialog: Component<DialogProps> = (props) => (
  <Show when={props.open}>
    <DialogInner
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      {props.children}
    </DialogInner>
  </Show>
);

interface DialogInnerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: JSX.Element;
}

function DialogInner(props: DialogInnerProps) {
  const [prevFocus, setPrevFocus] = createSignal<HTMLElement | null>(null);

  createEffect(() => {
    if (props.open) {
      setPrevFocus(document.activeElement as HTMLElement | null);
      trapFocus();
    } else {
      restoreFocus();
    }
  });

  onCleanup(() => restoreFocus());

  function trapFocus() {
    const dialog = document.getElementById('yuki-dialog-root');
    if (!dialog) return;

    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    function handleKeydown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeydown);
    onCleanup(() => document.removeEventListener('keydown', handleKeydown));

    first.focus();
  }

  function restoreFocus() {
    prevFocus?.focus();
  }

  return (
    <Portal>
      <div
        id="yuki-dialog-root"
        role="dialog"
        aria-modal="true"
        class="fixed inset-0 z-50 flex items-center justify-center"
      >
        {/* Backdrop */}
        <div
          class="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
          onClick={() => props.onOpenChange(false)}
        />
        {/* Content slot — children provide the dialog content container */}
        <div class="relative z-50">{props.children}</div>
      </div>
    </Portal>
  );
}

// ─── Dialog Content Container ────────────────────────────────────────────────

export interface DialogContentProps extends JSX.HTMLAttributes<HTMLDivElement> {
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
}

export const DialogContent: Component<DialogContentProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'onClose', 'onOpenChange']);

  return (
    <div
      class={cn(
        'fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] ',
        'border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in ',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 ',
        'data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 ',
        'data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 ',
        'data-[state=open]:slide-in-from-left-1/2 sm:rounded-lg md:w-full',
        local.class
      )}
      data-state="open"
      {...rest}
    >
      {local.onClose && (
        <DialogClose
          class="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
          onClick={() => {
            local.onClose?.();
            local.onOpenChange?.(false);
          }}
        >
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
            class="lucide lucide-x"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
          <span class="sr-only">Close</span>
        </DialogClose>
      )}
      <slot />
    </div>
  );
};

// ─── Dialog Header ───────────────────────────────────────────────────────────

export interface DialogHeaderProps extends JSX.HTMLAttributes<HTMLDivElement> {
  class?: string;
}

export const DialogHeader: Component<DialogHeaderProps> = (props) => {
  const [local, rest] = splitProps(props, ['class']);

  return (
    <div
      class={cn(
        'flex flex-col space-y-1.5 text-center sm:text-left',
        local.class
      )}
      {...rest}
    >
      <slot />
    </div>
  );
};

// ─── Dialog Title ────────────────────────────────────────────────────────────

export interface DialogTitleProps extends JSX.HTMLAttributes<HTMLHeadingElement> {
  class?: string;
}

export const DialogTitle: Component<DialogTitleProps> = (props) => {
  const [local, rest] = splitProps(props, ['class']);

  return (
    <h2
      class={cn('text-lg font-semibold leading-none tracking-tight', local.class)}
      {...rest}
    >
      <slot />
    </h2>
  );
};

// ─── Dialog Description ──────────────────────────────────────────────────────

export interface DialogDescriptionProps
  extends JSX.HTMLAttributes<HTMLParagraphElement> {
  class?: string;
}

export const DialogDescription: Component<DialogDescriptionProps> = (props) => {
  const [local, rest] = splitProps(props, ['class']);

  return (
    <p
      class={cn('text-sm text-muted-foreground', local.class)}
      {...rest}
    >
      <slot />
    </p>
  );
};

// ─── Dialog Footer ───────────────────────────────────────────────────────────

export interface DialogFooterProps extends JSX.HTMLAttributes<HTMLDivElement> {
  class?: string;
}

export const DialogFooter: Component<DialogFooterProps> = (props) => {
  const [local, rest] = splitProps(props, ['class']);

  return (
    <div
      class={cn(
        'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
        local.class
      )}
      {...rest}
    >
      <slot />
    </div>
  );
};

// ─── Dialog Body ─────────────────────────────────────────────────────────────

export interface DialogBodyProps extends JSX.HTMLAttributes<HTMLDivElement> {
  class?: string;
}

export const DialogBody: Component<DialogBodyProps> = (props) => {
  const [local, rest] = splitProps(props, ['class']);

  return (
    <div class={cn('py-4', local.class)} {...rest}>
      <slot />
    </div>
  );
};

// ─── Dialog Close Button ─────────────────────────────────────────────────────

interface DialogCloseProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  class?: string;
}

const DialogClose: Component<DialogCloseProps> = (props) => {
  const [local, rest] = splitProps(props, ['class']);

  return (
    <button
      type="button"
      class={cn(
        'rounded-sm opacity-70 ring-offset-background transition-opacity ',
        'hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring ',
        'focus:ring-offset-2 disabled:pointer-events-none',
        local.class
      )}
      {...rest}
    >
      <slot />
    </button>
  );
};
