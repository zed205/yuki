'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSession } from '@/context/session-context';
import { useProject } from '@/context/project-context';
import {
  FloatingMenu,
  useMenuDismiss,
  type FloatingMenuItem,
} from '@/components/ui/floating-menu';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DragPayload =
  | { kind: 'session'; sessionId: string; projectId: string }
  | { kind: 'project'; projectId: string };

interface NodeMenuState {
  kind: 'project' | 'session';
  id: string;
  x: number;
  y: number;
}

interface SessionTreeProps {
  onSessionSelect?: (sessionId: string, projectId: string) => void;
  onSessionRename?: (sessionId: string) => void;
  onSessionDelete?: (sessionId: string) => void;
  onProjectNewSession?: (projectId: string) => void;
  onProjectModify?: (projectId: string) => void;
  onProjectDelete?: (projectId: string) => void;
  /** Close the mobile drawer (called after a session is picked). */
  onPicked?: () => void;
}

const OPEN_KEY = 'yukiweb-next-tree-open';
const DND_MIME = 'application/x-yuki-tree';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Unified Project > Session tree (replaces the legacy jsTree).
 * - project nodes: chevron toggle (collapsed by default, persisted), name,
 *   session count, ⋮ menu (New Session / Modify Project / Delete Project)
 * - session nodes: title, optional summary line, message count, ⋮ menu
 *   (Rename / Delete), active row highlighted
 * - HTML5 drag & drop: move a session to another project, reorder projects
 *   (default project is not draggable). Order persists via
 *   PUT /api/projects/reorder, then a tree refresh is requested.
 */
