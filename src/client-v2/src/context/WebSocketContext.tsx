import {
  createContext,
  useContext,
  createSignal,
  createEffect,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WebSocketMessageType = string;
export type WebSocketMessageData = unknown;

export interface WebSocketMessage {
  type: string;
  data: unknown;
}

export interface WebSocketConnectionConfig {
  url?: string;
  autoReconnect?: boolean;
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  onConnected?: () => void;
  onDisconnected?: (reason?: string) => void;
}

// ---------------------------------------------------------------------------
// Server → Client message types (read-only, matches server/index.ts)
// ---------------------------------------------------------------------------

export interface ServerMessageRouter {
  /** Register a handler for a specific server message type. Returns cleanup function. */
  on(type: string, handler: (data: unknown) => void): () => void;
  /** Remove a handler for a specific type. */
  off(type: string, handler: (data: unknown) => void): void;
  /** Get the current message history. */
  getMessageHistory(): ServerMessageEntry[];
}

export interface ServerMessageEntry {
  type: string;
  data: unknown;
  timestamp: number;
}

const DEFAULT_CONFIG: Required<WebSocketConnectionConfig> = {
  url: `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`,
  autoReconnect: true,
  maxRetries: -1, // unlimited
  baseDelay: 1000,
  maxDelay: 30000,
  onConnected: () => {},
  onDisconnected: () => {},
};

// ---------------------------------------------------------------------------
// WebSocketContext
// ---------------------------------------------------------------------------

export interface WebSocketContextState {
  isConnected: boolean;
  connectionState: 'connected' | 'connecting' | 'disconnected' | 'error';
}

export interface WebSocketContextActions {
  connect: () => void;
  disconnect: () => void;
  send: (type: string, data?: unknown) => boolean;
  onMessage: (handler: (message: WebSocketMessage) => void) => void;
  offMessage: (handler: (message: WebSocketMessage) => void) => void;
  messageRouter: ServerMessageRouter;
}

export interface WebSocketContextValue extends WebSocketContextState, WebSocketContextActions {}

const WebSocketContext = createContext<WebSocketContextValue>();

// Shared message history (singleton for the app)
let globalMessageHistory: ServerMessageEntry[] = [];

export function WebSocketProvider(props: {
  children: JSX.Element;
  config?: WebSocketConnectionConfig;
}) {
  const config = { ...DEFAULT_CONFIG, ...props.config };
  const [isConnected, setIsConnected] = createSignal(false);
  const [connectionState, setConnectionState] = createSignal<'connected' | 'connecting' | 'disconnected' | 'error'>('disconnected');

  let ws: WebSocket | null = null;
  let reconnectAttempts = 0;
  let messageHandlers: Set<(message: WebSocketMessage) => void> = new Set();
  let cleanupReconnect: ReturnType<typeof setTimeout> | null = null;

  // Per-type handlers for the message router
  const typeHandlers = new Map<string, Set<(data: unknown) => void>>();

  // Clean up on unmount
  onCleanup(() => {
    disconnect();
  });

  // Start connection on mount
  onMount(() => {
    connect();
  });

  function connect() {
    if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    setConnectionState('connecting');

    try {
      ws = new WebSocket(config.url);
    } catch (err) {
      console.error('WebSocket connection error:', err);
      setConnectionState('error');
      handleReconnect();
      return;
    }

    ws.onopen = () => {
      setIsConnected(true);
      setConnectionState('connected');
      reconnectAttempts = 0;
      config.onConnected?.();
    };

    ws.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);

        // Add to global message history
        globalMessageHistory.push({
          type: message.type,
          data: message.data,
          timestamp: Date.now(),
        });
        // Cap history at 500 entries
        if (globalMessageHistory.length > 500) {
          globalMessageHistory = globalMessageHistory.slice(-400);
        }

        // Notify general message handlers
        messageHandlers.forEach((handler) => {
          try {
            handler(message);
          } catch (err) {
            console.error('WebSocket message handler error:', err);
          }
        });

        // Dispatch to per-type handlers
        const handlers = typeHandlers.get(message.type);
        if (handlers) {
          handlers.forEach((handler) => {
            try {
              handler(message.data);
            } catch (err) {
              console.error(`Handler error for ${message.type}:`, err);
            }
          });
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    ws.onclose = (event) => {
      setIsConnected(false);
      setConnectionState('disconnected');
      config.onDisconnected?.(event.reason || 'Connection closed');

      if (ws === null) return; // already cleaned up
      ws = null;

      if (config.autoReconnect) {
        handleReconnect();
      }
    };

    ws.onerror = () => {
      setConnectionState('error');
    };
  }

  function disconnect() {
    if (cleanupReconnect) {
      clearTimeout(cleanupReconnect);
      cleanupReconnect = null;
    }
    ws?.close();
    ws = null;
    setIsConnected(false);
    setConnectionState('disconnected');
  }

  function handleReconnect() {
    if (config.maxRetries !== -1 && reconnectAttempts >= config.maxRetries) {
      setConnectionState('error');
      return;
    }

    const delay = Math.min(
      config.baseDelay * Math.pow(2, reconnectAttempts),
      config.maxDelay
    );
    reconnectAttempts++;

    cleanupReconnect = setTimeout(() => {
      setConnectionState('connecting');
      connect();
    }, delay);
  }

  function send(type: string, data?: unknown): boolean {
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type, data }));
        return true;
      } catch (err) {
        console.error('WebSocket send error:', err);
        return false;
      }
    }
    return false;
  }

  function onMessage(handler: (message: WebSocketMessage) => void) {
    messageHandlers.add(handler);
    return () => messageHandlers.delete(handler);
  }

  function offMessage(handler: (message: WebSocketMessage) => void) {
    messageHandlers.delete(handler);
  }

  // Message router API
  function registerTypeHandler(type: string, handler: (data: unknown) => void): () => void {
    if (!typeHandlers.has(type)) {
      typeHandlers.set(type, new Set());
    }
    const handlers = typeHandlers.get(type)!;
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  function unregisterTypeHandler(type: string, handler: (data: unknown) => void) {
    const handlers = typeHandlers.get(type);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        typeHandlers.delete(type);
      }
    }
  }

  function getMessageHistory(): ServerMessageEntry[] {
    return [...globalMessageHistory];
  }

  const value: WebSocketContextValue = {
    isConnected,
    connectionState,
    connect,
    disconnect,
    send,
    onMessage,
    offMessage,
    messageRouter: {
      on: registerTypeHandler,
      off: unregisterTypeHandler,
      getMessageHistory,
    },
  };

  return <WebSocketContext.Provider value={value}>{props.children}</WebSocketContext.Provider>;
}

export function useWebSocket() {
  const ctx = useContext(WebSocketContext);
  if (!ctx) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return ctx;
}
