import type { Run } from './telemetry';
import { workflowUsage, type WorkflowUsage } from './usage';

export type Strategy = 'direct' | 'selective';
export interface EvaluationResult {
  id: string;
  strategy: Strategy;
  repeat: number;
  passed: boolean;
  executionConfirmed: boolean;
  behaviorPassed: boolean;
  regressionPassed: boolean;
  policyPassed: boolean;
  scopePassed: boolean;
  changedPaths: string[];
  independentCheckChangedPaths?: string[];
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
  costComplete: boolean;
  lifecycleComplete: boolean;
  providerRetries: number | null;
  delegationRetries: number | null;
  repairs: number | null;
  toolActivity: Record<string, number> | null;
  settingsFingerprint?: string | null;
  usageIssues: string[];
  activityIssues?: string[];
  missingSessions: string[];
  sessionID: string | null;
  runID: string | null;
  runtimeOutcome: Run['runtimeOutcome'] | null;
  error: string | null;
  independentCheck: string;
  workspace: string;
  observedModels?: Record<string, number> | null;
}

export function evaluationOutcome(
  result: Pick<
    EvaluationResult,
    'runtimeOutcome' | 'error' | 'behaviorPassed' | 'regressionPassed' | 'scopePassed'
  >,
  policyPassed: boolean,
) {
  const executionConfirmed = result.runtimeOutcome === 'succeeded';
  return {
    executionConfirmed,
    passed:
      executionConfirmed &&
      !result.error &&
      result.behaviorPassed &&
      result.regressionPassed &&
      result.scopePassed &&
      policyPassed,
  };
}

export interface NativeSessionLink {
  id: string;
  parentID?: string;
}
export function evaluationPolicy(
  strategy: Strategy,
  sessionID: string | null,
  records: Run[],
  family: NativeSessionLink[],
  trajectoryDelegations: number,
) {
  const children = new Set(family.filter((s) => s.id !== sessionID).map((s) => s.id));
  for (const run of records.filter((r) => r.sessionID === sessionID)) {
    for (const child of run.children) children.add(child.sessionID);
  }
  // Session IDs can be deduplicated across native storage and telemetry. CLI
  // tool events without child IDs still prove delegation independently.
  const toolCalls = [
    ...new Map(records.filter((r) => r.sessionID === sessionID).map((r) => [r.id, r])).values(),
  ].reduce((n, r) => n + (r.tools.aorchestra_delegate ?? 0) + (r.tools.subagent ?? 0), 0);
  const delegations = Math.max(children.size, trajectoryDelegations, toolCalls);
  return { delegations, passed: strategy !== 'direct' || delegations === 0 };
}

export function reconcileEvaluation(
  sessionID: string,
  records: Run[],
  family: NativeSessionLink[],
) {
  const unique = new Map<string, Run>();
  for (const run of records.filter((r) => r.sessionID === sessionID)) {
    const prior = unique.get(run.id);
    if (!prior || (prior.endedAt === null && run.endedAt !== null)) unique.set(run.id, run);
  }
  const runs = [...unique.values()];
  const issues: string[] = [];
  const run = runs.length === 1 ? runs[0] : null;
  if (!run)
    issues.push(runs.length ? 'ambiguous-primary-executions' : 'primary-execution-not-observed');
  const nativeIDs = new Set(family.map((s) => s.id));
  if (!nativeIDs.has(sessionID)) issues.push('native-primary-not-observed');
  if (run) {
    const recorded = new Set(run.children.map((c) => c.sessionID));
    for (const child of run.children) {
      if (!family.some((s) => s.id === child.sessionID && s.parentID === sessionID))
        issues.push(`child-ownership-mismatch:${child.sessionID}`);
    }
    for (const child of family.filter((s) => s.id !== sessionID)) {
      if (!recorded.has(child.id)) issues.push(`unrecorded-native-child:${child.id}`);
    }
  }
  const correlated = issues.length === 0;
  const unknown: WorkflowUsage = {
    costUSD: null,
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    totalTokens: null,
    complete: false,
    missingSessions: [...nativeIDs].sort(),
  };
  const usage = correlated && run ? workflowUsage(run) : unknown;
  if (run?.endedAt === null || run?.observationIssue)
    issues.push(run.observationIssue ?? 'terminal-not-observed');
  if (run?.runtimeOutcome === 'interrupted') issues.push('execution-interrupted');
  if (
    run?.children.some(
      (c) => c.outcome === 'running' || c.outcome === 'interrupted' || c.outcome === 'unknown',
    )
  )
    issues.push('child-terminal-incomplete');
  if (!usage.complete) issues.push('missing-usage-counters');
  const lifecycleComplete =
    correlated &&
    !!run &&
    run.endedAt !== null &&
    !run.observationIssue &&
    ['succeeded', 'failed'].includes(run.runtimeOutcome) &&
    run.children.every((c) => ['succeeded', 'failed'].includes(c.outcome));
  return {
    run,
    usage,
    complete: correlated && usage.complete && issues.length === 0,
    costComplete: lifecycleComplete && usage.costUSD !== null,
    lifecycleComplete,
    issues,
  };
}

