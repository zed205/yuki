import {
  createSignal,
  splitProps,
  For,
  Show,
  onMount,
  type JSX,
} from 'solid-js';
import { Box, Text, Badge, Button, Switch, IconButton } from '../ui';
import { cn } from '../../lib/utils';
import { Sidebar } from '../Sidebar/Sidebar';
import { ChatPanel } from '../Chat/ChatPanel';
import { useWebSocket } from '../../context/WebSocketContext';
import { useSession } from '../../context/SessionContext';
import { useAudio } from '../../context/AudioContext';
import { useProject } from '../../context/ProjectContext';

interface MainLayoutProps {
  className?: string;
}

export function MainLayout(props: MainLayoutProps) {
  const { className } = props;
  const [sidebarOpen, setSidebarOpen] = createSignal(true);

  const { connectionState, send } = useWebSocket();
  const { sessions, setActiveSessionId } = useSession();
  const { projects } = useProject();
  const { voiceMode, voiceListening } = useAudio();

  const isMobile = () => window.innerWidth < 1024;

  // Responsive sidebar state
  onMount(() => {
    const handleResize = () => {
      if (isMobile()) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  });

  const handleSessionSelect = (sessionId: string, projectId: string) => {
    send('session:switch', { sessionId, projectId });
    setActiveSessionId(sessionId);
  };

  const handleSessionRename = (sessionId: string) => {
    const session = sessions().find((s) => s.id === sessionId);
    if (!session) return;
    const newName = prompt('Rename session:', session.title);
    if (newName && newName.trim()) {
      send('session:rename', {
        sessionId,
        title: newName.trim(),
      });
    }
  };

  const handleSessionDelete = (sessionId: string) => {
    if (confirm('Delete this session?')) {
      send('session:delete', { sessionId });
    }
  };

  const handleProjectSelect = (projectId: string) => {
    send('project:switch', { projectId });
  };

  const handleAddProject = () => {
    const name = prompt('Project name:');
    if (name && name.trim()) {
      send('project:create', { name: name.trim() });
    }
  };

  // Calculate token usage for context indicator
  const tokenPct = 0; // Would be calculated from context update events

  return (
    <div
      class={cn(
        'flex h-screen w-screen overflow-hidden bg-background text-foreground',
        className
      )}
    >
      {/* Sidebar */}
      <div class="flex-shrink-0">
        <Sidebar
          onSessionSelect={handleSessionSelect}
          onSessionRename={handleSessionRename}
          onSessionDelete={handleSessionDelete}
          onProjectSelect={handleProjectSelect}
          onAddProject={handleAddProject}
          onToggleCollapse={() => setSidebarOpen((prev) => !prev)}
        />
      </div>

      {/* Mobile sidebar toggle button */}
      <Show when={isMobile()}>
        <div class="lg:hidden fixed top-3 left-3 z-30">
          <IconButton
            icon="menu"
            size="sm"
            tooltip="Open sidebar"
            onClick={() => {
              // Trigger sidebar open via custom event or prop
            }}
          />
        </div>
      </Show>

      {/* Main content area */}
      <div class="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <TopBar
          model={connectionState().activeModel}
          models={connectionState().models}
          tokenPct={tokenPct}
        />

        {/* Chat panel */}
        <ChatPanel />

        {/* Mobile status bar */}
        <StatusBarMobile />
      </div>
    </div>
  );
}

function TopBar(props: {
  model?: string;
  models?: Array<{ name: string; displayName: string }>;
  tokenPct: number;
}) {
  const [modelDropdownOpen, setModelDropdownOpen] = createSignal(false);
  const { connectionState, send } = useWebSocket();

  const contextCircle = () => {
    const pct = props.tokenPct;
    const circumference = 100; // 2 * pi * 15.915
    const dashArray = `${pct} ${circumference}`;

    let color = 'success';
    if (pct > 90) color = 'destructive';
    else if (pct > 70) color = 'warning';

    return { dashArray, color };
  };

  return (
    <header class="flex items-center justify-between h-12 px-4 border-b border-border/50 bg-surface/50 shrink-0">
      {/* Left: Context indicator */}
      <div class="flex items-center gap-3">
        {/* Token usage circle */}
        <div class="relative w-6 h-6">
          <svg class="w-6 h-6 -rotate-90" viewBox="0 0 36 36">
            <circle
              cx="18"
              cy="18"
              r="15.915"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              class="text-border/20"
            />
            <circle
              cx="18"
              cy="18"
              r="15.915"
              fill="none"
              stroke={
                contextCircle().color === 'success'
                  ? 'var(--success)'
                  : contextCircle().color === 'warning'
                    ? 'var(--warning)'
                    : 'var(--destructive)'
              }
              strokeWidth="2"
              strokeDasharray={contextCircle().dashArray}
              strokeDashoffset="0"
              strokeLinecap="round"
            />
          </svg>
          <div class="absolute inset-0 flex items-center justify-center">
            <Text size="xs" weight="semibold" class="text-muted-foreground">
              {props.tokenPct}%
            </Text>
          </div>
        </div>

        {/* Connection status */}
        <div class="hidden sm:flex items-center gap-1.5">
          <div
            class={cn(
              'w-1.5 h-1.5 rounded-full',
              connectionState().connected ? 'bg-success' : 'bg-danger'
            )}
          />
          <Text size="xs" class="text-muted-foreground">
            {connectionState().connected ? 'Connected' : 'Disconnected'}
          </Text>
        </div>
      </div>

      {/* Center: Model selector */}
      <div class="flex-1 flex justify-center">
        <button
          class={cn(
            'flex items-center gap-2 px-3 py-1 rounded-md text-sm transition-colors',
            'hover:bg-surface2/80 text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setModelDropdownOpen((prev) => !prev)}
        >
          <Text size="sm" weight="medium" truncate>
            {props.model || 'Select model'}
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
            class={cn(
              'text-muted-foreground transition-transform',
              modelDropdownOpen() && 'rotate-180'
            )}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {/* Model dropdown */}
        <Show when={modelDropdownOpen() && props.models}>
          <div class="absolute top-12 left-1/2 -translate-x-1/2 w-64 bg-surface border border-border rounded-lg shadow-xl z-50 py-1">
            <For each={props.models || []}>
              {(model) => (
                <button
                  class={cn(
                    'w-full text-left px-3 py-2 text-sm transition-colors',
                    model.name === props.model
                      ? 'bg-surface2 text-foreground'
                      : 'text-muted-foreground hover:bg-surface2/80 hover:text-foreground'
                  )}
                  onClick={() => {
                    send('model:switch', { modelName: model.name });
                    setModelDropdownOpen(false);
                  }}
                >
                  <div class="flex items-center gap-2">
                    <Show when={model.name === props.model}>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        class="text-success"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </Show>
                    <span class="truncate">{model.displayName || model.name}</span>
                  </div>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* Right: Quick actions */}
      <div class="flex items-center gap-1">
        <IconButton icon="search" size="sm" tooltip="Search" />
        <Show when={voiceMode()}>
          <div class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[hsl(var(--primary))/10">
            <div
              class={cn(
                'w-1.5 h-1.5 rounded-full',
                voiceListening() ? 'bg-[hsl(var(--primary))] animate-pulse' : 'bg-muted-foreground'
              )}
            />
            <Text size="xs" class="text-[hsl(var(--primary))]">
              {voiceListening() ? 'Listening' : 'Voice'}
            </Text>
          </div>
        </Show>
      </div>
    </header>
  );
}

function StatusBarMobile() {
  const { connectionState } = useWebSocket();

  return (
    <div class="lg:hidden flex items-center justify-center gap-3 px-4 py-1.5 border-t border-border/50 bg-surface/30">
      <div class="flex items-center gap-1.5">
        <div
          class={cn(
            'w-1.5 h-1.5 rounded-full',
            connectionState().connected ? 'bg-success' : 'bg-danger'
          )}
        />
        <Text size="xs" class="text-muted-foreground">
          {connectionState().connected ? 'Connected' : 'Disconnected'}
        </Text>
      </div>
      <Show when={connectionState().endpoint}>
        <Text size="xs" class="text-muted-foreground/60">
          {(() => {
            try {
              const u = new URL(connectionState().endpoint!);
              return u.hostname;
            } catch {
              return connectionState().endpoint;
            }
          })()}
        </Text>
      </Show>
    </div>
  );
}
