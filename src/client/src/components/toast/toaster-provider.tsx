'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

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

interface ToastContextValue {
  toasts: ToastData[];
  addToast: (data: Omit<ToastData, 'id'>) => void;
  dismissToast: (id: string) => void;
  showToast: (message: string, type?: ToastData['type']) => void;
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
  showInfo: (message: string) => void;
  showWarning: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 3000;

let toastCounter = 0;

export function ToasterProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const addToast = useCallback(
    (data: Omit<ToastData, 'id'>) => {
      const id = `toast-${Date.now()}-${++toastCounter}`;
      const duration = data.duration ?? DEFAULT_DURATION;
      setToasts((prev) => [...prev, { ...data, id, duration }]);
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismissToast(id), duration),
        );
      }
    },
    [dismissToast],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toasts,
      addToast,
      dismissToast,
      showToast: (message, type = 'info') =>
        addToast({ title: message, type }),
      showSuccess: (message) => addToast({ title: message, type: 'success' }),
      showError: (message) => addToast({ title: message, type: 'error' }),
      showInfo: (message) => addToast({ title: message, type: 'info' }),
      showWarning: (message) => addToast({ title: message, type: 'warning' }),
    }),
    [toasts, addToast, dismissToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed bottom-4 left-1/2 z-[100] flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismissToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToaster() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToaster must be used within a <ToasterProvider>');
  return ctx;
}

// ---------------------------------------------------------------------------
// Toast item
// ---------------------------------------------------------------------------

const TYPE_STYLES: Record<ToastData['type'], string> = {
  info: 'border-blue-500/30 bg-popover',
  success: 'border-green-500/30 bg-popover',
  error: 'border-red-500/30 bg-popover',
  warning: 'border-yellow-500/30 bg-popover',
};

const TYPE_ICONS: Record<ToastData['type'], string> = {
  info: 'ℹ️',
  success: '✅',
  error: '⚠️',
  warning: '⚠️',
};

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastData;
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex cursor-pointer items-start gap-2 rounded-lg border px-4 py-2 text-sm text-foreground shadow-2xl',
        TYPE_STYLES[toast.type],
      )}
      onClick={() => onDismiss(toast.id)}
    >
      <span className="text-xs leading-5">{TYPE_ICONS[toast.type]}</span>
      <div className="min-w-0">
        {toast.title && <p className="truncate">{toast.title}</p>}
        {toast.description && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {toast.description}
          </p>
        )}
      </div>
    </div>
  );
}
