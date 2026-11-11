'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSession } from '@/context/session-context';
import { useProject } from '@/context/project-context';
import { useWebSocket } from '@/context/websocket-context';
import { Sidebar } from '@/components/sidebar/sidebar';
import { ChatPanel } from '@/components/chat/chat-panel';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/box';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

// ---------------------------------------------------------------------------
// Token usage ring
// ---------------------------------------------------------------------------

function TokenRing({ pct }: { pct: number }) {
  if (pct <= 0) return null;
  const dashArray = `${Math.min(pct, 100)} 100`;
  const color =
    pct > 90 ? '#ef4444' : pct > 70 ? '#f59e0b' : '#22c55e';
  return (
    <div className="relative h-6 w-6" title={`${pct}% context used`}>
      <svg className="h-6 w-6 -rotate-90" viewBox="0 0 36 36">
        <circle
          cx="18"
          cy="18"
          r="15.915"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-border/20"
        />
        <circle
          cx="18"
          cy="18"
          r="15.915"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={dashArray}
          strokeDashoffset="0"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

function TopBar() {
  const { activeModel, models, switchModel, promptTokens, maxTokens } =
    useSession();
  const { connectionState } = useWebSocket();
  const [modelOpen, setModelOpen] = useState(false);

  const pct = maxTokens > 0 ? Math.round((promptTokens / maxTokens) * 100) : 0;

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/50 bg-background/50 px-4">
      {/* Left: context indicator + connection status */}
      <div className="flex items-center gap-3">
        <TokenRing pct={pct} />
        <div className="hidden items-center gap-1.5 sm:flex">
          <div
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              connectionState === 'connected' ? 'bg-green-500' : 'bg-red-500',
            )}
          />
          <Text size="xs" className="text-muted-foreground">
            {connectionState === 'connected'
              ? 'Connected'
              : connectionState === 'connecting'
                ? 'Connecting...'
                : 'Disconnected'}
          </Text>
        </div>
      </div>

      {/* Center: model selector */}
      <div className="flex flex-1 justify-center">
        <Popover open={modelOpen} onOpenChange={setModelOpen}>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-2 rounded-md px-3 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground">
              <Text size="sm" weight="medium" truncate>
                {activeModel || 'Select model'}
              </Text>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={cn(
                  'text-muted-foreground transition-transform',
                  modelOpen && 'rotate-180',
                )}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </PopoverTrigger>
          <PopoverContent align="center" className="w-64 p-1">
            {models.map((model) => (
              <button
                key={model.name}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                  model.name === activeModel
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                )}
                onClick={() => {
                  switchModel(model.name);
                  setModelOpen(false);
                }}
              >
                {model.name === activeModel && (
                  <Check size={14} className="shrink-0 text-green-500" />
                )}
                <span className="truncate">
                  {model.displayName || model.name}
                </span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>

      {/* Right: quick actions */}
      <div className="flex items-center gap-1">
        <IconButton icon="search" size="sm" tooltip="Search" />
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Mobile status bar
// ---------------------------------------------------------------------------

function StatusBarMobile() {
  const { connectionState } = useWebSocket();
  return (
    <div className="flex items-center justify-center gap-3 border-t border-border/50 bg-background/30 px-4 py-1.5 lg:hidden">
      <div className="flex items-center gap-1.5">
        <div
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            connectionState === 'connected' ? 'bg-green-500' : 'bg-red-500',
          )}
        />
        <Text size="xs" className="text-muted-foreground">
          {connectionState === 'connected' ? 'Connected' : 'Disconnected'}
        </Text>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main layout
// ---------------------------------------------------------------------------

export function MainLayout({ className }: { className?: string }) {
  const { sessions, switchSession, renameSession, deleteSession } = useSession();
  const { addProject: addProjectCtx, setCurrentProject } = useProject();

  const handleSessionSelect = (sessionId: string, projectId: string) => {
    switchSession(sessionId, projectId);
  };

  const handleSessionRename = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const newName = window.prompt('Rename session:', session.title);
    if (newName && newName.trim()) {
      renameSession(sessionId, newName.trim());
    }
  };

  const handleSessionDelete = (sessionId: string) => {
    if (window.confirm('Delete this session?')) {
      deleteSession(sessionId);
    }
  };

  const handleAddProject = async () => {
    const name = window.prompt('Project name:');
    if (name && name.trim()) {
      try {
        await addProjectCtx(name.trim());
      } catch {
        /* provider logs */
      }
    }
  };

  return (
    <div
      className={cn(
        'flex h-screen w-screen overflow-hidden bg-background text-foreground',
        className,
      )}
    >
      {/* Sidebar */}
      <div className="flex-shrink-0">
        <Sidebar
          onSessionSelect={handleSessionSelect}
          onSessionRename={handleSessionRename}
          onSessionDelete={handleSessionDelete}
          onProjectSelect={(projectId) => {
            void setCurrentProject(projectId).catch(() => {});
          }}
          onAddProject={handleAddProject}
        />
      </div>

      {/* Main content area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <ChatPanel />
        <StatusBarMobile />
      </div>
    </div>
  );
}
