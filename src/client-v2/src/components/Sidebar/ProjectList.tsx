import { createSignal, For, Show, createEffect } from 'solid-js';
import { IconButton } from '../ui/IconButton';
import { Text } from '../ui/Box';
import { cn } from '../../lib/utils';
import { useProject } from '../../context/ProjectContext';
import { useWebSocket } from '../../context/WebSocketContext';

interface ProjectListProps {
  onProjectSelect?: (projectId: string) => void;
  onAddProject?: () => void;
  className?: string;
}

export interface ProjectItem {
  id: string;
  name: string;
  path?: string;
  sessions: string[];
}

export function ProjectList(props: ProjectListProps) {
  const { onProjectSelect, onAddProject, className } = props;
  const { projects, currentProjectId, removeProject, renameProject } = useProject();
  const { messageRouter } = useWebSocket();

  const [activeProjectId, setActiveProjectId] = createSignal(currentProjectId());

  // Keep active project in sync
  createEffect(() => {
    const unsubSwitched = messageRouter.on('project:switched', (data: unknown) => {
      const pd = data as { projectId: string };
      if (pd.projectId) {
        setActiveProjectId(pd.projectId);
      }
    });
    const unsubConnected = messageRouter.on('session:connected', (data: unknown) => {
      const sd = data as { activeProjectId: string };
      if (sd.activeProjectId) {
        setActiveProjectId(sd.activeProjectId);
      }
    });
    return () => { unsubSwitched(); unsubConnected(); };
  });

  // Default project if none exist
  const allProjects = (): ProjectItem[] => {
    const list = projects();
    if (list.length === 0) {
      return [
        {
          id: 'default',
          name: 'Default',
          path: '~',
          sessions: [],
        },
      ];
    }
    return list.map((p) => ({
      id: p.id,
      name: p.name,
      path: p.path,
      sessions: p.sessions || [],
    }));
  };

  return (
    <div class={cn('flex flex-col', className)}>
      {/* Header */}
      <div class="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <Text variant="muted" size="xs" weight="semibold" class="uppercase tracking-wider">
          Projects
        </Text>
        <IconButton
          icon="plus"
          size="sm"
          tooltip="Add project"
          onClick={() => onAddProject?.()}
        />
      </div>

      {/* Project List */}
      <div class="flex-1 overflow-y-auto py-1">
        <For each={allProjects()}>
          {(project) => (
            <ProjectItemComponent
              project={project}
              isActive={activeProjectId() === project.id}
              onSelect={() => onProjectSelect?.(project.id)}
              onRename={() => {
                const name = prompt('Rename project:', project.name);
                if (name && name.trim()) {
                  renameProject(project.id, name.trim());
                }
              }}
              onDelete={() => {
                if (project.id !== 'default' && confirm(`Delete project "${project.name}"?`)) {
                  removeProject(project.id);
                }
              }}
            />
          )}
        </For>
      </div>
    </div>
  );
}

function ProjectItemComponent(props: {
  project: ProjectItem;
  isActive: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { project, isActive, onSelect, onRename, onDelete } = props;
  const [hovered, setHovered] = createSignal(false);

  return (
    <div
      class={cn(
        'group relative flex items-center gap-2 mx-1 my-0.5 px-3 py-2 cursor-pointer rounded-lg transition-all',
        'border border-transparent',
        isActive
          ? 'bg-surface2/80 border-primary/30'
          : 'hover:bg-surface2/50 hover:border-border/50',
        'text-sm'
      )}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Project icon */}
      <div
        class={cn(
          'flex items-center justify-center w-7 h-7 rounded-md shrink-0',
          isActive
            ? 'bg-primary/20 text-primary'
            : 'bg-surface2/80 text-muted-foreground group-hover:text-foreground'
        )}
      >
        <FolderIcon isActive={isActive} />
      </div>

      {/* Project info */}
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5">
          <Text
            size="sm"
            weight="medium"
            truncate
            class={cn(
              'truncate',
              isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
            )}
          >
            {project.name}
          </Text>
        </div>
        <Text
          size="xs"
          class={cn(
            'mt-0.5',
            isActive
              ? 'text-muted-foreground'
              : 'text-muted-foreground/60'
          )}
        >
          {formatSessionCount(project.sessions.length)}
        </Text>
      </div>

      {/* Hover actions */}
      <Show when={hovered()}>
        <div class="flex items-center gap-0.5 absolute right-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <IconButton
            icon="edit"
            size="sm"
            tooltip="Rename"
            class="!h-6 !w-6"
            onClick={(e) => {
              e.stopPropagation();
              onRename();
            }}
          />
          <IconButton
            icon="trash"
            size="sm"
            tooltip="Delete"
            class="!h-6 !w-6 hover:!text-red-400"
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

function FolderIcon(props: { isActive: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={props.isActive ? 'text-primary' : ''}
    >
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 2H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

function formatSessionCount(count: number): string {
  if (count === 0) return '0 sessions';
  if (count === 1) return '1 session';
  return `${count} sessions`;
}
