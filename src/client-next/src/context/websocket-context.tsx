'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { WSEvent } from '@/lib/types';

// ---------------------------------------------------------------------------
// Message router (stable identity — handlers live in refs)
// ---------------------------------------------------------------------------

export type MessageHandler = (data: unknown) => void;

export interface MessageRouter {
  on: (type: string, handler: MessageHandler) => () => void;
  off: (type: string, handler: MessageHandler) => void;
}

interface MessageRouterImpl extends MessageRouter {
  dispatch: (type: string, data: unknown) => void;
}

function createMessageRouter(): MessageRouterImpl {
  const typeHandlers = new Map<string, Set<MessageHandler>>();

  const on: MessageRouter['on'] = (type, handler) => {
    if (!typeHandlers.has(type)) typeHandlers.set(type, new Set());
    typeHandlers.get(type)!.add(handler);
    return () => {
      const handlers = typeHandlers.get(type);
      if (!handlers) return;
      handlers.delete(handler);
      if (handlers.size === 0) typeHandlers.delete(type);
    };
  };

  const off: MessageRouter['off'] = (type, handler) => {
    typeHandlers.get(type)?.delete(handler);
  };

  const dispatch: MessageRouterImpl['dispatch'] = (type, data) => {
    const handlers = typeHandlers.get(type);
    if (!handlers) return;
    handlers.forEach((handler) => {
      try {
        handler(data);
      } catch (err) {
        console.error(`Handler error for ${type}:`, err);
      }
    });
  };

  return { on, off, dispatch };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface WebSocketMessage {
  type: string;
  data: unknown;
}

interface WebSocketContextValue {
  isConnected: boolean;
  connectionState: 'connected' | 'connecting' | 'disconnected' | 'error';
  connect: () => void;
  disconnect: () => void;
  send: (type: string, data?: unknown) => boolean;
  /** Subscribe to every message (rarely used; prefer messageRouter.on). */
  onMessage: (handler: (message: WebSocketMessage) => void) => () => void;
  messageRouter: MessageRouter;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

function defaultWsUrl(): string {
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const routerRef = useRef<MessageRouterImpl | null>(null);
  const generalHandlers = useRef<Set<(m: WebSocketMessage) => void>>(new Set());

  if (!routerRef.current) routerRef.current = createMessageRouter();

  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<
    WebSocketContextValue['connectionState']
  >('disconnected');

  const connect = useCallback(() => {
    const existing = wsRef.current;
    if (
      existing &&
      (existing.readyState === WebSocket.OPEN ||
        existing.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    setConnectionState('connecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(defaultWsUrl());
    } catch (err) {
      console.error('WebSocket connection error:', err);
      setConnectionState('error');
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setConnectionState('connected');
      reconnectAttempts.current = 0;
    };

    ws.onmessage = (event) => {
      let message: WebSocketMessage;
      try {
        message = JSON.parse(event.data) as WebSocketMessage;
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
        return;
      }

      generalHandlers.current.forEach((handler) => {
        try {
          handler(message);
        } catch (err) {
          console.error('WebSocket message handler error:', err);
        }
      });

      routerRef.current?.dispatch(message.type, message.data);
    };

    ws.onclose = () => {
      setIsConnected(false);
      setConnectionState('disconnected');
      if (wsRef.current === ws) wsRef.current = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      setConnectionState('error');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    const delay = Math.min(
      1000 * Math.pow(2, reconnectAttempts.current),
      30000,
    );
    reconnectAttempts.current += 1;
    reconnectTimer.current = setTimeout(() => {
      setConnectionState('connecting');
      connect();
    }, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connect]);

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    wsRef.current?.close();
    wsRef.current = null;
    setIsConnected(false);
    setConnectionState('disconnected');
  }, []);

  const send = useCallback((type: string, data?: unknown): boolean => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify({ type, data }));
      return true;
    } catch (err) {
      console.error('WebSocket send error:', err);
      return false;
    }
  }, []);

  const onMessage = useCallback(
    (handler: (message: WebSocketMessage) => void) => {
      generalHandlers.current.add(handler);
      return () => generalHandlers.current.delete(handler);
    },
    [],
  );

  // Connect on mount, clean up on unmount
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const messageRouter = useMemo<MessageRouter>(
    () => ({
      on: (type, handler) => routerRef.current!.on(type, handler),
      off: (type, handler) => routerRef.current!.off(type, handler),
    }),
    [],
  );

  const value = useMemo<WebSocketContextValue>(
    () => ({
      isConnected,
      connectionState,
      connect,
      disconnect,
      send,
      onMessage,
      messageRouter,
    }),
    [isConnected, connectionState, connect, disconnect, send, onMessage, messageRouter],
  );

  return (
    <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error('useWebSocket must be used within a WebSocketProvider');
  return ctx;
}

export type { WSEvent };
