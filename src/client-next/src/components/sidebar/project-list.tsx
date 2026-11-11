'use client';

import { useEffect, useState } from 'react';
import { Folder } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProject } from '@/context/project-context';
import { useWebSocket } from '@/context/websocket-context';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/box';
import { RenameModal } from '@/components/modals/rename-modal';
import { ConfirmModal } from '@/components/modals/confirm-modal';
import type { Project } from '@/lib/types';

interface ProjectListProps {
  onProjectSelect?: (projectId: string) => void;
  onAddProject?: () => void;
  className?: string;
}

function formatSessionCount(count: number): string {
  if (count === 0) return '0 sessions';
  if (count === 1) return '1 session';
  return `${count} sessions`;
}

function ProjectItemRow({
  project,
  isActive,
  onSelect,
  onRename,
  onDelete,
}: {
  project: Project;
  isActive: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const sessionCount = (project.sessions as string[] | undefined)?.length ?? 0;

  return (
    <div
      className={cn(
        'group relative mx-1 my-0.5 flex cursor-pointer items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-sm transition-all',
        isActive
          ? 'border-primary/30 bg-muted/80'
          : 'hover:border-border/50 hover:bg-muted/50',
      )}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Project icon */}
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
          isActive
            ? 'bg-primary/20 text-primary'
            : 'bg-muted/80 text-muted-foreground group-hover:text-foreground',
        )}
      >
        <Folder size={16} className={isActive ? 'text-primary' : undefined} />
      </div>

      {/* Project info */}
      <div className="min-w-0 flex-1">
        <Text
          size="sm"
          weight="medium"
          truncate
          className={cn(
            isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground',
          )}
        >
          {project.name}
        </Text>
        <Text size="xs" className={cn('mt-0.5', isActive ? 'text-muted-foreground' : 'text-muted-foreground/60')}>
          {formatSessionCount(sessionCount)}
        </Text>
      </div>

      {/* Hover actions */}
      {hovered && (
        <div className="absolute right-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <IconButton
            icon="edit"
            size="sm"
            tooltip="Rename"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              onRename();
            }}
          />
          <IconButton
            icon="trash"
            size="sm"
            tooltip="Delete"
            className="h-6 w-6 hover:text-red-400"
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

export function ProjectList({ onProjectSelect, onAddProject, className }: ProjectListProps) {
  const {
    projects,
    currentProjectId,
    setCurrentProject,
    removeProject,
    renameProject,
  } = useProject();
  const [activeProjectId, setActiveProjectId] = useState(currentProjectId);

  // Keep active project in sync with context value
  useEffect(() => {
    setActiveProjectId(currentProjectId);
  }, [currentProjectId]);

  const handleSelect = (id: string) => {
    setActiveProjectId(id);
    void setCurrentProject(id).catch(() => {
      /* toast in provider later */
    });
    onProjectSelect?.(id);
  };

  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  const handleRename = (p: Project) => {
    setRenameTarget(p);
  };

  const handleDelete = (p: Project) => {
    if (p.id !== 'default') setDeleteTarget(p);
  };

  const list: Project[] =
    projects.length === 0
      ? [{ id: 'default', name: 'Default', path: '~', sessions: [] }]
      : projects;

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <Text variant="muted" size="xs" weight="semibold" className="uppercase tracking-wider">
          Projects
        </Text>
        <IconButton
          icon="plus"
          size="sm"
          tooltip="Add project"
          onClick={() => onAddProject?.()}
        />
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto py-1">
        {list.map((project) => (
          <ProjectItemRow
            key={project.id}
            project={project}
            isActive={activeProjectId === project.id}
            onSelect={() => handleSelect(project.id)}
            onRename={() => handleRename(project)}
            onDelete={() => handleDelete(project)}
          />
        ))}
      </div>

      {/* Rename project */}
      <RenameModal
        open={renameTarget !== null}
        onOpenChange={(open) => { if (!open) setRenameTarget(null); }}
        title="Rename project"
        currentValue={renameTarget?.name}
        placeholder="Project name"
        onSave={(name) => {
          if (renameTarget) void renameProject(renameTarget.id, name).catch(() => {});
          setRenameTarget(null);
        }}
      />

      {/* Delete project confirm */}
      <ConfirmModal
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete project"
        message={deleteTarget ? `Delete project “${deleteTarget.name}”?` : ''}
        confirmText="Delete"
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) void removeProject(deleteTarget.id).catch(() => {});
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