export function SessionTree(props: SessionTreeProps) {
  const { sessions, activeSessionId, moveSession } = useSession();
  const { projects } = useProject();

  const [openProjects, setOpenProjects] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(OPEN_KEY);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch {
      /* ignore */
    }
    return new Set();
  });
  const [menu, setMenu] = useState<NodeMenuState | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dragRef = useRef<DragPayload | null>(null);

  useMenuDismiss(menu !== null, useCallback(() => setMenu(null), []));

  const saveOpen = (next: Set<string>) => {
    setOpenProjects(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  };

  // Keep the active session's project expanded.
  useEffect(() => {
    if (!activeSessionId) return;
    const pid =
      sessions.find((s) => s.id === activeSessionId)?.projectId || 'default';
    setOpenProjects((prev) => {
      if (prev.has(pid)) return prev;
      const next = new Set(prev);
      next.add(pid);
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [activeSessionId, sessions]);

  // Projects in server order, each with its sessions (newest first).
  const groups = useMemo(() => {
    return projects.map((p) => ({
      project: p,
      sessions: sessions
        .filter((s) => (s.projectId || 'default') === p.id)
        .sort((a, b) => {
          const at = typeof a.updatedAt === 'number' ? a.updatedAt : 0;
          const bt = typeof b.updatedAt === 'number' ? b.updatedAt : 0;
          return bt - at;
        }),
    }));
  }, [projects, sessions]);

  // --- Drag & drop ---------------------------------------------------------

  const startDrag = (
    e: React.DragEvent,
    payload: DragPayload,
    draggable: boolean,
  ) => {
    if (!draggable) return;
    dragRef.current = payload;
    e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  };

  const onProjectDrop = (e: React.DragEvent, targetProjectId: string) => {
    e.preventDefault();
    setDropTarget(null);
    let payload: DragPayload | null = dragRef.current;
    dragRef.current = null;
    if (!payload) {
      try {
        payload = JSON.parse(e.dataTransfer.getData(DND_MIME) || 'null');
      } catch {
        return;
      }
    }
    if (!payload) return;
    if (payload.kind === 'session') {
      if (payload.projectId !== targetProjectId) {
        moveSession(payload.sessionId, targetProjectId);
      }
    } else if (payload.kind === 'project') {
      if (payload.projectId === targetProjectId) return;
      // Insert the dragged project before the target in the current order.
      const ids = projects.map((p) => p.id).filter((id) => id !== payload.projectId);
      const targetIdx = ids.indexOf(targetProjectId);
      if (targetIdx === -1) return;
      ids.splice(targetIdx, 0, payload.projectId);
      fetch('/api/projects/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
        .catch(() => {})
        .finally(() => {
          window.dispatchEvent(new CustomEvent('yukiweb:refresh-tree'));
        });
    }
  };

  const onDragLeave = (e: React.DragEvent) => {
    // Only clear when leaving the element itself (not entering a child).
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDropTarget((t) => (t === null ? t : null));
  };

  // --- Node menus ----------------------------------------------------------

  const openMenu = (kind: 'project' | 'session', id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ kind, id, x: e.clientX, y: e.clientY });
  };

  let menuItems: FloatingMenuItem[] = [];
  if (menu) {
    if (menu.kind === 'project') {
      menuItems = [
        {
          label: 'New Session',
          onClick: () => props.onProjectNewSession?.(menu.id),
        },
        {
          label: 'Modify Project',
          onClick: () => props.onProjectModify?.(menu.id),
        },
      ];
      if (menu.id !== 'default') {
        menuItems.push({
          label: 'Delete Project',
          danger: true,
          onClick: () => props.onProjectDelete?.(menu.id),
        });
      }
    } else {
      menuItems = [
        {
          label: 'Rename',
          onClick: () => props.onSessionRename?.(menu.id),
        },
        {
          label: 'Delete',
          danger: true,
          onClick: () => props.onSessionDelete?.(menu.id),
        },
      ];
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">No projects yet</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              Use “New” to add a project
            </p>
          </div>
        ) : (
          groups.map(({ project, sessions: projectSessions }) => {
            const isOpen = openProjects.has(project.id);
            const draggable = project.id !== 'default';
            return (
              <div key={project.id}>
                {/* Project node */}
                <div
                  className={cn(
                    'group relative flex min-h-[30px] cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/40',
                    dropTarget === project.id && 'bg-primary/10 ring-1 ring-inset ring-primary/40',
                  )}
                  draggable={draggable}
                  onDragStart={(e) =>
                    startDrag(e, { kind: 'project', projectId: project.id }, draggable)
                  }
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDropTarget(project.id);
                  }}
                  onDragLeave={onDragLeave}
                  onDrop={(e) => onProjectDrop(e, project.id)}
                  onClick={() => {
                    const next = new Set(openProjects);
                    if (isOpen) next.delete(project.id);
                    else next.add(project.id);
                    saveOpen(next);
                  }}
                >
                  <ChevronRight
                    size={14}
                    className={cn(
                      'shrink-0 text-muted-foreground transition-transform duration-150',
                      isOpen && 'rotate-45',
                    )}
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-sm font-normal"
                    title={project.name}
                  >
                    {project.name}
                  </span>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {projectSessions.length}
                  </span>
                  <button
                    type="button"
                    className="absolute right-1 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded bg-background text-sm leading-none opacity-0 transition-opacity group-hover:opacity-100 hover:bg-foreground hover:text-background"
                    onClick={(e) => openMenu('project', project.id, e)}
                    onMouseDown={(e) => e.stopPropagation()}
                    title={project.name}
                  >
                    •••
                  </button>
                </div>

                {/* Session children */}
                {isOpen &&
                  projectSessions.map((s) => {
                    const title = s.title || `${s.messageCount ?? 0} messages`;
                    const isActive = s.id === activeSessionId;
                    return (
                      <div
                        key={s.id}
                        className={cn(
                          'group relative flex min-h-[30px] cursor-pointer items-start gap-1 rounded-md py-1 pl-6 pr-1 transition-colors hover:bg-muted/40',
                          isActive &&
                            'bg-muted/50 shadow-[inset_0_0_0_1px_rgba(88,166,255,0.3)]',
                        )}
                        draggable
                        onDragStart={(e) =>
                          startDrag(
                            e,
                            {
                              kind: 'session',
                              sessionId: s.id,
                              projectId: s.projectId || project.id,
                            },
                            true,
                          )
                        }
                        onClick={() => {
                          if (!isActive) {
                            props.onSessionSelect?.(s.id, s.projectId || project.id);
                            props.onPicked?.();
                          }
                        }}
                      >
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              'block truncate text-sm',
                              isActive ? 'text-primary' : 'text-foreground',
                            )}
                            title={title}
                          >
                            {title}
                          </span>
                          {s.summary && (
                            <span className="mt-px block truncate text-[11px] leading-tight text-muted-foreground/70">
                              {s.summary}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-sm text-muted-foreground">
                          {s.messageCount ?? 0}
                        </span>
                        <button
                          type="button"
                          className="absolute right-1 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded bg-background text-sm leading-none opacity-0 transition-opacity group-hover:opacity-100 hover:bg-foreground hover:text-background"
                          onClick={(e) => openMenu('session', s.id, e)}
                          onMouseDown={(e) => e.stopPropagation()}
                          title={title}
                        >
                          •••
                        </button>
                      </div>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>

      {/* Node context menu */}
      <FloatingMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menuItems}
        onClose={() => setMenu(null)}
      />
    </div>
  );
}
