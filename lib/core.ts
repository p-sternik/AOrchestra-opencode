import type { Workflow } from './workflow';
import type { VerificationPlan } from './verification';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';

export type Tier = 'fast' | 'balanced' | 'strong';
export const BUNDLED_SKILL_ID = 'aorchestra-repo-context';
export const isAOrchestraAgent = (agent:string|null|undefined) => agent==='aorchestra'||agent==='aorchestra-executor';
export type Kind = 'analysis' | 'change' | 'verification';
export type Verifier = { id: string; tool: string; input: Record<string, string>; expect: { exitCode?: number; contains?: string } };
export const escalationReasons = ['reasoning-gap', 'compatibility-risk', 'security-risk', 'weak-verification'] as const;
export type EscalationReason = typeof escalationReasons[number];
export type Handoff = {
  sources: Array<{ref:string;status:'observed'|'candidate';revision:string}>;
  facts:string[]; unknowns:string[]; checks:string[];
};
export type Task = {
  id: string; kind: Kind; instruction: string; context: string; dependsOn: string[];
  writePaths: string[]; preserve: string[]; verifiers: Verifier[];
  status: 'pending' | 'running' | 'review' | 'blocked' | 'complete';
  attempts: Attempt[]; receipts: Record<string, { event: string; snapshot: string }>;
  baseline?: string; compatibilityReview?: string;
  workflow?: Workflow; verification?: VerificationPlan;
  handoff?: Handoff; analysisMode?: 'lookup' | 'synthesis';
};
export type Attempt = {
  tier: Tier; reason: string; delta: string; child?: string;
  status: 'running' | 'review' | 'blocked' | 'error' | 'complete';
  startedAt: number; endedAt?: number; cost?: number; tokens?: unknown;
  escalationReason?: EscalationReason;
};
export type State = { version: 1; revision: number; delegations: number; tasks: Task[] };
export type Storage = { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
export type Contract = { owner: string; taskId: string; root: string; tools: string[]; writePaths: string[]; kind: Kind };
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value) ?? 'null').digest('hex');
export const portablePath = (path: string) => path.replaceAll('\\', '/');
export const secretPath = (path: string) => /(^|\/)(\.git|\.opencode|\.ssh|\.aws|\.gnupg)(\/|$)|(^|\/)\.env(?:\..*)?$|\.(?:pem|key)$/i.test(portablePath(path));

export function inside(root: string, target: string): boolean {
  const path = /^[A-Za-z]:[\\/]|^\\\\/.test(root) ? win32 : { relative, isAbsolute, sep };
  const distance = path.relative(root, target);
  return distance === '' || (!path.isAbsolute(distance) && distance !== '..' && !distance.startsWith(`..${path.sep}`));
}
export function scopedPath(root: string, path: string): string {
  const target = resolve(root, path);
  if (!inside(root, target) || secretPath(relative(root, target))) throw new Error('PATH_OUTSIDE_SCOPE_OR_SENSITIVE');
  return target;
}

const safeReadTools = new Set(['read', 'grep', 'glob', 'webfetch', 'websearch', 'lsp']);
const edits = new Set(['edit', 'write', 'patch', 'apply_patch']);
const actionForTool: Record<string, string> = { fetch: 'webfetch', search: 'websearch', opencode: 'execute' };
export function validateTools(task: Task, tools: string[], catalog: ReadonlySet<string>): void {
  if (new Set(tools).size !== tools.length) throw new Error('DUPLICATE_TOOLS');
  for (const tool of tools) {
    if (!catalog.has(tool)) throw new Error(`TOOL_UNAVAILABLE: ${tool}`);
    if (task.kind !== 'change' && !safeReadTools.has(tool)) throw new Error(`READ_ONLY_TOOL_DENIED: ${tool}`);
    // Workers never get arbitrary host command execution. The primary verifies via native shell.
    if (['shell', 'bash', 'subagent', 'question', 'skill'].includes(tool) || tool.startsWith('aorchestra_') || tool.startsWith('opencode_')) throw new Error(`WORKER_TOOL_DENIED: ${tool}`);
    if (edits.has(tool) && (!task.writePaths.length || task.kind !== 'change')) throw new Error('WRITE_SCOPE_REQUIRED');
  }
}

