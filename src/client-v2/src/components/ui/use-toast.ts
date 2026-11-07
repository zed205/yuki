import { type Accessor, createSignal } from 'solid-js';
import type { ToastType } from './toast';

export type ToastProps = {
  id?: string;
  title?: string;
  description?: string;
  type?: ToastType;
  duration?: number;
  action?: () => void;
};

export type ToastAction = Omit<ToastProps, 'id'> & { id: string };

const TOAST_LIMIT = 5;
const TOAST_DEFAULT_DURATION = 5000;

let count = 0;
function genId() {
  count = (count + 1) % Number.MAX_VALUE;
  return count.toString();
}

type Toast = ToastProps & { id: string };

interface ToastContextValue {
  toasts: Accessor<Toast[]>;
  toast: (props: Omit<ToastProps, 'id'>) => void;
  closeToast: (id: string) => void;
}

export const [ToastContext, setToastContext] = createContext<ToastContextValue>();

export function useToast() {
  return ToastContext;
}

export function createToastContext() {
  const [toasts, setToasts] = createSignal<Toast[]>([]);

  const toast = ({ id, ...props }: Omit<ToastProps, 'id'>) => {
    const toastId = id || genId();
    setToasts((prev) => [
      { ...props, id: toastId, duration: props.duration ?? TOAST_DEFAULT_DURATION },
      ...prev,
    ]);

    // Auto-dismiss
    if (props.duration !== 0) {
      setTimeout(() => {
        closeToast(toastId);
      }, props.duration ?? TOAST_DEFAULT_DURATION);
    }
  };

  const closeToast = (id: string) => {
    setToasts((prev) =>
      prev.filter((t) => t.id !== id),
    );
  };

  return { toasts, toast, closeToast };
}

export function toastToasts() {
  return toast;
}
