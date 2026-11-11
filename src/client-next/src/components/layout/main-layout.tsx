'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSession } from '@/context/session-context';
import { useProject } from '@/context/project-context';
import { useWebSocket } from '@/context/websocket-context';
import { Sidebar } from '@/components/sidebar/sidebar';
import { ChatPanel } from '@/components/chat/chat-panel';
import { SettingsModal } from '@/components/settings/settings-modal';
import { VoicePanel } from '@/components/voice/voice-panel';
import { BrowserView } from '@/components/browser/browser-view';
import { SessionSync } from '@/components/session-sync';
import { RenameModal } from '@/components/modals/rename-modal';
import { ConfirmModal } from '@/components/modals/confirm-modal';
import { SearchModal } from '@/components/modals/search-modal';
import { AddProjectModal } from '@/components/modals/add-project-modal';
import { useGlobalShortcuts } from '@/hooks/use-global-shortcuts';
import { useBrowser } from '@/context/browser-context';

// ---------------------------------------------------------------------------
// Mobile top bar (legacy `#top-bar`): hamburger + logo + context ring
// ---------------------------------------------------------------------------

function MobileTopBar({ onMenu }: { onMenu: () => void }) {
  const { promptTokens, maxTokens } = useSession();
  const pct =
    maxTokens > 0 ? Math.min(100, Math.round((promptTokens / maxTokens) * 100)) : 0;
  const color = pct > 90 ? '#f85149' : pct > 70 ? '#f0883e' : '#58a6ff';

  return (
    <div className="fixed top-0 left-0 right-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-card px-3 md:hidden">
      <button
        type="button"
        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="Menu"
        onClick={onMenu}
      >
        <Menu size={20} />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#d4760a] text-xs font-bold text-white">
          Y
        </div>
        <span className="truncate font-bold">Yuki</span>
      </div>

      {/* Context usage circle */}
      <div
        className="relative flex h-8 w-8 shrink-0 items-center justify-center"
        title="Context usage"
      >
        <svg viewBox="0 0 36 36" className="h-8 w-8 -rotate-90">
          <circle
            cx="18"
            cy="18"
            r="15.915"
            fill="none"
            stroke="var(--color-muted)"
            strokeWidth="3"
          />
          <circle
            cx="18"
            cy="18"
            r="15.915"
            fill="none"
            stroke={color}
            strokeWidth="3"
            strokeDasharray={`${pct} 100`}
            strokeLinecap="round"
          />
        </svg>
        <span className="absolute text-[8px] font-medium text-muted-foreground">
          {pct}%
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main layout
// ---------------------------------------------------------------------------

export function MainLayout({ className }: { className?: string }) {
  const { sessions, switchSession, renameSession, deleteSession } = useSession();
  const {
    projects,
    addProject: addProjectCtx,
    renameProject,
    updateProjectPath,
    removeProject,
  } = useProject();
  const { send } = useWebSocket();
  const browser = useBrowser();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Session rename / delete
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null);
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);

  // Project modify / delete
  const [modifyProjectId, setModifyProjectId] = useState<string | null>(null);
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null);

  // New project
  const [addProjectOpen, setAddProjectOpen] = useState(false);

  // Global keyboard shortcuts + ambient behaviors (search, voice, notifications).
  useGlobalShortcuts(() => setSearchOpen(true));

  const renameSessionTarget = renameSessionId
    ? sessions.find((s) => s.id === renameSessionId) ?? null
    : null;
  const deleteSessionTarget = deleteSessionId
    ? sessions.find((s) => s.id === deleteSessionId) ?? null
    : null;
  const modifyProject = modifyProjectId
    ? projects.find((p) => p.id === modifyProjectId) ?? null
    : null;
  const deleteProject = deleteProjectId
    ? projects.find((p) => p.id === deleteProjectId) ?? null
    : null;

  return (
    <div
      className={cn(
        'flex h-screen w-screen overflow-hidden bg-background text-foreground',
        className,
      )}
    >
      {/* Sidebar (desktop + mobile drawer) */}
      <Sidebar
        mobileOpen={mobileOpen}
        onMobileOpenChange={setMobileOpen}
        onSessionSelect={(sessionId, projectId) =>
          switchSession(sessionId, projectId)
        }
        onSessionRename={(sessionId) => setRenameSessionId(sessionId)}
        onSessionDelete={(sessionId) => setDeleteSessionId(sessionId)}
        onProjectNewSession={(projectId) =>
          send('session:create', { projectId })
        }
        onProjectModify={(projectId) => setModifyProjectId(projectId)}
        onProjectDelete={(projectId) => setDeleteProjectId(projectId)}
        onAddProject={() => setAddProjectOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
        onToggleBrowser={() => browser.setVisible(!browser.visible)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* Main content area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar onMenu={() => setMobileOpen(true)} />
        <ChatPanel className="pt-14 md:pt-0" />
        <VoicePanel />
      </div>

      {/* Overlays & sync */}
      <SessionSync />
      <BrowserView />
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
      <SearchModal open={searchOpen} onOpenChange={setSearchOpen} />

      {/* Session rename */}
      <RenameModal
        open={renameSessionId !== null}
        onOpenChange={(open) => {
          if (!open) setRenameSessionId(null);
        }}
        title="Rename session"
        currentValue={renameSessionTarget?.title}
        placeholder="Session name"
        onSave={(name) => {
          if (renameSessionId) renameSession(renameSessionId, name);
          setRenameSessionId(null);
        }}
      />

      {/* Session delete confirm */}
      <ConfirmModal
        open={deleteSessionId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteSessionId(null);
        }}
        title="Delete session"
        message={
          deleteSessionTarget
            ? `Delete session “${deleteSessionTarget.title || 'Untitled'}”? This cannot be undone.`
            : 'Delete this session?'
        }
        confirmText="Delete"
        variant="danger"
        onConfirm={() => {
          if (deleteSessionId) deleteSession(deleteSessionId);
          setDeleteSessionId(null);
        }}
      />

      {/* Project modify (rename) */}
      <RenameModal
        open={modifyProjectId !== null}
        onOpenChange={(open) => {
          if (!open) setModifyProjectId(null);
        }}
        title="Modify Project"
        currentValue={modifyProject?.name}
        currentPath={modifyProject?.path}
        allowPath
        placeholder="Project name"
        onSave={(name, path) => {
          if (modifyProjectId) {
            void renameProject(modifyProjectId, name).catch(() => {});
            if (path && path !== modifyProject?.path) {
              void updateProjectPath(modifyProjectId, path).catch(() => {});
            }
          }
          setModifyProjectId(null);
        }}
      />

      {/* Project delete confirm */}
      <ConfirmModal
        open={deleteProjectId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteProjectId(null);
        }}
        title={`Delete “${deleteProject?.name || 'project'}”?`}
        message="All sessions in this project will be deleted. The workspace folder will be kept."
        confirmText="Delete"
        variant="danger"
        onConfirm={() => {
          if (deleteProjectId) {
            void removeProject(deleteProjectId).catch(() => {});
          }
          setDeleteProjectId(null);
        }}
      />

      {/* New project */}
      <AddProjectModal
        open={addProjectOpen}
        onOpenChange={setAddProjectOpen}
        onSave={(name, path) => {
          void addProjectCtx(name, path).catch(() => {});
        }}
      />
    </div>
  );
}