export type Rule = { action: string; resource: string; effect: 'deny' | 'allow' | 'ask' };
export function permissionRules(contract: Contract): Rule[] {
  const rules: Rule[] = [{ action: '*', resource: '*', effect: 'deny' }];
  for (const tool of contract.tools) {
    if (edits.has(tool)) {
      for (const path of contract.writePaths) {
        rules.push({ action: 'edit', resource: portablePath(path), effect: 'allow' });
        rules.push({ action: 'edit', resource: portablePath(scopedPath(contract.root, path)), effect: 'allow' });
      }
    } else rules.push({ action: actionForTool[tool] ?? tool, resource: '*', effect: 'allow' });
  }
  // Rules persist on the native child session and remain protective even without plugin RAM.
  for (const resource of ['*.env', '*.env.*', '*.pem', '*.key', '.git/*', '*/.git/*', '.opencode/*', '*/.opencode/*']) {
    rules.push({ action: 'read', resource, effect: 'deny' }, { action: 'edit', resource, effect: 'deny' });
  }
  rules.push({ action: 'external_directory', resource: '*', effect: 'deny' });
  return rules;
}

export function verifierPassed(verifier: Verifier, event: { tool: string; input: unknown; status: string; result?: unknown }): boolean {
  if (event.status !== 'completed' || event.tool !== verifier.tool || !event.input || typeof event.input !== 'object') return false;
  if (!Object.entries(verifier.input).every(([key, value]) => (event.input as Record<string, unknown>)[key] === value)) return false;
  const result = event.result;
  if (!result || typeof result !== 'object') return false;
  const object = result as Record<string, unknown>;
  const output = object.output;
  const metadata = object.metadata as Record<string, unknown> | undefined;
  if (verifier.expect.exitCode !== undefined) {
    // Explicit runtime fields only; do not infer success from text or tool status.
    const exitCode = metadata?.exitCode ?? metadata?.exit ?? (output && typeof output === 'object' ? (output as Record<string, unknown>).exitCode : undefined);
    if (exitCode !== verifier.expect.exitCode) return false;
  }
  if (verifier.expect.contains !== undefined) {
    const content = object.content;
    const text = typeof output === 'string' ? output : typeof content === 'string' ? content : Array.isArray(content) ? content.filter(p => p?.type === 'text').map(p => p.text).join('\n') : '';
    if (!text.includes(verifier.expect.contains)) return false;
  }
  return verifier.expect.exitCode !== undefined || Boolean(verifier.expect.contains);
}

export function parseResult(text: string): { status: 'COMPLETE' | 'PARTIAL' | 'BLOCKED'; evidence: string; text: string } {
  const fields = ['STATUS', 'RESULT', 'EVIDENCE', 'CHANGED', 'OPEN'];
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z]+):\s*(.*)$/.exec(line);
    if (!match || !fields.includes(match[1])) continue;
    if (map.has(match[1])) throw new Error('DUPLICATE_RESULT_FIELD');
    map.set(match[1], match[2].trim());
  }
  if (fields.some(field => !map.get(field))) throw new Error('EMPTY_RESULT_FIELD');
  const status = map.get('STATUS');
  if (!['COMPLETE', 'PARTIAL', 'BLOCKED'].includes(status!)) throw new Error('INVALID_STATUS');
  if (status === 'COMPLETE' && (map.get('OPEN') !== 'none' || map.get('EVIDENCE') === 'none')) throw new Error('UNSUPPORTED_COMPLETE');
  return { status: status as 'COMPLETE' | 'PARTIAL' | 'BLOCKED', evidence: map.get('EVIDENCE')!, text };
}

export class Ledger {
  private locks = new Map<string, Promise<void>>();
  constructor(private storage: Storage) {}
  async read(owner: string): Promise<State> {
    const stored = await this.storage.get(`state/${owner}`);
    if (!stored) return { version: 1, revision: 0, delegations: 0, tasks: [] };
    const state = structuredClone(stored) as State;
    if (state.version !== 1 || !Array.isArray(state.tasks)) throw new Error('STATE_VERSION_INVALID');
    return state;
  }
  async mutate<T>(owner: string, change: (state: State) => T | Promise<T>): Promise<T> {
    const before = this.locks.get(owner) ?? Promise.resolve();
    let release!: () => void;
    const after = before.then(() => new Promise<void>(resolve => { release = resolve; }));
    this.locks.set(owner, after);
    await before;
    // Let the queued gate initialize before invoking the mutation.
    await Promise.resolve();
    try {
      const state = await this.read(owner);
      const result = await change(state);
      state.revision++;
      await this.storage.set(`state/${owner}`, JSON.parse(JSON.stringify(state)));
      return result;
    } finally {
      release();
      if (this.locks.get(owner) === after) this.locks.delete(owner);
    }
  }
}

