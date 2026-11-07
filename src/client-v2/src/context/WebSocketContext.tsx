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
}

export interface WebSocketContextValue extends WebSocketContextState, WebSocketContextActions {}

const WebSocketContext = createContext<WebSocketContextValue>();

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

  // Clean up on unmount
  onCleanup(() => {
    disconnect();
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
        messageHandlers.forEach((handler) => {
          try {
            handler(message);
          } catch (err) {
            console.error('WebSocket message handler error:', err);
          }
        });
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

  const value: WebSocketContextValue = {
    isConnected,
    connectionState,
    connect,
    disconnect,
    send,
    onMessage,
    offMessage,
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
