'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAudio } from '@/context/audio-context';
import { useSession } from '@/context/session-context';
import { useWebSocket } from '@/context/websocket-context';
import { SessionTree } from './session-tree';
import { ProjectList } from './project-list';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/box';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';

interface SidebarProps {
  onSessionSelect?: (sessionId: string, projectId: string) => void;
  onSessionRename?: (sessionId: string) => void;
  onSessionDelete?: (sessionId: string) => void;
  onProjectSelect?: (projectId: string) => void;
  onAddProject?: () => void;
  onToggleCollapse?: () => void;
  onOpenSettings?: () => void;
}

type Section = 'sessions' | 'projects';

function SidebarFooter() {
  const { connectionState, endpoint } = useWebSocket();
  const { voiceMode, voiceListening } = useAudio();
  const [mounted, setMounted] = useState(false);

  // The endpoint is derived from window on the client; SSR has none. Gate the
  // hostname so the client's initial paint matches the server HTML.
  useEffect(() => setMounted(true), []);

  const hostname = mounted
    ? (() => {
        if (!endpoint) return null;
        try {
          return new URL(endpoint).hostname;
        } catch {
          return endpoint;
        }
      })()
    : null;

  return (
    <div className="shrink-0 border-t border-border/50">
      {/* Connection status */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <div
          className={cn(
            'h-2 w-2 rounded-full',
            connectionState === 'connected' ? 'bg-green-500' : 'bg-red-500',
          )}
        />
        <Text size="xs" className="text-muted-foreground">
          {connectionState === 'connected' ? 'Connected' : 'Disconnected'}
        </Text>
        {hostname && (
          <Text size="xs" className="ml-auto truncate text-muted-foreground/60">
            {hostname}
          </Text>
        )}
      </div>

      {/* Voice mode indicator */}
      {voiceMode && (
        <div className="flex items-center gap-2 px-3 py-1.5">
          <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
          <Text size="xs" className="text-muted-foreground">
            {voiceListening ? 'Listening...' : 'Voice mode'}
          </Text>
        </div>
      )}
    </div>
  );
}

function SectionTabs({
  activeSection,
  onSectionChange,
}: {
  activeSection: Section;
  onSectionChange: (s: Section) => void;
}) {
  return (
    <div className="flex border-b border-border/50">
      {(['sessions', 'projects'] as const).map((section) => (
        <button
          key={section}
          className={cn(
            'flex-1 px-3 py-2 text-xs font-medium capitalize transition-colors',
            activeSection === section
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => onSectionChange(section)}
        >
          {section}
        </button>
      ))}
    </div>
  );
}

function SectionContent(props: {
  activeSection: Section;
  onSessionSelect?: (sessionId: string, projectId: string) => void;
  onSessionRename?: (sessionId: string) => void;
  onSessionDelete?: (sessionId: string) => void;
  onProjectSelect?: (projectId: string) => void;
  onAddProject?: () => void;
  closeMobile?: () => void;
}) {
  const { activeSection, closeMobile, ...rest } = props;
  if (activeSection === 'sessions') {
    return (
      <div className="h-full">
        <SessionTree
          {...rest}
          onSessionSelect={(sid, pid) => {
            rest.onSessionSelect?.(sid, pid);
            closeMobile?.();
          }}
        />
      </div>
    );
  }
  return (
    <div className="h-full">
      <ProjectList
        onProjectSelect={(pid) => {
          rest.onProjectSelect?.(pid);
          closeMobile?.();
        }}
        onAddProject={rest.onAddProject}
      />
    </div>
  );
}

export function Sidebar(props: SidebarProps) {
  const {
    onSessionSelect,
    onSessionRename,
    onSessionDelete,
    onProjectSelect,
    onAddProject,
    onToggleCollapse,
    onOpenSettings,
  } = props;

  const [isOpen, setIsOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>('sessions');

  const {
    voiceMode,
    setVoiceMode,
    micEnabled,
    setMic,
    ttsEnabled,
    setTts,
    pushToTalk,
    setPushToTalk,
    voiceListening,
  } = useAudio();
  const {
    thinkingEnabled,
    setThinkingEnabled,
    compactMode,
    setCompactMode,
    notificationsEnabled,
    setNotificationsEnabled,
  } = useSession();
  const { connectionState, send } = useWebSocket();

  // Responsive: on mobile the sidebar starts closed
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      if (mobile) {
        setIsOpen(false);
        setMobileOpen(false);
      } else {
        setIsOpen(true);
      }
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const options: Array<{
    label: string;
    checked: boolean;
    onChange: () => void;
  }> = [
    {
      label: 'Voice Mode',
      checked: voiceMode,
      onChange: () => {
        const next = !voiceMode;
        setVoiceMode(next);
        send('voice:toggle', { enabled: next });
      },
    },
    {
      label: 'Microphone',
      checked: micEnabled,
      onChange: () => {
        const next = !micEnabled;
        setMic(next);
        send('mic:toggle', { enabled: next });
      },
    },
    {
      label: 'Text-to-Speech',
      checked: ttsEnabled,
      onChange: () => {
        const next = !ttsEnabled;
        setTts(next);
        send('tts:toggle', { enabled: next });
      },
    },
    {
      label: 'Push-to-Talk',
      checked: pushToTalk,
      onChange: () => {
        const next = !pushToTalk;
        setPushToTalk(next);
        send('pushToTalk:toggle', { enabled: next });
      },
    },
    {
      label: 'Thinking',
      checked: thinkingEnabled,
      onChange: () => {
        const next = !thinkingEnabled;
        setThinkingEnabled(next);
        send('thinking:toggle', { enabled: next });
      },
    },
    {
      label: 'Compact Mode',
      checked: compactMode,
      onChange: () => {
        const next = !compactMode;
        setCompactMode(next);
        send('compact:toggle', { enabled: next });
      },
    },
    {
      label: 'Desktop Notifications',
      checked: notificationsEnabled,
      onChange: () => {
        const next = !notificationsEnabled;
        setNotificationsEnabled(next);
        send('notifications:toggle', { enabled: next });
      },
    },
  ];

  const sectionContent = (closeMobile?: () => void) => (
    <SectionContent
      activeSection={activeSection}
      onSessionSelect={onSessionSelect}
      onSessionRename={onSessionRename}
      onSessionDelete={onSessionDelete}
      onProjectSelect={onProjectSelect}
      onAddProject={onAddProject}
      closeMobile={closeMobile}
    />
  );

  const optionsMenu = (
    <Popover open={optionsOpen} onOpenChange={setOptionsOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.08.15a2 2 0 0 1 0 2l-.25.43a2 2 0 0 1-1.73 1H5a2 2 0 0 0-2 2v.44a2 2 0 0 0 2 2h.18a2 2 0 0 1 1.73 1l.25.43a2 2 0 0 1 0 2l.08.15a2 2 0 0 0 .73 2.73l.38.22a2 2 0 0 0 2.73-.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V21a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.08-.15a2 2 0 0 1 0-2l.25-.43a2 2 0 0 1 1.73-1H21a2 2 0 0 0 2-2v-.44a2 2 0 0 0-2-2h-.18a2 2 0 0 1-1.73-1l-.25-.43a2 2 0 0 1 0-2l-.08-.15a2 2 0 0 0-.73-2.73l-.38-.22a2 2 0 0 0-2.73.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56">
        <div className="flex flex-col gap-1">
          {options.map((opt) => (
            <div key={opt.label} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
              <Text size="sm">{opt.label}</Text>
              <Switch checked={opt.checked} onCheckedChange={opt.onChange} />
            </div>
          ))}
          <div className="mt-1 border-t border-border/50 pt-1">
            <button
              className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50"
              onClick={() => {
                setOptionsOpen(false);
                onOpenSettings?.();
              }}
            >
              <Text size="sm">Open Settings…</Text>
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );

  if (isMobile) {
    // --- Mobile drawer ---
    return (
      <>
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}
        <div
          className={cn(
            'fixed bottom-0 left-0 top-0 z-50 flex w-72 -translate-x-full flex-col border-r border-border/50 bg-background transition-transform duration-300 lg:hidden',
            mobileOpen && 'translate-x-0',
          )}
        >
          <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
            <Text weight="semibold" size="sm" className="text-foreground">
              Yuki
            </Text>
            <IconButton
              icon="x"
              size="sm"
              tooltip="Close sidebar"
              onClick={() => setMobileOpen(false)}
            />
          </div>
          <div className="flex flex-1 flex-col overflow-hidden">
            <SectionTabs activeSection={activeSection} onSectionChange={setActiveSection} />
            <div className="flex-1 overflow-hidden">{sectionContent(() => setMobileOpen(false))}</div>
          </div>
          <SidebarFooter />
        </div>
      </>
    );
  }

  // --- Desktop sidebar ---
  return (
    <div
      className={cn(
        'hidden h-full flex-col border-r border-border/50 bg-background transition-all duration-300 lg:flex',
        isOpen ? 'w-72' : 'w-14',
      )}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/50 px-3 py-2">
        {isOpen && (
          <div className="flex items-center gap-2">
            <Text weight="semibold" size="sm" className="text-foreground">
              Yuki
            </Text>
            {optionsMenu}
          </div>
        )}
        <IconButton
          icon={isOpen ? 'chevron-right' : 'menu'}
          size="sm"
          tooltip={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          onClick={() => {
            setIsOpen((prev) => !prev);
            onToggleCollapse?.();
          }}
          className="shrink-0"
        />
      </div>

      {isOpen ? (
        <>
          <div className="flex flex-1 flex-col overflow-hidden">
            <SectionTabs activeSection={activeSection} onSectionChange={setActiveSection} />
            <div className="flex-1 overflow-hidden">{sectionContent()}</div>
          </div>
          <SidebarFooter />
        </>
      ) : (
        <div className="flex flex-col items-center gap-1 py-2">
          <IconButton icon="folder" size="sm" tooltip="Projects" />
          <div className="my-1 w-5 border-t border-border/50" />
          <IconButton
            icon={connectionState === 'connected' ? 'mic' : 'mic-off'}
            size="sm"
            tooltip={voiceMode ? 'Voice mode on' : 'Voice mode off'}
          />
          <div className="my-1 w-5 border-t border-border/50" />
          <IconButton icon="settings" size="sm" tooltip="Settings" onClick={() => onOpenSettings?.()} />
        </div>
      )}
    </div>
  );
}
