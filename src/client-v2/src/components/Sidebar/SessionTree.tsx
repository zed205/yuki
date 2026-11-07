import { createSignal, For, Show, createEffect, type JSX } from 'solid-js';
import { IconButton } from '../ui/IconButton';
import { Text } from '../ui/Box';
import { cn } from '../../lib/utils';
import { useSession } from '../../context/SessionContext';
import { useWebSocket } from '../../context/WebSocketContext';

interface SessionTreeProps {
  onSessionSelect?: (sessionId: string, projectId: string) => void;
  onSessionRename?: (sessionId: string) => void;
  onSessionDelete?: (sessionId: string) => void;
  className?: string;
}

export interface SessionItem {
  id: string;
  title: string;
  projectId: string;
  updatedAt: string;
  thinkingEnabled?: boolean;
}

interface SessionGroup {
  projectId: string;
  projectName: string;
  sessions: SessionItem[];
  expanded: boolean;
}

export function SessionTree(props: SessionTreeProps) {
  const { onSessionSelect, onSessionRename, onSessionDelete, className } = props;
  const { sessions } = useSession();
  const { send, messageRouter } = useWebSocket();

  const [activeSessionId, setActiveSessionId] = createSignal<string | null>(null);

  // Keep active session in sync with server
  createEffect(() => {
    const unsubSwitched = messageRouter.on('session:switched', (data: unknown) => {
      const sd = data as { sessionId: string };
      if (sd.sessionId) {
        setActiveSessionId(sd.sessionId);
      }
    });
    const unsubConnected = messageRouter.on('session:connected', (data: unknown) => {
      const sd = data as { sessionId: string };
      if (sd.sessionId) {
        setActiveSessionId(sd.sessionId);
      }
    });
    return () => { unsubSwitched(); unsubConnected(); };
  });

  // Group sessions by project
  const sessionGroups = (): SessionGroup[] => {
    const allSessions = sessions();
    const groups: SessionGroup[] = [];
    const projectMap = new Map<string, SessionItem[]>();

    allSessions.forEach((s) => {
      if (!projectMap.has(s.projectId)) {
        projectMap.set(s.projectId, []);
      }
      projectMap.get(s.projectId)!.push({
        id: s.id,
        title: s.title,
        projectId: s.projectId,
        updatedAt: new Date(s.updatedAt).toISOString(),
        thinkingEnabled: s.thinkingEnabled,
      });
    });

    projectMap.forEach((groupSessions, projectId) => {
      groups.push({
        projectId,
        projectName: projectId,
        sessions: groupSessions.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        ),
        expanded: true,
      });
    });

    return groups;
  };

  const groupSessions = sessionGroups();

  const toggleGroup = (groupId: string) => {
    // In a real app, this would toggle expansion state
  };

  const truncateTitle = (title: string, maxLen = 30) => {
    if (title.length <= maxLen) return title;
    return title.slice(0, maxLen - 1) + '\u2026';
  };

  return (
    <div class={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div class="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <Text variant="muted" size="xs" weight="semibold" class="uppercase tracking-wider">
          Sessions
        </Text>
        <IconButton
          icon="plus"
          size="sm"
          tooltip="New session"
          onClick={() => {
            send('session:create', {});
          }}
        />
      </div>

      {/* Session List */}
      <div class="flex-1 overflow-y-auto py-1">
        <For each={groupSessions}>
          {(group) => (
            <div class="mb-1">
              {/* Group header */}
              <button
                class="flex items-center gap-1.5 w-full px-3 py-1 text-left hover:bg-surface2/50 transition-colors text-muted-foreground hover:text-foreground"
                onClick={() => toggleGroup(group.projectId)}
              >
                <IconButton
                  icon={group.expanded ? 'chevronDown' : 'chevronRight'}
                  size="sm"
                  class="!h-5 !w-5"
                />
                <Text size="xs" weight="medium" class="truncate">
                  {group.projectName}
                </Text>
                <Text size="xs" class="text-muted-foreground ml-auto">
                  {group.sessions.length}
                </Text>
              </button>

              {/* Session items */}
              {group.expanded && (
                <div class="ml-2 border-l border-border/30 pl-1">
                  <For each={group.sessions}>
                    {(session) => (
                      <SessionItem
                        session={session}
                        isActive={activeSessionId() === session.id}
                        onSelect={() => {
                          onSessionSelect?.(session.id, session.projectId);
                          setActiveSessionId(session.id);
                        }}
                        onRename={() => onSessionRename?.(session.id)}
                        onDelete={() => onSessionDelete?.(session.id)}
                      />
                    )}
                  </For>
                </div>
              )}
            </div>
          )}
        </For>

        {/* Empty state */}
        {groupSessions.length === 0 && (
          <div class="flex flex-col items-center justify-center py-8 px-4 text-center">
            <Text variant="muted" size="sm">
              No sessions yet
            </Text>
            <Text size="xs" class="text-muted-foreground mt-1">
              Start a new conversation
            </Text>
          </div>
        )}
      </div>
    </div>
  );
}

function SessionItem(props: {
  session: SessionItem;
  isActive: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { session, isActive, onSelect, onRename, onDelete } = props;
  const [hovered, setHovered] = createSignal(false);

  return (
    <div
      class={cn(
        'group relative flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors',
        'border-l-2 border-transparent',
        isActive
          ? 'bg-surface2 border-primary/50 text-foreground'
          : 'text-muted-foreground hover:bg-surface2/50 hover:text-foreground hover:border-border',
        'rounded-r-sm'
      )}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5">
          <Text size="xs" truncate class="truncate">
            {session.title}
          </Text>
          {session.thinkingEnabled && (
            <Text size="xs" variant="primary">
              🧠
            </Text>
          )}
        </div>
        <Text
          size="xs"
          class="text-muted-foreground/60 mt-0.5"
        >
          {formatRelativeTime(session.updatedAt)}
        </Text>
      </div>

      {/* Hover actions */}
      <Show when={hovered() && !isActive}>
        <div class="flex items-center gap-0.5 absolute right-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <IconButton
            icon="edit"
            size="sm"
            tooltip="Rename"
            onClick={(e) => {
              e.stopPropagation();
              onRename();
            }}
          />
          <IconButton
            icon="trash"
            size="sm"
            tooltip="Delete"
            class="hover:!text-red-400"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          />
        </div>
      </Show>
    </div>
  );
}

function formatRelativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  return `${diffHours}h ago`;
}
