import { createContext, useContext, createSignal, type JSX, For } from 'solid-js';

// ---------------------------------------------------------------------------
// Toast types
// ---------------------------------------------------------------------------

export interface ToastData {
  id: string;
  title?: string;
  description?: string;
  type: 'info' | 'success' | 'error' | 'warning';
  duration?: number;
}

// ---------------------------------------------------------------------------
// Toast context
// ---------------------------------------------------------------------------

interface ToastContextValue {
  toasts: () => ToastData[];
  addToast: (data: Omit<ToastData, 'id'>) => void;
  showToast: (message: string, type?: ToastData['type']) => void;
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
  showInfo: (message: string) => void;
  showWarning: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue>();

const DEFAULT_DURATION = 3000;

export function ToasterProvider(props: { children: JSX.Element }) {
  const [toasts, setToasts] = createSignal<ToastData[]>([]);

  const addToast = (data: Omit<ToastData, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const toast: ToastData = { ...data, id, duration: data.duration ?? DEFAULT_DURATION };
    setToasts((prev) => [...prev, toast]);

    if (toast.duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, toast.duration);
    }
  };

  const value: ToastContextValue = {
    toasts,
    addToast,
    showToast: (message, type = 'info') => addToast({ title: message, type }),
    showSuccess: (message) => addToast({ title: message, type: 'success' }),
    showError: (message) => addToast({ title: message, type: 'error' }),
    showInfo: (message) => addToast({ title: message, type: 'info' }),
    showWarning: (message) => addToast({ title: message, type: 'warning' }),
  };

  return (
    <ToastContext.Provider value={value}>
      {props.children}
      <div
        class="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2"
        aria-live="polite"
      >
        <For each={toasts()}>
          {(t) => <ToastItem toast={t} />}
        </For>
      </div>
    </ToastContext.Provider>
  );
}

export function useToaster() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToaster must be used within a ToasterProvider');
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Toast item component
// ---------------------------------------------------------------------------

function ToastItem({ toast }: { toast: ToastData }) {
  const typeStyles: Record<string, string> = {
    info: 'border-blue-500/30 bg-surface2 text-foreground',
    success: 'border-green-500/30 bg-surface2 text-foreground',
    error: 'border-red-500/30 bg-surface2 text-foreground',
    warning: 'border-yellow-500/30 bg-surface2 text-foreground',
  };

  return (
    <div
      class={`rounded-lg border px-4 py-2 text-sm shadow-2xl ${typeStyles[toast.type]}`}
    >
      {toast.title}
      {toast.description && (
        <p class="text-xs text-muted-foreground mt-1">{toast.description}</p>
      )}
    </div>
  );
}
