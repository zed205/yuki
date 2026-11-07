import {
  createSignal,
  splitProps,
  For,
  Show,
  onMount,
  createEffect,
  onCleanup,
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
  const { sessions, setActiveSessionId, setModels, setActiveModel, models, setMessages, setCurrentSessionId, setCurrentProjectId, setThinkingEnabled, setNotificationsEnabled, setConfig, setVoiceMode } = useSession();
  const { projects } = useProject();
  const { voiceMode, voiceListening } = useAudio();

  // Token tracking
  const [promptTokens, setPromptTokens] = createSignal(0);
  const [maxTokens, setMaxTokens] = createSignal(64000);

  const tokenPct = () => {
    const p = promptTokens();
    const m = maxTokens();
    if (m <= 0) return 0;
    return Math.round((p / m) * 100);
  };

  // Load initial tree data from server on mount
  onMount(() => {
    // Load projects from server
    fetch('/api/projects')
      .then((r) => r.json())
      .then((data: Array<{ id: string; name: string; path?: string }>) => {
        // Projects are populated via session:connected message handler
      })
      .catch(() => {});
  });

  // Register WebSocket message handlers for connection state
  createEffect(() => {
    const unsubConnected = send('noop' as any, undefined) && (() => {
      // We'll use the send function's return to register handlers
      return null;
    })();

    // We need to access messageRouter from useWebSocket
    const wsCtx = useWebSocket();

    // Session connected: populate models, active model, config
    const unsubSessionConnected = wsCtx.messageRouter.on('session:connected', (data: unknown) => {
      const sd = data as {
        sessionId: string;
        activeProjectId: string;
        thinkingEnabled: boolean;
        voiceMode: boolean;
        projects: Array<{ id: string; name: string }>;
        config: Record<string, unknown>;
        models: Array<{ name: string; displayName?: string }>;
        activeModel: string;
      };
      if (sd.models?.length) {
        setModels(sd.models);
      }
      if (sd.activeModel) {
        setActiveModel(sd.activeModel);
      }
      if (sd.sessionId) {
        setCurrentSessionId(sd.sessionId);
      }
      if (sd.activeProjectId) {
        setCurrentProjectId(sd.activeProjectId);
      }
      if (typeof sd.thinkingEnabled === 'boolean') {
        setThinkingEnabled(sd.thinkingEnabled);
      }
      if (typeof sd.voiceMode === 'boolean') {
        setVoiceMode(sd.voiceMode);
      }
      // Update config
      if (sd.config) {
        setConfig({
          enableImagePaste: sd.config.enableImagePaste as boolean ?? false,
          expandThinking: sd.config.expandThinking as boolean ?? false,
          expandToolOutputs: sd.config.expandToolOutputs as boolean ?? false,
          collapseThinkingTools: sd.config.collapseThinkingTools as boolean ?? false,
          desktopNotifications: sd.config.desktopNotifications as boolean ?? true,
        });
      }
    });

    // Session switched
    const unsubSessionSwitched = wsCtx.messageRouter.on('session:switched', (data: unknown) => {
      const sd = data as { sessionId: string; projectId: string; thinkingEnabled?: boolean; voiceMode?: boolean };
      if (sd.sessionId) {
        setCurrentSessionId(sd.sessionId);
        setMessages([]); // Clear chat messages
      }
      if (sd.projectId) {
        setCurrentProjectId(sd.projectId);
      }
      if (typeof sd.thinkingEnabled === 'boolean') {
        setThinkingEnabled(sd.thinkingEnabled);
      }
      if (typeof sd.voiceMode === 'boolean') {
        setVoiceMode(sd.voiceMode);
      }
    });

    // Project switched
    const unsubProjectSwitched = wsCtx.messageRouter.on('project:switched', (data: unknown) => {
      const pd = data as { projectId: string; sessionId: string; thinkingEnabled?: boolean; voiceMode?: boolean; projects: Array<{ id: string; name: string }> };
      if (pd.projectId) {
        setCurrentProjectId(pd.projectId);
      }
      if (pd.sessionId) {
        setCurrentSessionId(pd.sessionId);
        setMessages([]);
      }
      if (pd.projects) {
        // Projects updated
      }
      if (typeof pd.thinkingEnabled === 'boolean') {
        setThinkingEnabled(pd.thinkingEnabled);
      }
      if (typeof pd.voiceMode === 'boolean') {
        setVoiceMode(pd.voiceMode);
      }
    });

    // Model switched
    const unsubModelSwitched = wsCtx.messageRouter.on('model:switched', (data: unknown) => {
      const md = data as { activeModel: string; model?: string; endpoint?: string; contextWindow?: number; thinkingEnabled?: boolean; preserveThinking?: boolean };
      if (md.activeModel) {
        setActiveModel(md.activeModel);
      }
      if (md.contextWindow) {
        setMaxTokens(md.contextWindow);
      }
      if (typeof md.thinkingEnabled === 'boolean') {
        setThinkingEnabled(md.thinkingEnabled);
      }
    });

    // Context update
    const unsubContextUpdate = wsCtx.messageRouter.on('context:update', (data: unknown) => {
      const cd = data as { promptTokens: number; maxTokens: number };
      if (cd.promptTokens !== undefined) {
        setPromptTokens(cd.promptTokens);
      }
      if (cd.maxTokens !== undefined) {
        setMaxTokens(cd.maxTokens);
      }
    });

    // Thinking toggled
    const unsubThinkingToggled = wsCtx.messageRouter.on('thinking:toggled', (data: unknown) => {
      const td = data as { enabled: boolean };
      if (typeof td.enabled === 'boolean') {
        setThinkingEnabled(td.enabled);
      }
    });

    // Notifications toggled
    const unsubNotifToggled = wsCtx.messageRouter.on('notifications:toggled', (data: unknown) => {
      const nd = data as { enabled: boolean };
      if (typeof nd.enabled === 'boolean') {
        setNotificationsEnabled(nd.enabled);
      }
    });

    // Voice status
    const unsubVoiceStatus = wsCtx.messageRouter.on('voice:status', (data: unknown) => {
      const vd = data as { enabled: boolean };
      if (typeof vd.enabled === 'boolean') {
        setVoiceMode(vd.enabled);
      }
    });

    // Session renamed (auto-summary)
    const unsubSessionRenamed = wsCtx.messageRouter.on('session:renamed', (data: unknown) => {
      const rd = data as { sessionId: string; title: string };
      // Update the session list in SessionContext
      setSessions((prev) => prev.map((s) =>
        s.id === rd.sessionId ? { ...s, title: rd.title } : s
      ));
    });

    // Session moved
    const unsubSessionMoved = wsCtx.messageRouter.on('session:moved', (data: unknown) => {
      const md = data as { sessionId: string; projectId: string };
      setSessions((prev) => prev.map((s) =>
        s.id === md.sessionId ? { ...s, projectId: md.projectId } : s
      ));
    });

    // Message reverted
    const unsubMessageReverted = wsCtx.messageRouter.on('message:reverted', (data: unknown) => {
      setMessages((prev) => prev.filter((_, i) => i >= 0));
    });

    return () => {
      unsubSessionConnected();
      unsubSessionSwitched();
      unsubProjectSwitched();
      unsubModelSwitched();
      unsubContextUpdate();
      unsubThinkingToggled();
      unsubNotifToggled();
      unsubVoiceStatus();
      unsubSessionRenamed();
      unsubSessionMoved();
      unsubMessageReverted();
    };
  });

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
          activeModel={() => sessions().length > 0 ? models()[0]?.name || '' : ''}
          models={() => models()}
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
  activeModel: () => string;
  models: () => Array<{ name: string; displayName?: string }>;
  tokenPct: () => number;
}) {
  const [modelDropdownOpen, setModelDropdownOpen] = createSignal(false);
  const { connectionState, send } = useWebSocket();

  const contextCircle = () => {
    const pct = props.tokenPct();
    const circumference = 100; // 2 * pi * 15.915
    const dashArray = `${Math.min(pct, 100)} ${circumference}`;

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
        <Show when={props.tokenPct() > 0}>
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
          </div>
        </Show>

        {/* Connection status */}
        <div class="hidden sm:flex items-center gap-1.5">
          <div
            class={cn(
              'w-1.5 h-1.5 rounded-full',
              connectionState() === 'connected' ? 'bg-success' : 'bg-danger'
            )}
          />
          <Text size="xs" class="text-muted-foreground">
            {connectionState() === 'connected' ? 'Connected' : connectionState() === 'connecting' ? 'Connecting...' : 'Disconnected'}
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
            {props.activeModel() || 'Select model'}
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
        <Show when={modelDropdownOpen() && props.models().length > 0}>
          <div class="absolute top-12 left-1/2 -translate-x-1/2 w-64 bg-surface border border-border rounded-lg shadow-xl z-50 py-1">
            <For each={props.models()}>
              {(model) => (
                <button
                  class={cn(
                    'w-full text-left px-3 py-2 text-sm transition-colors',
                    model.name === props.activeModel()
                      ? 'bg-surface2 text-foreground'
                      : 'text-muted-foreground hover:bg-surface2/80 hover:text-foreground'
                  )}
                  onClick={() => {
                    send('model:switch', { modelName: model.name });
                    setModelDropdownOpen(false);
                  }}
                >
                  <div class="flex items-center gap-2">
                    <Show when={model.name === props.activeModel()}>
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
        <Show when={connectionState() === 'connected' && false}>
          {/* voiceMode will be shown when connected */}
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
            connectionState() === 'connected' ? 'bg-success' : 'bg-danger'
          )}
        />
        <Text size="xs" class="text-muted-foreground">
          {connectionState() === 'connected' ? 'Connected' : 'Disconnected'}
        </Text>
      </div>
    </div>
  );
}
