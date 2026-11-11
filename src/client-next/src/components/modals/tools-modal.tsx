'use client';

import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { useSession } from '@/context/session-context';

/**
 * Tools modal (legacy parity): grouped tool checkboxes + MCP server list with
 * status badges. Replaces the old "Execution Log" tool-modal.
 */
const TOOL_GROUPS = [
  { name: 'File', tools: ['read', 'write', 'edit', 'patch', 'glob', 'grep'] },
  { name: 'Shell', tools: ['shell'] },
  { name: 'Web', tools: ['web_search', 'web_fetch'] },
  {
    name: 'Browser',
    tools: [
      'browser_navigate',
      'browser_click',
      'browser_fill',
      'browser_screenshot',
      'browser_get_content',
      'browser_get_links',
    ],
  },
  {
    name: 'Desktop',
    tools: [
      'desktop_viewport',
      'desktop_screenshot',
      'desktop_snapshot_region',
      'desktop_click',
      'desktop_type',
      'desktop_move',
      'desktop_drag',
      'desktop_scroll',
      'desktop_keypress',
    ],
  },
  { name: 'Memory', tools: ['memory_save', 'memory_read', 'memory_list', 'memory_delete'] },
  { name: 'Skill', tools: ['skill_list', 'skill_load', 'skill_save', 'skill_delete'] },
  { name: 'Plan', tools: ['plan_create', 'plan_update', 'plan_get', 'plan_remove'] },
  { name: 'Agents', tools: ['spawn_agent'] },
];

export interface ToolsModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ToolsModal({ open, onOpenChange }: ToolsModalProps) {
  const { tools, mcpServers, toggleTool, toggleMcp } = useSession();
  const enabledBy = useMemo(
    () => Object.fromEntries(tools.map((t) => [t.name, t.enabled])),
    [tools],
  );

  const [groupToggles, setGroupToggles] = useState<Record<string, boolean>>({});

  const setGroup = (name: string, checked: boolean) => {
    setGroupToggles((prev) => ({ ...prev, [name]: checked }));
  };

  const groupState = (group: (typeof TOOL_GROUPS)[number]) => {
    const present = group.tools.filter((t) => t in enabledBy);
    if (present.length === 0) return null;
    const forced = groupToggles[group.name];
    const allOn = present.every((t) => enabledBy[t]);
    const someOn = present.some((t) => enabledBy[t]);
    const checked = forced !== undefined ? forced : allOn;
    return { present, checked, indeterminate: !forced && someOn && !allOn };
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[400px] max-w-[95vw] gap-0 p-0 sm:max-h-[70vh]">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="text-sm font-semibold">Tools</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-2 p-3">
            {TOOL_GROUPS.map((group) => {
              const state = groupState(group);
              if (!state) return null;
              return (
                <div
                  key={group.name}
                  className="overflow-hidden rounded-lg border border-border"
                >
                  <label className="flex cursor-pointer items-center gap-3 border-b border-border bg-[#21262d]/50 px-3 py-2 transition-colors hover:bg-[#21262d]/80">
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer accent-[#d4760a]"
                      checked={state.checked}
                      ref={(el) => {
                        if (el) el.indeterminate = state.indeterminate;
                      }}
                      onChange={(e) => {
                        setGroup(group.name, e.target.checked);
                        for (const t of state.present) {
                          toggleTool(t, e.target.checked);
                        }
                      }}
                    />
                    <span className="text-sm font-semibold">{group.name}</span>
                  </label>
                  <div className="divide-y divide-border/50">
                    {state.present.map((name) => (
                      <label
                        key={name}
                        className="flex cursor-pointer items-center gap-3 px-3 py-1.5 pl-8 transition-colors hover:bg-[#21262d]/30"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer accent-[#d4760a]"
                          checked={!!enabledBy[name]}
                          onChange={(e) => toggleTool(name, e.target.checked)}
                        />
                        <span className="font-mono text-xs text-muted-foreground">
                          {name}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}

            {mcpServers.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="border-b border-border bg-[#21262d]/50 px-3 py-2">
                  <span className="text-sm font-semibold">MCP Servers</span>
                </div>
                <div className="divide-y divide-border/50">
                  {mcpServers.map((s) => {
                    const status = s.connected
                      ? 'connected'
                      : s.enabled
                        ? 'error'
                        : 'off';
                    const statusColor = s.connected
                      ? 'bg-[#3fb950]/15 text-[#3fb950]'
                      : s.enabled
                        ? 'bg-[#f85149]/15 text-[#f85149]'
                        : 'bg-[#21262d] text-muted-foreground';
                    return (
                      <div key={s.name} className="px-3 py-2">
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer accent-[#d4760a]"
                            checked={!!s.enabled}
                            title="Enable/disable MCP connection"
                            onChange={(e) => toggleMcp(s.name, e.target.checked)}
                          />
                          <span className="flex-1 truncate font-mono text-xs">
                            {s.name}
                          </span>
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[10px] ${statusColor}`}
                          >
                            {status}
                          </span>
                        </div>
                        {s.toolCount > 0 && (
                          <div className="mt-1.5 ml-6 text-[10px] text-muted-foreground">
                            {s.toolCount} tool{s.toolCount !== 1 ? 's' : ''}
                          </div>
                        )}
                        {s.enabled && !s.connected && s.error && (
                          <div
                            className="mt-1.5 ml-6 truncate text-[10px] text-[#f85149]"
                            title={s.error}
                          >
                            {s.error}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <ScrollBar orientation="vertical" />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
