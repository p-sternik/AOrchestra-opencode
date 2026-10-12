import type { Task } from './core';

export const phases = ['discover', 'plan', 'execute', 'verify', 'repair', 'complete', 'blocked'] as const;
export type Phase = typeof phases[number];
export type Workflow = {
  phase: Phase; repairs: number;
  events: Array<{ phase: Phase; reason: string; at: number }>;
};
const allowed: Record<Phase, Phase[]> = {
  discover: ['plan', 'blocked'], plan: ['execute', 'blocked'],
  execute: ['verify', 'blocked'], verify: ['repair', 'complete', 'blocked'],
  repair: ['verify', 'blocked'], complete: [], blocked: ['plan', 'execute', 'verify', 'repair'],
};

// Old v1 tasks acquire workflow metadata in-place; status/budgets/baseline survive.
export function workflow(task: Task): Workflow {
  return task.workflow ??= {
    phase: task.status === 'complete' ? 'complete' : task.status === 'blocked' ? 'blocked' : task.status === 'pending' ? 'discover' : 'execute',
    repairs: 0, events: [],
  };
}
export function transition(task: Task, phase: Phase, reason: string): void {
  const state = workflow(task);
  if (state.phase === phase) return; // Resuming the same phase never duplicates an event.
  if (!reason.trim()) throw new Error('WORKFLOW_REASON_REQUIRED');
  if (!allowed[state.phase].includes(phase)) throw new Error(`WORKFLOW_TRANSITION_INVALID: ${state.phase} -> ${phase}`);
  state.phase = phase;
  state.events.push({ phase, reason, at: Date.now() });
}
export function beginExecution(task: Task): void {
  const phase = workflow(task).phase;
  if (phase === 'discover') transition(task, 'plan', 'Existing task contract defines the bounded plan');
  if (workflow(task).phase === 'repair') return;
  transition(task, 'execute', 'Direct execution or bounded native delegation');
}
export function beginRepair(task: Task, reason: string, maxRepairs: number): void {
  if (!reason.trim()) throw new Error('REPAIR_DELTA_REQUIRED');
  const state = workflow(task);
  if (!['verify', 'blocked'].includes(state.phase)) throw new Error('VERIFICATION_REQUIRED_BEFORE_REPAIR');
  if (state.repairs >= maxRepairs) {
    transition(task, 'blocked', 'Repair budget exhausted');
    task.status = 'blocked';
    return;
  }
  transition(task, 'repair', reason);
  state.repairs++;
  task.status = 'running';
  task.receipts = {};
}
