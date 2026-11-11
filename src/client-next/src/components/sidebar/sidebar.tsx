'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderPlus, Search, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSession } from '@/context/session-context';
import { useWebSocket } from '@/context/websocket-context';
import { SessionTree } from './session-tree';
import { SubAgentPanel } from './sub-agent-panel';
import {
  buildModelLabel,
  endpointHostPort,
  formatK,
} from '@/lib/model-label';

// ---------------------------------------------------------------------------
// Constants (legacy parity)
// ---------------------------------------------------------------------------

const COLLAPSED_KEY = 'yukiweb-sidebar-collapsed';
const WIDTH_KEY = 'yukiweb-sidebar-width';
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 480;
const DEFAULT_WIDTH = 256; // w-64
const COLLAPSED_WIDTH = 56; // 3.5rem (legacy parity)

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SidebarProps {
  onSessionSelect?: (sessionId: string, projectId: string) => void;
  onSessionRename?: (sessionId: string) => void;
  onSessionDelete?: (sessionId: string) => void;
  onProjectNewSession?: (projectId: string) => void;
  onProjectModify?: (projectId: string) => void;
  onProjectDelete?: (projectId: string) => void;
  onAddProject?: () => void;
  onOpenSearch?: () => void;
  onOpenSettings?: () => void;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Inner content (shared by desktop + mobile drawer)
// ---------------------------------------------------------------------------

interface InnerProps extends SidebarProps {
  onCollapse: () => void;
  onExpand: () => void;
  onPicked?: () => void;
}

function SidebarInner({
  collapsed,
  props,
}: {
  collapsed: boolean;
  props: InnerProps;
}) {
  const { connectionState } = useWebSocket();
  const {
    activeModel,
    structuredModels,
    config,
    promptTokens,
    maxTokens,
  } = useSession();

  const label = buildModelLabel(structuredModels, activeModel);
  const { hostPort, isSecure } = endpointHostPort(config.endpoint);
  const pct =
    maxTokens > 0 ? Math.min(100, Math.round((promptTokens / maxTokens) * 100)) : 0;

  const statusText =
    connectionState === 'connected'
      ? 'Connected'
      : connectionState === 'connecting'
        ? 'Connecting...'
        : 'Disconnected';

  // --- Collapsed rail: avatar + expand button only (legacy verified) ---
  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center gap-1 py-2">
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#d4760a] text-xs font-bold text-white"
          title="Yuki"
        >
          Y
        </div>
        <button
          type="button"
          className="p-1 text-sm leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Expand sidebar"
          onClick={props.onExpand}
        >
          ›
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border p-4">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#d4760a] text-sm font-bold text-white"
          title="Yuki"
        >
          Y
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold leading-tight">Yuki</h1>
          <div className="mt-0.5 text-sm text-muted-foreground">{statusText}</div>
        </div>
        <button
          type="button"
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Settings"
          onClick={props.onOpenSettings}
        >
          <Settings size={16} />
        </button>
        <button
          type="button"
          className="shrink-0 rounded p-1 text-sm leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Collapse sidebar"
          onClick={props.onCollapse}
        >
          «
        </button>
      </div>

      {/* Utility summary */}
      <div className="shrink-0 space-y-2 border-b border-border px-4 py-3">
        <div className="min-w-0 select-none" title={label.display}>
          <div className="truncate text-sm font-medium">{label.display}</div>
        </div>
        <div className="flex min-w-0 items-center gap-1">
          <span className="shrink-0 text-sm">{isSecure ? '🔒' : '🔓'}</span>
          <span
            className="truncate text-xs text-muted-foreground"
            title={config.endpoint || ''}
          >
            {hostPort}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="h-[9px] min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-[#1f6feb] transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
            {formatK(promptTokens)} / {formatK(maxTokens)}
          </span>
        </div>
      </div>

      {/* Background sub-agent activity */}
      <SubAgentPanel />

      {/* Action buttons */}
      <div className="shrink-0 p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-muted hover:text-primary"
            onClick={props.onAddProject}
          >
            <FolderPlus size={16} className="-mt-0.5" />
            New
          </button>
          <button
            type="button"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-muted hover:text-primary"
            onClick={props.onOpenSearch}
          >
            <Search size={16} className="-mt-0.5" />
            Search
          </button>
        </div>
      </div>

      {/* Session tree */}
      <div className="min-h-0 flex-1">
        <SessionTree
          onSessionSelect={props.onSessionSelect}
          onSessionRename={props.onSessionRename}
          onSessionDelete={props.onSessionDelete}
          onProjectNewSession={props.onProjectNewSession}
          onProjectModify={props.onProjectModify}
          onProjectDelete={props.onProjectDelete}
          onPicked={props.onPicked}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar (desktop + mobile drawer)
// ---------------------------------------------------------------------------

export function Sidebar(props: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const widthRef = useRef(width);
  const [isResizing, setIsResizing] = useState(false);
  const resizingRef = useRef(false);
  resizingRef.current = isResizing;

  // Restore persisted state.
  useEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSED_KEY) === 'true') setCollapsed(true);
      const saved = parseInt(localStorage.getItem(WIDTH_KEY) || '', 10);
      if (saved) setWidth(Math.min(Math.max(saved, SIDEBAR_MIN), SIDEBAR_MAX));
    } catch {
      /* ignore */
    }
  }, []);

  const setCollapsedPersist = useCallback((v: boolean) => {
    setCollapsed(v);
    try {
      localStorage.setItem(COLLAPSED_KEY, String(v));
    } catch {
      /* ignore */
    }
  }, []);

  // --- Resizer ---
  const onResizerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      resizingRef.current = true;
      setIsResizing(true);
      const startX = e.clientX;
      const startW = width;
      const onMove = (ev: PointerEvent) => {
        if (!resizingRef.current) return;
        const max = Math.min(SIDEBAR_MAX, Math.round(window.innerWidth * 0.5));
        const w = Math.round(
          Math.min(Math.max(startW + (ev.clientX - startX), SIDEBAR_MIN), max),
        );
        widthRef.current = w; // update synchronously so onUp persists the final value
        setWidth(w);
      };
      const onUp = () => {
        resizingRef.current = false;
        setIsResizing(false);
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        try {
          localStorage.setItem(WIDTH_KEY, String(widthRef.current));
        } catch {
          /* ignore */
        }
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    },
    [width],
  );

  const innerProps: InnerProps = {
    ...props,
    onPicked: () => props.onMobileOpenChange(false),
    onCollapse: () => setCollapsedPersist(true),
    onExpand: () => setCollapsedPersist(false),
  };

  // Mobile drawer is always the full (expanded) sidebar.
  const mobileInner = <SidebarInner collapsed={false} props={innerProps} />;
  const desktopInner = <SidebarInner collapsed={collapsed} props={innerProps} />;

  return (
    <>
      {/* Mobile drawer backdrop */}
      {props.mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => props.onMobileOpenChange(false)}
        />
      )}

      {/* Mobile off-canvas */}
      <aside
        className={cn(
          'fixed bottom-0 left-0 top-0 z-40 flex w-64 -translate-x-full flex-col border-r border-border bg-card transition-transform duration-200 md:hidden',
          props.mobileOpen && 'translate-x-0 shadow-[4px_0_12px_rgba(0,0,0,0.3)]',
        )}
      >
        {mobileInner}
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          'relative hidden h-full shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 ease-out md:flex',
          isResizing && '!transition-none',
        )}
        // Always drive width from a single inline style so the width
        // transition animates cleanly between collapsed/expanded widths.
        style={{ width: collapsed ? COLLAPSED_WIDTH : width }}
      >
        {desktopInner}
        {/* Drag-to-resize handle */}
        {!collapsed && (
          <div
            className="group absolute -right-[3px] top-0 z-50 h-full w-[7px] cursor-col-resize touch-none"
            onPointerDown={onResizerDown}
          >
            <div className="absolute right-[2px] top-0 h-full w-[2px] bg-transparent transition-colors group-hover:bg-[#58a6ff]" />
          </div>
        )}
      </aside>
    </>
  );
}
