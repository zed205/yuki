'use client';

import { useEffect, useReducer } from 'react';
import { cn } from '@/lib/utils';
import { useSession } from '@/context/session-context';
import { formatAgentElapsed } from '@/lib/model-label';

/**
 * Background sub-agent activity panel (legacy `#agent-activity`):
 * shown only while there are agents; count line "X/Y running · Z queued ·
 * N new"; up to 8 most-recent rows with a status dot, description, live
 * elapsed / queue position / done / error, and a × kill button for
 * live agents. Ticks every second while anything is running.
 */
export function SubAgentPanel() {
  const { subagents, subAgentSlots, killSubAgent } = useSession();
  const [, forceTick] = useReducer((x: number) => x + 1, 0);

  const anyLive = subagents.some(
    (a) => a.status === 'running' || a.status === 'queued',
  );
  useEffect(() => {
    if (!anyLive) return;
    const t = setInterval(forceTick, 1000);
    return () => clearInterval(t);
  }, [anyLive]);

  if (subagents.length === 0) return null;

  const running = subagents.filter((a) => a.status === 'running').length;
  const queued = subagents.filter((a) => a.status === 'queued').length;
  const pending = subagents.filter((a) => a.reportReady).length;

  const bits = [`${running}/${subAgentSlots || running || 0} running`];
  if (queued > 0) bits.push(`${queued} queued`);
  if (pending > 0) bits.push(`${pending} new`);

  return (
    <div className="shrink-0 border-b border-border/50 px-3 py-2">
      <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
        <span>Sub-agents</span>
        <span className="normal-case tracking-normal text-primary/80">
          {bits.join(' · ')}
        </span>
      </div>
      <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
        {subagents
          .slice(-8)
          .reverse()
          .map((a) => {
            const isRunning = a.status === 'running';
            const isQueued = a.status === 'queued';
            return (
              <div key={a.agentId} className="flex items-center gap-2 text-[11px]">
                <span
                  className={cn(
                    'shrink-0',
                    isRunning && 'animate-pulse text-primary',
                    isQueued && 'text-muted-foreground',
                    a.status === 'completed' && 'text-green-500',
                    a.status === 'error' && 'text-red-500',
                    !isRunning && !isQueued && a.status !== 'completed' && a.status !== 'error' && 'text-muted-foreground',
                  )}
                >
                  {isRunning
                    ? '●'
                    : isQueued
                      ? '○'
                      : a.status === 'completed'
                        ? '✓'
                        : a.status === 'error'
                          ? '✗'
                          : '■'}
                </span>
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate',
                    isRunning || isQueued ? 'text-foreground' : 'text-muted-foreground',
                  )}
                  title={
                    a.error ||
                    (a.reportReady
                      ? 'Report pending — it will be included in the next turn.'
                      : undefined)
                  }
                >
                  {a.description || a.agentId}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {isRunning
                    ? `${formatAgentElapsed(a)}s`
                    : isQueued
                      ? a.queuePosition
                        ? `q#${a.queuePosition}`
                        : 'queued'
                      : a.status === 'completed'
                        ? 'done'
                        : a.status}
                </span>
                {(isRunning || isQueued) && (
                  <button
                    type="button"
                    className="shrink-0 px-0.5 leading-none text-muted-foreground transition-colors hover:text-red-500"
                    title="Cancel this sub-agent"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      killSubAgent(a.agentId);
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
