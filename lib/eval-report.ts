import type { Run } from './telemetry';
import { workflowUsage, type WorkflowUsage } from './usage';

export type Strategy = 'direct' | 'selective';
export interface EvaluationResult {
  id: string;
  strategy: Strategy;
  repeat: number;
  passed: boolean;
  behaviorPassed: boolean;
  scopePassed: boolean;
  changedPaths: string[];
  delegations: number;
  durationMs: number;
  totalWorkflowCost: number | null;
  totalWorkflowTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  usageComplete: boolean;
  usageIssues: string[];
  missingSessions: string[];
  sessionID: string | null;
  runID: string | null;
  runtimeOutcome: Run['runtimeOutcome'] | null;
  error: string | null;
  independentCheck: string;
  workspace: string;
}

export interface NativeSessionLink { id: string; parentID?: string }
export function reconcileEvaluation(sessionID: string, records: Run[], family: NativeSessionLink[]) {
  const unique = new Map<string, Run>();
  for (const run of records.filter(r => r.sessionID === sessionID)) {
    const prior = unique.get(run.id);
    if (!prior || (prior.endedAt === null && run.endedAt !== null)) unique.set(run.id, run);
  }
  const runs = [...unique.values()];
  const issues: string[] = [];
  const run = runs.length === 1 ? runs[0] : null;
  if (!run) issues.push(runs.length ? 'ambiguous-primary-executions' : 'primary-execution-not-observed');
  const nativeIDs = new Set(family.map(s => s.id));
  if (!nativeIDs.has(sessionID)) issues.push('native-primary-not-observed');
  if (run) {
    const recorded = new Set(run.children.map(c => c.sessionID));
    for (const child of run.children) {
      if (!family.some(s => s.id === child.sessionID && s.parentID === sessionID)) issues.push(`child-ownership-mismatch:${child.sessionID}`);
    }
    for (const child of family.filter(s => s.id !== sessionID)) {
      if (!recorded.has(child.id)) issues.push(`unrecorded-native-child:${child.id}`);
    }
  }
  const correlated = issues.length === 0;
  const unknown: WorkflowUsage = {costUSD:null,inputTokens:null,outputTokens:null,reasoningTokens:null,cacheReadTokens:null,cacheWriteTokens:null,totalTokens:null,complete:false,missingSessions:[...nativeIDs].sort()};
  const usage = correlated && run ? workflowUsage(run) : unknown;
  if (run?.endedAt === null || run?.observationIssue) issues.push(run.observationIssue ?? 'terminal-not-observed');
  if (run?.runtimeOutcome === 'interrupted') issues.push('execution-interrupted');
  if (run?.children.some(c => c.outcome === 'running' || c.outcome === 'interrupted' || c.outcome === 'unknown')) issues.push('child-terminal-incomplete');
  if (!usage.complete) issues.push('missing-usage-counters');
  return {run,usage,complete:correlated && usage.complete && issues.length === 0,issues};
}

export function comparison(results: EvaluationResult[]) {
  return (['direct', 'selective'] as const).map(strategy => {
    const rows = results.filter(r => r.strategy === strategy), successes = rows.filter(r => r.passed).length;
    const observed = rows.filter(r => r.totalWorkflowCost !== null);
    const complete = rows.filter(r => r.usageComplete).length;
    const costComplete = rows.length > 0 && complete === rows.length;
    const sum = observed.length ? observed.reduce((n,r) => n + r.totalWorkflowCost!, 0) : null;
    const durations = rows.map(r => r.durationMs).sort((a,b) => a-b), mid = Math.floor(durations.length/2);
    return {strategy,runs:rows.length,verifiedSuccesses:successes,verifiedSuccessRate:rows.length ? successes/rows.length : null,
      totalObservedCostUSD:sum,observedCostRuns:observed.length,completeUsageRuns:complete,usageCoverage:rows.length ? complete/rows.length : null,
      costPerVerifiedSuccessUSD:costComplete && successes ? sum! / successes : null,
      comparisonComplete:costComplete,medianDurationMs:durations.length ? (durations.length%2 ? durations[mid] : (durations[mid-1]+durations[mid])/2) : null,
      scopeViolations:rows.filter(r => !r.scopePassed).length,delegationsPerRun:rows.length ? rows.reduce((n,r) => n+r.delegations,0)/rows.length : null};
  });
}

export function evaluationMarkdown(results: EvaluationResult[]): string {
  const lines = ['# AOrchestra evaluation comparison','',
    '| Strategy | Verified / attempts | Success rate | Observed USD (runs) | USD / verified success | Median ms | Complete usage | Scope violations | Delegations / run |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|'];
  for (const g of comparison(results)) lines.push(`| ${g.strategy} | ${g.verifiedSuccesses} / ${g.runs} | ${g.verifiedSuccessRate ?? 'unknown'} | ${g.totalObservedCostUSD ?? 'unknown'} (${g.observedCostRuns}) | ${g.costPerVerifiedSuccessUSD ?? 'unknown'} | ${g.medianDurationMs ?? 'unknown'} | ${g.completeUsageRuns} / ${g.runs} | ${g.scopeViolations} | ${g.delegationsPerRun ?? 'unknown'} |`);
  lines.push('', 'Observed cost includes known costs of failed and interrupted attempts. Cost per verified success includes every attempt in the strategy and requires complete usage and lifecycle coverage. Missing measurements remain unknown. Costs are native counter estimates, not provider invoices.', '',
    'This small smoke corpus is not a representative brownfield benchmark. Results are descriptive; model randomness and task selection preclude claims of strategy superiority.', '',
    'Usage issues:');
  for (const r of results.filter(r => r.usageIssues.length)) lines.push(`- ${r.id} / ${r.strategy} / ${r.repeat}: ${r.usageIssues.join(', ')}`);
  return lines.join('\n') + '\n';
}