export function taskById(state: State, id: string): Task {
  const task = state.tasks.find(task => task.id === id);
  if (!task) throw new Error(`TASK_NOT_FOUND: ${id}`);
  return task;
}
export function registerTask(state: State, task: Task): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(task.id) || state.tasks.some(item => item.id === task.id)) throw new Error('TASK_ID_INVALID_OR_DUPLICATE');
  if (!task.instruction.trim() || !task.verifiers.length || task.verifiers.some(v => !v.id || !Object.keys(v.input).length || (v.expect.exitCode === undefined && !v.expect.contains))) throw new Error('TASK_VERIFIER_REQUIRED');
  if (new Set(task.verifiers.map(v => v.id)).size !== task.verifiers.length) throw new Error('VERIFIER_ID_DUPLICATE');
  if (task.kind !== 'change' && task.writePaths.length) throw new Error('READ_ONLY_WRITE_SCOPE');
  if (task.analysisMode && (task.kind!=='analysis'||!['lookup','synthesis'].includes(task.analysisMode))) throw new Error('ANALYSIS_MODE_INVALID');
  if (task.handoff) validateHandoff(task.handoff);
  if (task.writePaths.some(path => isAbsolute(path) || win32.isAbsolute(path) || portablePath(path).split('/').includes('..') || /[*?]/.test(path) || secretPath(path))) throw new Error('EXACT_RELATIVE_WRITE_PATHS_REQUIRED');
  for (const dependency of task.dependsOn) taskById(state, dependency); // New tasks can only depend on older tasks, so cycles are impossible.
  state.tasks.push(task);
}
export function ready(state: State, task: Task): void {
  if (task.status === 'complete') throw new Error('TASK_ALREADY_COMPLETE');
  if (task.dependsOn.some(id => taskById(state, id).status !== 'complete')) throw new Error('DEPENDENCY_UNMET');
  if (state.tasks.some(other => other.id !== task.id && other.status === 'running')) throw new Error('ACTIVE_TASK_EXISTS');
}
export function validateHandoff(handoff: Handoff | undefined): asserts handoff is Handoff {
  if (!handoff) throw new Error('HANDOFF_REQUIRED: provide source references, facts, unknowns and checks');
  const text=(value:unknown)=>typeof value==='string'&&value.trim().length>0&&value.length<=1600;
  if(!Array.isArray(handoff.sources)||!handoff.sources.length||handoff.sources.length>12||handoff.sources.some(source=>!source||!text(source.ref)||!text(source.revision)||!['observed','candidate'].includes(source.status)))throw new Error('HANDOFF_SOURCES_INVALID');
  for(const name of ['facts','unknowns','checks'] as const)if(!Array.isArray(handoff[name])||handoff[name].length>20||handoff[name].some(value=>!text(value)))throw new Error('HANDOFF_ITEMS_INVALID');
  if(JSON.stringify(handoff).length>12000)throw new Error('HANDOFF_TOO_LARGE');
}
export function reserve(state: State, task: Task, tier: Tier, reason: string, delta: string, maxDelegations: number, maxAttempts: number, escalationReason?: EscalationReason): Attempt {
  ready(state, task);
  if (task.attempts.some(attempt => attempt.status === 'running')) throw new Error('ATTEMPT_RUNNING');
  if (!reason.trim() || (task.attempts.length && !delta.trim())) throw new Error('ROUTING_REASON_AND_RETRY_DELTA_REQUIRED');
  if (task.kind==='analysis'&&tier==='fast'&&task.analysisMode!=='lookup') throw new Error('FAST_RESEARCH_REQUIRES_LOOKUP_MODE');
  if(escalationReason&&!escalationReasons.includes(escalationReason))throw new Error('ESCALATION_REASON_INVALID');
  if (state.delegations >= maxDelegations || task.attempts.length >= maxAttempts) throw new Error('BUDGET_EXCEEDED');
  const previous = task.attempts.at(-1);
  const rank = { fast: 0, balanced: 1, strong: 2 };
  if(previous&&rank[tier]<rank[previous.tier])throw new Error('TIER_DOWNGRADE_DENIED');
  if(previous&&rank[tier]>rank[previous.tier]+1&&!escalationReason)throw new Error('ESCALATION_REASON_REQUIRED');
  const attempt: Attempt = { tier, reason, delta, status: 'running', startedAt: Date.now(), ...(escalationReason?{escalationReason}:{}) };
  task.attempts.push(attempt); state.delegations++; task.status = 'running'; task.receipts = {};
  return attempt;
}
