'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useSession } from '@/context/session-context';
import { useProject } from '@/context/project-context';
import { useWebSocket } from '@/context/websocket-context';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/box';

interface SessionTreeProps {
  onSessionSelect?: (sessionId: string, projectId: string) => void;
  onSessionRename?: (sessionId: string) => void;
  onSessionDelete?: (sessionId: string) => void;
  className?: string;
}

interface SessionItem {
  id: string;
  title: string;
  projectId: string;
  updatedAt: number;
  thinkingEnabled?: boolean;
}

interface SessionGroup {
  projectId: string;
  projectName: string;
  sessions: SessionItem[];
}

function formatRelativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

export function SessionTree({
  onSessionSelect,
  onSessionRename,
  onSessionDelete,
  className,
}: SessionTreeProps) {
  const { sessions, activeSessionId, setActiveSessionId } = useSession();
  const { projects } = useProject();
  const { send } = useWebSocket();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups: SessionGroup[] = useMemo(() => {
    const projectMap = new Map<string, SessionItem[]>();
    for (const s of sessions) {
      const pid = s.projectId || 'default';
      if (!projectMap.has(pid)) projectMap.set(pid, []);
      projectMap.get(pid)!.push({
        id: s.id,
        title: s.title || 'New session',
        projectId: pid,
        updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : new Date(s.updatedAt).getTime(),
        thinkingEnabled: s.thinkingEnabled,
      });
    }
    const nameById = new Map(projects.map((p) => [p.id, p.name]));
    const result: SessionGroup[] = [];
    for (const [projectId, groupSessions] of projectMap) {
      result.push({
        projectId,
        projectName:
          nameById.get(projectId) ||
          (projectId === 'default' ? 'Default' : projectId),
        sessions: groupSessions.sort((a, b) => b.updatedAt - a.updatedAt),
      });
    }
    return result;
  }, [sessions, projects]);

  const toggleGroup = (projectId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <Text variant="muted" size="xs" weight="semibold" className="uppercase tracking-wider">
          Sessions
        </Text>
        <IconButton
          icon="plus"
          size="sm"
          tooltip="New session"
          onClick={() => send('session:create', {})}
        />
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto py-1">
        {groups.map((group) => {
          const isExpanded = !collapsed.has(group.projectId);
          return (
            <div key={group.projectId} className="mb-1">
              <button
                className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                onClick={() => toggleGroup(group.projectId)}
              >
                <IconButton
                  icon={isExpanded ? 'chevron-down' : 'chevron-right'}
                  size="sm"
                  className="h-5 w-5"
                />
                <Text size="xs" weight="medium" className="truncate">
                  {group.projectName}
                </Text>
                <Text size="xs" className="ml-auto text-muted-foreground">
                  {group.sessions.length}
                </Text>
              </button>

              {isExpanded && (
                <div className="ml-2 border-l pl-1 border-border/30">
                  {group.sessions.map((session) => (
                    <SessionItemRow
                      key={session.id}
                      session={session}
                      isActive={activeSessionId === session.id}
                      onSelect={() => {
                        setActiveSessionId(session.id);
                        onSessionSelect?.(session.id, session.projectId);
                      }}
                      onRename={() => onSessionRename?.(session.id)}
                      onDelete={() => onSessionDelete?.(session.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {groups.length === 0 && (
          <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
            <Text variant="muted" size="sm">
              No sessions yet
            </Text>
            <Text size="xs" className="mt-1 text-muted-foreground">
              Start a new conversation
            </Text>
          </div>
        )}
      </div>
    </div>
  );
}

function SessionItemRow({
  session,
  isActive,
  onSelect,
  onRename,
  onDelete,
}: {
  session: SessionItem;
  isActive: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        'group relative flex cursor-pointer items-center gap-2 rounded-r-sm border-l-2 border-transparent px-3 py-1.5 transition-colors',
        isActive
          ? 'border-primary/50 bg-muted text-foreground'
          : 'text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground',
      )}
      onClick={onSelect}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Text size="xs" truncate>
            {session.title}
          </Text>
          {session.thinkingEnabled && (
            <Text size="xs" variant="primary">
              🧠
            </Text>
          )}
        </div>
        <Text size="xs" className="mt-0.5 text-muted-foreground/60">
          {formatRelativeTime(session.updatedAt)}
        </Text>
      </div>

      {/* Hover actions */}
      {!isActive && (
        <div className="absolute right-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
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
            className="hover:text-red-400"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          />
        </div>
      )}
    </div>
  );
}
