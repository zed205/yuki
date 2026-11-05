import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type Database from 'better-sqlite3';
import { Plan, PlanStep } from '../shared/types';
import { getDb } from '../db';
import { normalizeLineEndings } from './utils/line-endings';

const plansDir = path.join(os.homedir(), '.config', 'yukiweb', 'plans');

function ensureDir(): void {
  if (!fs.existsSync(plansDir)) {
    fs.mkdirSync(plansDir, { recursive: true });
  }
}

function serializeSteps(steps: PlanStep[]): string {
  return JSON.stringify(steps);
}

function deserializeSteps(data: string): PlanStep[] {
  return JSON.parse(data);
}

function serializePlan(plan: Plan): { title: string; steps: string; created_at: number; updated_at: number } {
  return {
    title: plan.title,
    steps: serializeSteps(plan.steps),
    created_at: plan.createdAt.getTime(),
    updated_at: plan.updatedAt.getTime(),
  };
}

function deserializePlan(sessionId: string, data: { title: string; steps: string; created_at: number; updated_at: number }): Plan {
  return {
    id: `${sessionId}-plan`,
    title: data.title,
    steps: deserializeSteps(data.steps),
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
  };
}

export function loadPlans(): void {
  ensureDir();
  const db: Database.Database = getDb();
  const rows = db.prepare('SELECT * FROM plans').all() as { session_id: string; title: string; steps: string; created_at: number; updated_at: number }[];

  // Also migrate legacy files
  const files = fs.readdirSync(plansDir).filter(f => f.endsWith('.json'));
  const dbSessionIds = new Set(rows.map(r => r.session_id));

  for (const file of files) {
    if (dbSessionIds.has(file.replace(/\.json$/, ''))) continue;
    try {
      const rawData = fs.readFileSync(path.join(plansDir, file), 'utf-8');
      const data = JSON.parse(normalizeLineEndings(rawData));
      const sessionId = file.replace(/\.json$/, '');
      const plan = deserializePlan(sessionId, {
        title: data.title,
        steps: serializeSteps(data.steps),
        created_at: data.createdAt ? new Date(data.createdAt).getTime() : Date.now(),
        updated_at: data.updatedAt ? new Date(data.updatedAt).getTime() : Date.now(),
      });
      db.prepare(
        'INSERT OR REPLACE INTO plans (session_id, title, steps, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(
        sessionId,
        plan.title,
        serializeSteps(plan.steps),
        plan.createdAt.getTime(),
        plan.updatedAt.getTime(),
      );
    } catch { /* skip corrupt files */ }
  }
}

export function planCreate(sessionId: string, title: string, steps: string[]): Plan {
  const db: Database.Database = getDb();
  const now = Date.now();
  const planSteps = steps.map((s, i) => ({
    id: String(i),
    description: s,
    status: 'pending' as const,
  }));
  const plan: Plan = {
    id: `${sessionId}-plan`,
    title,
    steps: planSteps,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };

  db.prepare(
    'INSERT OR REPLACE INTO plans (session_id, title, steps, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(
    sessionId,
    plan.title,
    serializeSteps(plan.steps),
    plan.createdAt.getTime(),
    plan.updatedAt.getTime(),
  );

  return plan;
}

export function planUpdate(sessionId: string, stepIndex: number, status: PlanStep['status']): Plan | null {
  const db: Database.Database = getDb();
  const row = db.prepare('SELECT * FROM plans WHERE session_id = ?').get(sessionId) as { title: string; steps: string; created_at: number; updated_at: number } | undefined;
  if (!row) return null;

  const plan = deserializePlan(sessionId, row);
  if (stepIndex >= 0 && stepIndex < plan.steps.length) {
    plan.steps[stepIndex].status = status;
    plan.updatedAt = new Date();

    db.prepare(
      'UPDATE plans SET steps = ?, updated_at = ? WHERE session_id = ?'
    ).run(
      serializeSteps(plan.steps),
      plan.updatedAt.getTime(),
      sessionId,
    );
  }

  return plan;
}

export function planGet(sessionId: string): Plan | null {
  const db: Database.Database = getDb();
  const row = db.prepare('SELECT * FROM plans WHERE session_id = ?').get(sessionId) as { title: string; steps: string; created_at: number; updated_at: number } | undefined;
  if (!row) return null;
  return deserializePlan(sessionId, row);
}

export function planRemove(sessionId: string): boolean {
  const db: Database.Database = getDb();
  // Delete the file as well (legacy cleanup)
  deletePlanFile(sessionId);
  const result = db.prepare('DELETE FROM plans WHERE session_id = ?').run(sessionId);
  return result.changes > 0;
}

function deletePlanFile(sessionId: string): void {
  const fp = path.join(plansDir, `${sessionId}.json`);
  if (fs.existsSync(fp)) {
    fs.unlinkSync(fp);
  }
}

export function getPlanSummary(sessionId: string): string {
  const plan = planGet(sessionId);
  if (!plan) return 'No active plan.';
  const stepLines = plan.steps.map((s, i) =>
    `  ${i}. [${s.status === 'completed' ? '✓' : s.status === 'in_progress' ? '→' : s.status === 'cancelled' ? '✗' : ' '}] ${s.description}`
  );
  return [
    `## Current Plan: ${plan.title}`,
    '',
    ...stepLines,
    '',
    `Use plan_create, plan_update, plan_remove tools to manage this plan. Remove the plan once all steps are completed or cancelled.`,
  ].join('\n');
}
