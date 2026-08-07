import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Plan, PlanStep } from '../shared/types';

const plansDir = path.join(os.homedir(), '.config', 'yukiweb', 'plans');
const plans = new Map<string, Plan>();

function ensureDir(): void {
  if (!fs.existsSync(plansDir)) {
    fs.mkdirSync(plansDir, { recursive: true });
  }
}

function planPath(sessionId: string): string {
  return path.join(plansDir, `${sessionId}.json`);
}

function serialize(plan: Plan): any {
  return {
    ...plan,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

function deserialize(data: any): Plan {
  return {
    ...data,
    createdAt: new Date(data.createdAt),
    updatedAt: new Date(data.updatedAt),
  };
}

function savePlan(plan: Plan): void {
  ensureDir();
  fs.writeFileSync(planPath(plan.id.replace(/-plan$/, '')), JSON.stringify(serialize(plan)));
}

function deletePlanFile(sessionId: string): void {
  const fp = planPath(sessionId);
  if (fs.existsSync(fp)) {
    fs.unlinkSync(fp);
  }
}

export function loadPlans(): void {
  plans.clear();
  ensureDir();
  const files = fs.readdirSync(plansDir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(plansDir, file), 'utf-8'));
      const plan = deserialize(data);
      const sessionId = file.replace(/\.json$/, '');
      plans.set(sessionId, plan);
    } catch { /* skip corrupt files */ }
  }
}

export function planCreate(sessionId: string, title: string, steps: string[]): Plan {
  const plan: Plan = {
    id: `${sessionId}-plan`,
    title,
    steps: steps.map((s, i) => ({
      id: String(i),
      description: s,
      status: 'pending',
    })),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  plans.set(sessionId, plan);
  savePlan(plan);
  return plan;
}

export function planUpdate(sessionId: string, stepIndex: number, status: PlanStep['status']): Plan | null {
  const plan = plans.get(sessionId);
  if (!plan) return null;
  if (stepIndex >= 0 && stepIndex < plan.steps.length) {
    plan.steps[stepIndex].status = status;
    plan.updatedAt = new Date();
  }
  savePlan(plan);
  return plan;
}

export function planGet(sessionId: string): Plan | null {
  return plans.get(sessionId) || null;
}

export function planRemove(sessionId: string): boolean {
  deletePlanFile(sessionId);
  return plans.delete(sessionId);
}

export function getPlanSummary(sessionId: string): string {
  const plan = plans.get(sessionId);
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