function observedSum(values: Array<number | null>) {
  const measured = values.filter((v): v is number => typeof v === 'number');
  return {
    totalObserved: measured.length ? measured.reduce((a, b) => a + b, 0) : null,
    observedRuns: measured.length,
  };
}
function variability(values: number[]) {
  const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  return {
    samples: values.length,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    mean,
    sampleStandardDeviation:
      values.length > 1
        ? Math.sqrt(values.reduce((n, v) => n + (v - mean!) ** 2, 0) / (values.length - 1))
        : null,
  };
}
export function caseComparisons(results: EvaluationResult[]) {
  return [...new Set(results.map((r) => r.id))].map((id) => {
    const rows = results.filter((r) => r.id === id);
    const pairs = [...new Set(rows.map((r) => r.repeat))]
      .sort((a, b) => a - b)
      .map((repeat) => {
        const group = rows.filter((r) => r.repeat === repeat);
        const direct = group.filter((r) => r.strategy === 'direct');
        const selective = group.filter((r) => r.strategy === 'selective');
        const matched =
          direct.length === 1 &&
          selective.length === 1 &&
          !!direct[0].settingsFingerprint &&
          direct[0].settingsFingerprint === selective[0].settingsFingerprint;
        return {
          repeat,
          matched,
          outcomes: group,
          costDifferenceUSD:
            matched &&
            direct[0].costComplete &&
            selective[0].costComplete &&
            direct[0].totalWorkflowCost !== null &&
            selective[0].totalWorkflowCost !== null
              ? selective[0].totalWorkflowCost - direct[0].totalWorkflowCost
              : null,
          durationDifferenceMs: matched ? selective[0].durationMs - direct[0].durationMs : null,
        };
      });
    return {
      id,
      strategies: comparison(rows),
      pairs,
      costDifferenceVariabilityUSD: variability(
        pairs.map((p) => p.costDifferenceUSD).filter((v): v is number => v !== null),
      ),
    };
  });
}

