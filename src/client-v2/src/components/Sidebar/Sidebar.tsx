import {
  createSignal,
  splitProps,
  For,
  Show,
  createEffect,
  onMount,
  type JSX,
} from 'solid-js';
import { Box, Text, Badge, Switch, IconButton } from '../ui';
import { cn } from '../../lib/utils';
import { useAudio } from '../../context/AudioContext';
import { useSession } from '../../context/SessionContext';
import { SessionTree } from './SessionTree';
import { ProjectList } from './ProjectList';
import { useWebSocket } from '../../context/WebSocketContext';

interface SidebarProps {
  onSessionSelect?: (sessionId: string, projectId: string) => void;
  onSessionRename?: (sessionId: string) => void;
  onSessionDelete?: (sessionId: string) => void;
  onProjectSelect?: (projectId: string) => void;
  onAddProject?: () => void;
  onToggleCollapse?: () => void;
  children?: JSX.Element;
}

interface OptionsMenuItem {
  label: string;
  icon?: string;
  shortcut?: string;
  checked?: boolean;
  onChange?: () => void;
}

export function Sidebar(props: SidebarProps) {
  const {
    onSessionSelect,
    onSessionRename,
    onSessionDelete,
    onProjectSelect,
    onAddProject,
    onToggleCollapse,
    children,
  } = props;

  const [isOpen, setIsOpen] = createSignal(true);
  const [mobileOpen, setMobileOpen] = createSignal(false);
  const [optionsOpen, setOptionsOpen] = createSignal(false);
  const [activeSection, setActiveSection] = createSignal<'sessions' | 'projects'>(
    'sessions'
  );

  const {
    voiceMode,
    setVoiceMode,
    micEnabled,
    setMicEnabled,
    ttsEnabled,
    setTtsEnabled,
    pushToTalk,
    setPushToTalk,
    voiceListening,
  } = useAudio();

  const { thinkingEnabled, setThinkingEnabled, compactMode, setCompactMode, notificationsEnabled, setNotificationsEnabled } = useSession();
  const { connectionState, send } = useWebSocket();

  // Responsive: detect mobile
  const isMobile = () => window.innerWidth < 1024;

  createEffect(() => {
    if (isMobile()) {
      setIsOpen(false);
    } else {
      setIsOpen(true);
    }
  });

  // Listen for resize
  onMount(() => {
    const handleResize = () => {
      if (isMobile()) {
        setIsOpen(false);
        setMobileOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  });

  const optionsMenuItems: OptionsMenuItem[] = [
    {
      label: 'Voice Mode',
      icon: 'mic',
      checked: voiceMode(),
      onChange: () => {
        const next = !voiceMode();
        setVoiceMode(next);
        send('voice:toggle', { enabled: next });
      },
    },
    {
      label: 'Microphone',
      icon: 'mic',
      checked: micEnabled(),
      onChange: () => {
        const next = !micEnabled();
        setMicEnabled(next);
        send('mic:toggle', { enabled: next });
      },
    },
    {
      label: 'Text-to-Speech',
      icon: null,
      checked: ttsEnabled(),
      onChange: () => {
        const next = !ttsEnabled();
        setTtsEnabled(next);
        send('tts:toggle', { enabled: next });
      },
    },
    {
      label: 'Push-to-Talk',
      icon: null,
      checked: pushToTalk(),
      onChange: () => {
        const next = !pushToTalk();
        setPushToTalk(next);
        send('pushToTalk:toggle', { enabled: next });
      },
    },
    {
      label: 'Thinking',
      icon: null,
      checked: thinkingEnabled(),
      onChange: () => {
        const next = !thinkingEnabled();
        setThinkingEnabled(next);
        send('thinking:toggle', { enabled: next });
      },
    },
    {
      label: 'Tools',
      icon: null,
      checked: true,
      onChange: () => {
        // Toggle tools panel
      },
    },
    {
      label: 'Compact Mode',
      icon: null,
      checked: compactMode(),
      onChange: () => {
        const next = !compactMode();
        setCompactMode(next);
        send('compact:toggle', { enabled: next });
      },
    },
    {
      label: 'Desktop Notifications',
      icon: null,
      checked: notificationsEnabled(),
      onChange: () => {
        const next = !notificationsEnabled();
        setNotificationsEnabled(next);
        send('notifications:toggle', { enabled: next });
      },
    },
  ];

  // Options menu toggle
  const toggleOptionsMenu = () => {
    setOptionsOpen((prev) => !prev);
  };

  return (
    <>
      {/* Desktop Sidebar */}
      <Show when={!isMobile()}>
        <div
          class={cn(
            'flex flex-col h-full border-r border-border/50 bg-surface transition-all duration-300',
            isOpen() ? 'w-72' : 'w-14',
            'hidden lg:flex'
          )}
        >
          {/* Sidebar Header */}
          <div class="flex items-center justify-between px-3 py-2 border-b border-border/50 shrink-0">
            <Show when={isOpen()}>
              <Text weight="semibold" size="sm" class="text-foreground">
                Yuki
              </Text>
            </Show>
            <IconButton
              icon={isOpen() ? 'chevronRight' : 'menu'}
              size="sm"
              tooltip={isOpen() ? 'Collapse sidebar' : 'Expand sidebar'}
              onClick={() => {
                setIsOpen((prev) => !prev);
                onToggleCollapse?.();
              }}
              class="shrink-0"
            />
          </div>

          {/* Sidebar Content */}
          <Show when={isOpen()}>
            <div class="flex-1 overflow-hidden flex flex-col">
              {/* Section tabs */}
              <div class="flex border-b border-border/50">
                <button
                  class={cn(
                    'flex-1 px-3 py-2 text-xs font-medium transition-colors',
                    activeSection() === 'sessions'
                      ? 'text-foreground border-b-2 border-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => setActiveSection('sessions')}
                >
                  Sessions
                </button>
                <button
                  class={cn(
                    'flex-1 px-3 py-2 text-xs font-medium transition-colors',
                    activeSection() === 'projects'
                      ? 'text-foreground border-b-2 border-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => setActiveSection('projects')}
                >
                  Projects
                </button>
              </div>

              {/* Section content */}
              <div class="flex-1 overflow-hidden">
                <Show when={activeSection() === 'sessions'}>
                  <div class="h-full">
                    <SessionTree
                      onSessionSelect={onSessionSelect}
                      onSessionRename={onSessionRename}
                      onSessionDelete={onSessionDelete}
                    />
                  </div>
                </Show>
                <Show when={activeSection() === 'projects'}>
                  <div class="h-full">
                    <ProjectList
                      onProjectSelect={onProjectSelect}
                      onAddProject={onAddProject}
                    />
                  </div>
                </Show>
              </div>
            </div>
          </Show>

          {/* Collapsed icon-only view */}
          <Show when={!isOpen()}>
            <div class="flex flex-col items-center py-2 gap-1">
              <IconButton icon="folder" size="sm" tooltip="Projects" />
              <div class="w-5 border-t border-border/50 my-1" />
              <IconButton
                icon={connectionState().connected ? 'mic' : 'mic-off'}
                size="sm"
                tooltip={voiceMode() ? 'Voice mode on' : 'Voice mode off'}
              />
              <div class="w-5 border-t border-border/50 my-1" />
              <IconButton
                icon="settings"
                size="sm"
                tooltip="Settings"
                onClick={toggleOptionsMenu}
              />
            </div>
          </Show>

          {/* Footer toggles */}
          <Show when={isOpen()}>
            <SidebarFooter />
          </Show>
        </div>
      </Show>

      {/* Mobile Sidebar (drawer) */}
      <Show when={isMobile()}>
        {/* Backdrop */}
        <Show when={mobileOpen()}>
          <div
            class="fixed inset-0 bg-black/60 z-40 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        </Show>

        {/* Drawer */}
        <div
          class={cn(
            'fixed top-0 left-0 bottom-0 z-50 w-72 bg-surface border-r border-border/50 transition-transform duration-300 lg:hidden',
            mobileOpen() ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          {/* Drawer header */}
          <div class="flex items-center justify-between px-3 py-2 border-b border-border/50">
            <Text weight="semibold" size="sm" class="text-foreground">
              Yuki
            </Text>
            <IconButton
              icon="x"
              size="sm"
              tooltip="Close sidebar"
              onClick={() => setMobileOpen(false)}
            />
          </div>

          {/* Drawer content */}
          <div class="flex-1 overflow-hidden flex flex-col">
            {/* Section tabs */}
            <div class="flex border-b border-border/50">
              <button
                class={cn(
                  'flex-1 px-3 py-2 text-xs font-medium transition-colors',
                  activeSection() === 'sessions'
                    ? 'text-foreground border-b-2 border-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                onClick={() => setActiveSection('sessions')}
              >
                Sessions
              </button>
              <button
                class={cn(
                  'flex-1 px-3 py-2 text-xs font-medium transition-colors',
                  activeSection() === 'projects'
                    ? 'text-foreground border-b-2 border-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                onClick={() => setActiveSection('projects')}
              >
                Projects
              </button>
            </div>

            <div class="flex-1 overflow-hidden">
              <Show when={activeSection() === 'sessions'}>
                <SessionTree
                  onSessionSelect={(sessionId, projectId) => {
                    onSessionSelect?.(sessionId, projectId);
                    setMobileOpen(false);
                  }}
                  onSessionRename={onSessionRename}
                  onSessionDelete={onSessionDelete}
                />
              </Show>
              <Show when={activeSection() === 'projects'}>
                <ProjectList
                  onProjectSelect={(projectId) => {
                    onProjectSelect?.(projectId);
                    setMobileOpen(false);
                  }}
                  onAddProject={onAddProject}
                />
              </Show>
            </div>
          </div>

          {/* Footer toggles */}
          <SidebarFooter />
        </div>
      </Show>
    </>
  );
}

function SidebarFooter() {
  const { connectionState, send } = useWebSocket();
  const { voiceMode, voiceListening } = useAudio();

  return (
    <div class="border-t border-border/50 shrink-0">
      {/* Connection status */}
      <div class="flex items-center gap-2 px-3 py-1.5">
        <div class="relative">
          <div
            class={cn(
              'w-2 h-2 rounded-full',
              connectionState().connected ? 'bg-success' : 'bg-danger'
            )}
          />
        </div>
        <Text size="xs" class="text-muted-foreground">
          {connectionState().connected ? 'Connected' : 'Disconnected'}
        </Text>
        <Show when={connectionState().endpoint}>
          <Text
            size="xs"
            class="text-muted-foreground/60 truncate ml-auto"
          >
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

      {/* Voice mode indicator */}
      <Show when={voiceMode()}>
        <div class="flex items-center gap-2 px-3 py-1.5">
          <div class="relative">
            <div class="w-2 h-2 rounded-full bg-[hsl(var(--primary))] animate-pulse" />
          </div>
          <Text size="xs" class="text-muted-foreground">
            {voiceListening() ? 'Listening...' : 'Voice mode'}
          </Text>
        </div>
      </Show>
    </div>
  );
}
