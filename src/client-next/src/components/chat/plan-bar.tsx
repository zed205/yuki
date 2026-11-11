'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { Plan, PlanStep } from '@/lib/types';

/**
 * Plan bar (legacy `#plan-bar`): collapsible header with title, progress,
 * colored step rows. Hidden when plan is null.
 */
export function PlanBar({ plan }: { plan: Plan | null }) {
  const [collapsed, setCollapsed] = useState(false);
  if (!plan) return null;

  const total = plan.steps.length;
  const done = plan.steps.filter((s) => s.status === 'completed').length;
  const progressText = total > 0 ? `${done}/${total}` : '0/0';

  const stepColor = (status: PlanStep['status']) => {
    switch (status) {
      case 'completed':
        return 'bg-emerald-500';
      case 'in_progress':
        return 'bg-blue-500 animate-pulse';
      case 'pending':
        return 'bg-muted';
      case 'cancelled':
        return 'bg-red-500';
      default:
        return 'bg-muted';
    }
  };

  return (
    <div className="px-4 py-2 border-t border-border bg-muted/30">
      <div className="max-w-4xl mx-auto">
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-2 text-left"
          onClick={() => setCollapsed((v) => !v)}
        >
          <span className="truncate text-xs font-semibold text-primary">
            {plan.title || 'Plan'}
          </span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {progressText}
          </span>
          {collapsed ? (
            <ChevronDown size={12} className="ml-1 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronUp size={12} className="ml-1 shrink-0 text-muted-foreground" />
          )}
        </button>
        {!collapsed && (
          <div className="mt-1.5 flex flex-col gap-0.5">
            {plan.steps.map((step) => (
              <div key={step.id} className="flex items-center gap-2 text-xs">
                <span
                  className={`shrink-0 h-1.5 w-1.5 rounded-full ${stepColor(step.status)}`}
                />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {step.description}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground/60">
                  {step.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