export function comparison(results: EvaluationResult[]) {
  return (['direct', 'selective'] as const).map((strategy) => {
    const rows = results.filter((r) => r.strategy === strategy),
      successes = rows.filter((r) => r.passed).length;
    const observed = rows.filter((r) => r.totalWorkflowCost !== null);
    const observedTokens = rows.filter((r) => r.totalWorkflowTokens !== null);
    const complete = rows.filter((r) => r.usageComplete).length;
    const costComplete =
      rows.length > 0 && rows.every((r) => r.costComplete && r.totalWorkflowCost !== null);
    const sum = observed.length ? observed.reduce((n, r) => n + r.totalWorkflowCost!, 0) : null;
    const durations = rows.map((r) => r.durationMs).sort((a, b) => a - b),
      mid = Math.floor(durations.length / 2);
    return {
      strategy,
      runs: rows.length,
      verifiedSuccesses: successes,
      verifiedSuccessRate: rows.length ? successes / rows.length : null,
      totalObservedCostUSD: sum,
      totalCostUSD: costComplete ? sum : null,
      totalObservedTokens: observedTokens.length
        ? observedTokens.reduce((n, r) => n + r.totalWorkflowTokens!, 0)
        : null,
      observedTokenRuns: observedTokens.length,
      totalDelegations: rows.reduce((n, r) => n + r.delegations, 0),
      missingUsageRuns: rows.length - complete,
      observedCostRuns: observed.length,
      completeUsageRuns: complete,
      usageCoverage: rows.length ? complete / rows.length : null,
      costPerVerifiedSuccessUSD: costComplete && successes ? sum! / successes : null,
      comparisonComplete: costComplete,
      completeCostRuns: rows.filter((r) => r.costComplete).length,
      incompleteLifecycleRuns: rows.filter((r) => !r.lifecycleComplete).length,
      tokenCategories: Object.fromEntries(
        [
          'inputTokens',
          'outputTokens',
          'reasoningTokens',
          'cacheReadTokens',
          'cacheWriteTokens',
        ].map((key) => {
          const values = rows
            .map((r) => r[key as keyof EvaluationResult])
            .filter((v): v is number => typeof v === 'number');
          return [
            key,
            {
              totalObserved: values.length ? values.reduce((a, b) => a + b, 0) : null,
              observedRuns: values.length,
            },
          ];
        }),
      ),
      providerRetries: observedSum(rows.map((r) => r.providerRetries)),
      delegationRetries: observedSum(rows.map((r) => r.delegationRetries)),
      repairs: observedSum(rows.map((r) => r.repairs)),
      costVariabilityUSD: variability(
        rows.map((r) => r.totalWorkflowCost).filter((v): v is number => v !== null),
      ),
      durationVariabilityMs: variability(durations),
      medianDurationMs: durations.length
        ? durations.length % 2
          ? durations[mid]
          : (durations[mid - 1] + durations[mid]) / 2
        : null,
      scopeViolations: rows.filter((r) => !r.scopePassed).length,
      delegationsPerRun: rows.length
        ? rows.reduce((n, r) => n + r.delegations, 0) / rows.length
        : null,
    };
  });
}

