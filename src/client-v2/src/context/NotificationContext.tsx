import {
  createContext,
  useContext,
  createSignal,
  createEffect,
  type JSX,
} from 'solid-js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  duration?: number;
  actionLabel?: string;
  action?: () => void;
}

export interface NotificationContextState {
  notifications: Notification[];
}

// ---------------------------------------------------------------------------
// NotificationContext
// ---------------------------------------------------------------------------

export interface NotificationContextActions {
  addNotification: (options: Omit<Notification, 'id'>) => string;
  removeNotification: (id: string) => void;
  removeNotificationById: (id: string) => void;
  success: (message: string, options?: Omit<Notification, 'type' | 'id'>) => string;
  error: (message: string, options?: Omit<Notification, 'type' | 'id'>) => string;
  warning: (message: string, options?: Omit<Notification, 'type' | 'id'>) => string;
  info: (message: string, options?: Omit<Notification, 'type' | 'id'>) => string;
}

export interface NotificationContextValue extends NotificationContextState, NotificationContextActions {}

const NotificationContext = createContext<NotificationContextValue>();

const DEFAULT_DURATION = 4000;

export function NotificationProvider(props: { children: JSX.Element }) {
  const [notifications, setNotifications] = createSignal<Notification[]>([]);

  // Auto-remove notifications after their duration
  createEffect(() => {
    const notifs = notifications();
    for (const notif of notifs) {
      if (notif.duration && notif.duration > 0) {
        setTimeout(() => {
          removeNotification(notif.id);
        }, notif.duration);
      }
    }
  });

  function addNotification(
    options: Omit<Notification, 'id'>
  ): string {
    const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const notification: Notification = {
      ...options,
      id,
      duration: options.duration ?? DEFAULT_DURATION,
    };

    setNotifications((prev) => [...prev, notification]);
    return id;
  }

  function removeNotification(id: string) {
    removeNotificationById(id);
  }

  function removeNotificationById(id: string) {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }

  function success(message: string, options?: Omit<Notification, 'type' | 'id'>) {
    return addNotification({ type: 'success', message, ...options });
  }

  function error(message: string, options?: Omit<Notification, 'type' | 'id'>) {
    return addNotification({ type: 'error', message, ...options });
  }

  function warning(message: string, options?: Omit<Notification, 'type' | 'id'>) {
    return addNotification({ type: 'warning', message, ...options });
  }

  function info(message: string, options?: Omit<Notification, 'type' | 'id'>) {
    return addNotification({ type: 'info', message, ...options });
  }

  // Expose the action handler from the stored notification
  function handleNotificationAction(id: string) {
    const notif = notifications().find((n) => n.id === id);
    if (notif?.action) {
      notif.action();
    }
  }

  const value: NotificationContextValue = {
    notifications,
    addNotification,
    removeNotification,
    removeNotificationById,
    success,
    error,
    warning,
    info,
  };

  return (
    <NotificationContext.Provider value={value}>{props.children}</NotificationContext.Provider>
  );
}

export function useNotification() {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return ctx;
}