export function evaluationMarkdown(results: EvaluationResult[]): string {
  const lines = [
    '# AOrchestra evaluation comparison',
    '',
    '| Strategy | Verified / attempts | Success rate | Total / observed USD (runs) | USD / verified success | Observed tokens (runs) | Median ms | Complete usage | Scope violations | Delegations / run |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const g of comparison(results))
    lines.push(
      `| ${g.strategy} | ${g.verifiedSuccesses} / ${g.runs} | ${g.verifiedSuccessRate ?? 'unknown'} | ${g.totalCostUSD ?? 'unknown'} / ${g.totalObservedCostUSD ?? 'unknown'} (${g.observedCostRuns}) | ${g.costPerVerifiedSuccessUSD ?? 'unknown'} | ${g.totalObservedTokens ?? 'unknown'} (${g.observedTokenRuns}) | ${g.medianDurationMs ?? 'unknown'} | ${g.completeUsageRuns} / ${g.runs} | ${g.scopeViolations} | ${g.delegationsPerRun ?? 'unknown'} |`,
    );
  lines.push(
    '',
    '| Strategy | Input / output / reasoning / cache read / cache write (observed tokens; runs) | Provider retries | Child retries | Repairs | Incomplete lifecycle |',
    '|---|---|---:|---:|---:|---:|',
  );
  for (const g of comparison(results))
    lines.push(
      `| ${g.strategy} | ${Object.values(g.tokenCategories)
        .map((v) => `${v.totalObserved ?? 'unknown'} (${v.observedRuns})`)
        .join(
          ' / ',
        )} | ${g.providerRetries.totalObserved ?? 'unknown'} (${g.providerRetries.observedRuns}) | ${g.delegationRetries.totalObserved ?? 'unknown'} (${g.delegationRetries.observedRuns}) | ${g.repairs.totalObserved ?? 'unknown'} (${g.repairs.observedRuns}) | ${g.incompleteLifecycleRuns} |`,
    );
  lines.push(
    '',
    '| Case | Repeat | Strategy | Runtime | Behavior | Regression | Scope | Policy | Verified | USD | ms |',
    '|---|---:|---|---|---|---|---|---|---|---:|---:|',
  );
  for (const r of results)
    lines.push(
      `| ${r.id} | ${r.repeat} | ${r.strategy} | ${r.runtimeOutcome ?? 'unknown'} | ${r.behaviorPassed} | ${r.regressionPassed} | ${r.scopePassed} | ${r.policyPassed} | ${r.passed} | ${r.totalWorkflowCost ?? 'unknown'} | ${r.durationMs} |`,
    );
  lines.push(
    '',
    '| Case | Matched pairs | Paired USD difference mean / sample SD | DIRECT ms min–max | SELECTIVE ms min–max |',
    '|---|---:|---|---|---|',
  );
  for (const c of caseComparisons(results))
    lines.push(
      `| ${c.id} | ${c.pairs.filter((p) => p.matched).length} / ${c.pairs.length} | ${c.costDifferenceVariabilityUSD.mean ?? 'unknown'} / ${c.costDifferenceVariabilityUSD.sampleStandardDeviation ?? 'unknown'} | ${c.strategies[0].durationVariabilityMs.min ?? 'unknown'}–${c.strategies[0].durationVariabilityMs.max ?? 'unknown'} | ${c.strategies[1].durationVariabilityMs.min ?? 'unknown'}–${c.strategies[1].durationVariabilityMs.max ?? 'unknown'} |`,
    );
  lines.push(
    '',
    'Observed cost includes known costs of failed and interrupted attempts. Cost per verified success includes every attempt in the strategy and requires complete cost, correlation and lifecycle coverage; token coverage is separate. Paired differences are SELECTIVE minus DIRECT. Variability is descriptive, not statistical significance. Missing measurements remain unknown. Costs are native counter estimates, not provider invoices.',
    '',
    'This synthetic brownfield baseline does not represent large real-world repositories. Results are descriptive; model randomness and task selection preclude claims of strategy superiority.',
    '',
    'Usage issues:',
  );
  for (const r of results.filter((r) => r.usageIssues.length || r.activityIssues?.length))
    lines.push(
      `- ${r.id} / ${r.strategy} / ${r.repeat}: ${[...r.usageIssues, ...(r.activityIssues ?? [])].join(', ')}`,
    );
  return lines.join('\n') + '\n';
}

export interface EvaluationTool {
  id: string;
  name: string;
  state: {
    status: string;
    input?: Record<string, unknown> | string;
    content?: Array<{ type: string; text?: string }>;
  };
}
export function evaluationActivity(run: Run | null, tools: EvaluationTool[] | null) {
  const repairsByTask = new Map<string, number>();
  let repairsKnown =
    tools !== null &&
    (!run ||
      (run.tools.aorchestra_task ?? 0) <= tools.filter((t) => t.name === 'aorchestra_task').length);
  for (const tool of tools ?? []) {
    if (
      tool.name !== 'aorchestra_task' ||
      typeof tool.state.input !== 'object' ||
      tool.state.input?.operation !== 'repair'
    )
      continue;
    let observed = false;
    if (tool.state.status === 'completed') {
      for (const content of tool.state.content ?? []) {
        if (content.type !== 'text') continue;
        try {
          const response = JSON.parse(content.text ?? '');
          for (const task of response.tasks ?? []) {
            if (
              typeof task.id === 'string' &&
              Number.isInteger(task.workflow?.repairs) &&
              task.workflow.repairs >= 0
            ) {
              repairsByTask.set(
                task.id,
                Math.max(repairsByTask.get(task.id) ?? 0, task.workflow.repairs),
              );
              observed = true;
            }
          }
        } catch {}
      }
    }
    if (!observed) repairsKnown = false;
  }
  return {
    toolActivity: run?.tools ?? null,
    providerRetries: run?.providerRetries ?? null,
    delegationRetries: run
      ? new Set(run.children.filter((c) => c.attempt > 1).map((c) => c.sessionID)).size
      : null,
    repairs: repairsKnown ? [...repairsByTask.values()].reduce((a, b) => a + b, 0) : null,
  };
}
