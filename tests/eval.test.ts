import { expect, test } from 'bun:test';
import {
  comparison,
  caseComparisons,
  evaluationActivity,
  evaluationMarkdown,
  evaluationPolicy,
  evaluationOutcome,
  reconcileEvaluation,
  type EvaluationResult,
} from '../lib/eval-report';
import { trajectorySessionIDs } from '../scripts/eval-usage';
import { fileURLToPath } from 'node:url';
import type { Run } from '../lib/telemetry';
const row = (overrides: Partial<EvaluationResult> = {}): EvaluationResult => ({
  id: 'case',
  strategy: 'direct',
  repeat: 1,
  passed: true,
  executionConfirmed: true,
  behaviorPassed: true,
  regressionPassed: true,
  policyPassed: true,
  scopePassed: true,
  changedPaths: [],
  delegations: 0,
  durationMs: 10,
  totalWorkflowCost: 2,
  totalWorkflowTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  usageComplete: true,
  costComplete: overrides.usageComplete ?? true,
  lifecycleComplete: true,
  providerRetries: 0,
  delegationRetries: 0,
  repairs: 0,
  toolActivity: {},
  settingsFingerprint: 'matched',
  usageIssues: [],
  missingSessions: [],
  sessionID: 'primary',
  runID: 'run',
  runtimeOutcome: 'succeeded',
  error: null,
  independentCheck: '',
  workspace: 'fixture',
  ...overrides,
});

test('comparison includes costs of failed assertions and only divides complete cohorts', () => {
  const rows = [
    row(),
    row({ repeat: 2, passed: false, behaviorPassed: false, totalWorkflowCost: 3, durationMs: 30 }),
    row({ strategy: 'selective', totalWorkflowCost: 0 }),
  ];
  const groups = comparison(rows);
  expect(groups[0]).toMatchObject({
    strategy: 'direct',
    runs: 2,
    verifiedSuccesses: 1,
    verifiedSuccessRate: 0.5,
    totalObservedCostUSD: 5,
    totalObservedTokens: 0,
    observedTokenRuns: 2,
    totalDelegations: 0,
    missingUsageRuns: 0,
    observedCostRuns: 2,
    completeUsageRuns: 2,
    usageCoverage: 1,
    costPerVerifiedSuccessUSD: 5,
    comparisonComplete: true,
    medianDurationMs: 20,
    scopeViolations: 0,
    delegationsPerRun: 0,
  });
  expect(groups[1].costPerVerifiedSuccessUSD).toBe(0);
  const incomplete = comparison([
    ...rows,
    row({ usageComplete: false, totalWorkflowCost: null, scopePassed: false, passed: false }),
  ])[0];
  expect(incomplete.totalObservedCostUSD).toBe(5);
  expect(incomplete.totalCostUSD).toBeNull();
  expect(incomplete.costPerVerifiedSuccessUSD).toBe(null);
  expect(incomplete.usageCoverage).toBe(2 / 3);
  expect(incomplete.scopeViolations).toBe(1);
  expect(comparison([row({ passed: false })])[0].costPerVerifiedSuccessUSD).toBe(null);
  expect(comparison([])[0].totalObservedCostUSD).toBe(null);
  expect(evaluationMarkdown(rows)).toBe(evaluationMarkdown(rows));
});

test('known interrupted cost and absent tokens remain observed but comparison is incomplete', () => {
  const result = row({
    usageComplete: false,
    usageIssues: ['execution-interrupted'],
    passed: false,
    totalWorkflowCost: 4,
    totalWorkflowTokens: null,
  });
  expect(comparison([result])[0].totalObservedCostUSD).toBe(4);
  expect(comparison([result])[0].comparisonComplete).toBe(false);
  expect(evaluationMarkdown([result])).toContain('execution-interrupted');
});

test('DIRECT policy rejects native or CLI delegation even when telemetry records no children', async () => {
  const { Telemetry } = await import('../lib/telemetry');
  const data = new Map<string, unknown>();
  const telemetry = new Telemetry({
    get: async (k) => data.get(k),
    set: async (k, v) => {
      data.set(k, v);
    },
    scan: async () => ({ entries: [] }),
  });
  const zero = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  await telemetry.begin('primary', 1, zero);
  await telemetry.finish('primary', 'succeeded', zero, [], 'end', 2);
  const records = [...data.entries()]
    .filter(([key]) => key.startsWith('metrics/run/'))
    .map(([, value]) => value as Run);
  const family = [{ id: 'primary' }, { id: 'child', parentID: 'primary' }];
  expect(reconcileEvaluation('primary', records, family).issues).toContain(
    'unrecorded-native-child:child',
  );
  expect(evaluationPolicy('direct', 'primary', records, family, 0)).toEqual({
    delegations: 1,
    passed: false,
  });
  expect(evaluationPolicy('direct', 'primary', records, [{ id: 'primary' }], 1)).toEqual({
    delegations: 1,
    passed: false,
  });
  expect(evaluationPolicy('direct', null, [], [], 1)).toEqual({ delegations: 1, passed: false });
  expect(evaluationPolicy('selective', 'primary', records, family, 1)).toEqual({
    delegations: 1,
    passed: true,
  });
  expect(evaluationPolicy('direct', 'primary', records, [{ id: 'primary' }], 0)).toEqual({
    delegations: 0,
    passed: true,
  });
  const child = {
    sessionID: 'child',
    taskID: 'fix',
    tier: 'fast',
    attempt: 1,
    ref: 'delegate',
    outcome: 'succeeded',
    usage: zero,
  };
  const observed = { ...records[0], children: [child, child] };
  expect(evaluationPolicy('direct', 'primary', [observed, observed], family, 1)).toEqual({
    delegations: 1,
    passed: false,
  });
  expect(evaluationPolicy('direct', 'primary', [observed], [], 0)).toEqual({
    delegations: 1,
    passed: false,
  });
  expect(
    evaluationPolicy(
      'direct',
      'primary',
      [{ ...observed, sessionID: 'unrelated' }],
      [{ id: 'primary' }],
      0,
    ),
  ).toEqual({ delegations: 0, passed: true });
});

test('native trajectory identity ignores non-JSON logs and empty failure IDs', () => {
  expect(
    trajectorySessionIDs(
      'log\n{"sessionID":""}\n{"sessionID":"a"}\n{"sessionID":"a"}\n{"sessionID":"b"}\n',
    ),
  ).toEqual(['a', 'b']);
});

test('CLI failures preserve streamed partial trajectory for reconciliation', async () => {
  // Use the existing CLI wrapper with a provider-free recording executable.
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'aorchestra-eval-command-'));
  try {
    const script = join(dir, 'fail.ts');
    await writeFile(
      script,
      'console.log(JSON.stringify({sessionID:"native-session"}));process.exit(1);',
    );
    const child = Bun.spawn(
      [
        process.execPath,
        '-e',
        `const {command}=await import(${JSON.stringify(fileURLToPath(new URL('../scripts/runtime.ts', import.meta.url)))});let output='';try{await command([${JSON.stringify(script)}],${JSON.stringify(dir)},10000,process.env,chunk=>output+=chunk);}catch{}console.log(output.trim());`,
      ],
      { env: { ...process.env, OPENCODE_BIN: process.execPath }, stdout: 'pipe', stderr: 'pipe' },
    );
    const [output, exit] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    expect(exit).toBe(0);
    expect(JSON.parse(output).sessionID).toBe('native-session');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === 'win32')(
  'CLI timeout requests native interruption and preserves terminal output',
  async () => {
    const result = await timeoutFixture(
      `process.on('SIGINT',()=>{console.log('native-interrupted');process.exit(130)});console.log('started');setInterval(()=>{},1000);`,
    );
    expect(result.error).toBe('CLI_TIMEOUT');
    expect(result.output).toContain('started');
    expect(result.output).toContain('native-interrupted');
    expect(result.elapsed).toBeLessThan(5000);
  },
  10000,
);

test.skipIf(process.platform === 'win32')(
  'CLI timeout force-terminates a process ignoring native interruption after bounded grace',
  async () => {
    const result = await timeoutFixture(
      `process.on('SIGINT',()=>{});console.log('started');setInterval(()=>{},1000);setTimeout(()=>process.exit(0),9000);`,
    );
    expect(result.error).toBe('CLI_TIMEOUT');
    expect(result.output).toContain('started');
    expect(result.elapsed).toBeGreaterThanOrEqual(5000);
    expect(result.elapsed).toBeLessThan(8500);
  },
  12000,
);

async function timeoutFixture(source: string) {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'aorchestra-eval-timeout-'));
  try {
    const script = join(dir, 'fixture.js');
    await writeFile(script, source);
    const child = Bun.spawn(
      [
        process.execPath,
        '-e',
        `const {command}=await import(${JSON.stringify(fileURLToPath(new URL('../scripts/runtime.ts', import.meta.url)))});let output='',error=null;const started=Date.now();try{await command([${JSON.stringify(script)}],${JSON.stringify(dir)},500,process.env,chunk=>output+=chunk);}catch(e){error=e.message;}console.log(JSON.stringify({output,error,elapsed:Date.now()-started}));`,
      ],
      {
        // Use the actual executable, not a PATH shim that may retain a child
        // process and swallow signals sent to the shim itself.
        env: { ...process.env, OPENCODE_BIN: process.execPath },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [output, error, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(error).toBe('');
    expect(exit).toBe(0);
    return JSON.parse(output) as { output: string; error: string | null; elapsed: number };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('native reconciliation exhausts boundary cursors and paginated telemetry without inference', async () => {
  const { readEvaluationUsage } = await import('../scripts/eval-usage');
  const { Telemetry } = await import('../lib/telemetry');
  const data = new Map<string, unknown>();
  const telemetry = new Telemetry({
    get: async (k) => data.get(k),
    set: async (k, v) => {
      data.set(k, v);
    },
    scan: async () => ({ entries: [] }),
  });
  const zero = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  await telemetry.begin('primary', 1, zero);
  await telemetry.finish('primary', 'succeeded', zero, [], 'end', 2);
  const run = [...data.entries()].find(([key]) => key.startsWith('metrics/run/'))![1];
  const calls: string[] = [];
  const connect: Parameters<typeof readEvaluationUsage>[3] = async () => ({
    client: {
      message: {
        list: async (input: { cursor?: string }) => {
          calls.push(`messages:${input.cursor ?? ''}`);
          return {
            data: [
              {
                type: 'assistant',
                content: [
                  {
                    id: 'repair-call',
                    type: 'tool',
                    name: 'aorchestra_task',
                    state: {
                      status: 'completed',
                      input: { operation: 'repair' },
                      content: [
                        {
                          type: 'text',
                          text: JSON.stringify({
                            tasks: [{ id: 'fix', workflow: { repairs: input.cursor ? 2 : 1 } }],
                          }),
                        },
                      ],
                    },
                  },
                ],
              },
            ],
            cursor: input.cursor ? {} : { next: 'tools-next' },
          };
        },
      },
      session: {
        list: async (input: { parentID?: string | null; cursor?: string }) => {
          calls.push(`session:${input.parentID}:${input.cursor ?? ''}`);
          return input.parentID === null && !input.cursor
            ? {
                data: [{ id: 'primary', agent: 'aorchestra', outcome: 'succeeded' }],
                cursor: { next: 'last-boundary' },
              }
            : { data: [], cursor: {} };
        },
        create: async () => ({ id: 'bootstrap' }),
        remove: async () => {
          calls.push('remove');
        },
      },
      rpc: () => ({
        list: async (input: { after?: string }) => {
          calls.push(`metrics:${input.after ?? ''}`);
          return input.after
            ? { version: 1, runs: [run], next: null }
            : {
                version: 1,
                runs: [{ ...(run as object), sessionID: 'unrelated', id: 'other' }],
                next: 'next',
              };
        },
      }),
    } as unknown as Awaited<
      ReturnType<NonNullable<Parameters<typeof readEvaluationUsage>[3]>>
    >['client'],
    close: async () => {
      calls.push('close');
    },
  });
  const measured = await readEvaluationUsage('fixture', {}, '{"sessionID":"primary"}', connect);
  expect(measured.sessionID).toBe('primary');
  expect(measured.complete).toBe(true);
  expect(measured.usage.costUSD).toBe(0);
  expect(measured.records.length).toBe(1);
  expect(measured.repairs).toBe(2);
  expect(measured.activityIssues).toEqual([]);
  expect(calls).toContain('messages:tools-next');
  expect(calls).toContain('session:null:last-boundary');
  expect(calls).toContain('metrics:next');
  expect(calls.slice(-2)).toEqual(['remove', 'close']);
  await expect(
    readEvaluationUsage('fixture', {}, '{"sessionID":"different"}', connect),
  ).rejects.toThrow('EVALUATION_TRAJECTORY_SESSION_MISMATCH');
});

test('evaluation requires explicit runtime success independently of usage coverage', () => {
  for (const runtimeOutcome of [null, 'running', 'failed', 'interrupted', 'succeeded'] as const) {
    const result = row({ runtimeOutcome, usageComplete: false, totalWorkflowCost: null });
    expect(evaluationOutcome(result, true)).toEqual({
      executionConfirmed: runtimeOutcome === 'succeeded',
      passed: runtimeOutcome === 'succeeded',
    });
  }
  for (const overrides of [
    { error: 'CLI failed' },
    { behaviorPassed: false },
    { regressionPassed: false },
    { scopePassed: false },
  ]) {
    expect(evaluationOutcome(row(overrides), true)).toEqual({
      executionConfirmed: true,
      passed: false,
    });
  }
  expect(evaluationOutcome(row(), false)).toEqual({ executionConfirmed: true, passed: false });
});

test('token totals expose partial coverage and preserve measured zero', () => {
  const g = comparison([
    row({ totalWorkflowTokens: 347000, delegations: 2 }),
    row({
      passed: false,
      totalWorkflowTokens: null,
      usageComplete: false,
      usageIssues: ['missing-usage-counters'],
    }),
  ])[0];
  expect(g.totalObservedTokens).toBe(347000);
  expect(g.observedTokenRuns).toBe(1);
  expect(g.totalDelegations).toBe(2);
  expect(g.missingUsageRuns).toBe(1);
  expect(g.costPerVerifiedSuccessUSD).toBeNull();
  expect(comparison([row({ totalWorkflowTokens: null })])[0].totalObservedTokens).toBeNull();
  expect(comparison([row()])[0].totalObservedTokens).toBe(0);
});

test('paired case comparisons retain failures, unmatched attempts and descriptive variability', () => {
  const rows = [
    row(),
    row({ strategy: 'selective', totalWorkflowCost: 4, durationMs: 20 }),
    row({ repeat: 2, totalWorkflowCost: 1, passed: false }),
    row({ repeat: 2, strategy: 'selective', totalWorkflowCost: 2, durationMs: 40 }),
    row({ id: 'other', totalWorkflowCost: null, costComplete: false }),
  ];
  const cases = caseComparisons(rows);
  expect(cases[0].pairs.map((p) => p.costDifferenceUSD)).toEqual([2, 1]);
  expect(cases[0].costDifferenceVariabilityUSD.mean).toBe(1.5);
  expect(cases[0].costDifferenceVariabilityUSD.sampleStandardDeviation).toBeCloseTo(Math.sqrt(0.5));
  expect(cases[0].strategies[0].costPerVerifiedSuccessUSD).toBe(3);
  expect(cases[1].pairs[0].matched).toBe(false);
  expect(cases[1].pairs[0].costDifferenceUSD).toBeNull();
  expect(
    caseComparisons([row(), row({ strategy: 'selective', settingsFingerprint: 'changed' })])[0]
      .pairs[0].costDifferenceUSD,
  ).toBeNull();
  expect(caseComparisons([row(), row(), row({ strategy: 'selective' })])[0].pairs[0].matched).toBe(
    false,
  );
  expect(evaluationMarkdown(rows)).toContain('| Case | Repeat | Strategy |');
  expect(evaluationMarkdown(rows)).toContain('Paired USD difference');
});

test('complete cost coverage is separate from missing token categories', () => {
  const result = row({
    usageComplete: false,
    costComplete: true,
    totalWorkflowTokens: null,
    inputTokens: null,
    reasoningTokens: null,
  });
  const g = comparison([result, row({ passed: false, totalWorkflowCost: 3 })])[0];
  expect(g.costPerVerifiedSuccessUSD).toBe(5);
  expect(g.totalCostUSD).toBe(5);
  expect(g.tokenCategories.inputTokens).toEqual({ totalObserved: 0, observedRuns: 1 });
  expect(g.completeUsageRuns).toBe(1);
  expect(g.completeCostRuns).toBe(2);
  expect(
    comparison([row({ costComplete: false, totalWorkflowCost: 0 })])[0].costPerVerifiedSuccessUSD,
  ).toBeNull();
});

test('activity counts retry children once and repairs from durable counters; unknowns stay null', () => {
  const base = {
    tools: { aorchestra_task: 2 },
    providerRetries: 2,
    children: [
      { sessionID: 'child', attempt: 2 },
      { sessionID: 'child', attempt: 2 },
    ],
  } as unknown as Run;
  const tool = (id: string, repairs: number) => ({
    id,
    name: 'aorchestra_task',
    state: {
      status: 'completed',
      input: { operation: 'repair' },
      content: [
        { type: 'text', text: JSON.stringify({ tasks: [{ id: 'fix', workflow: { repairs } }] }) },
      ],
    },
  });
  expect(evaluationActivity(base, [tool('one', 1), tool('two', 2)])).toEqual({
    toolActivity: base.tools,
    providerRetries: 2,
    delegationRetries: 1,
    repairs: 2,
  });
  expect(evaluationActivity(base, null).repairs).toBeNull();
  expect(evaluationActivity(null, null).providerRetries).toBeNull();
  expect(evaluationActivity(base, []).repairs).toBeNull();
  expect(evaluationActivity({ ...base, tools: {} }, []).repairs).toBe(0);
  expect(
    evaluationActivity(base, [
      {
        id: 'failed',
        name: 'aorchestra_task',
        state: { status: 'error', input: { operation: 'repair' } },
      },
    ]).repairs,
  ).toBeNull();
});

test('paired order alternates and performance smoke validation requires both protocols', async () => {
  const { evaluationOrder, smokeCompatible } = await import('../scripts/eval-fixture');
  expect(evaluationOrder(3, 'both')).toEqual([
    { repeat: 1, strategies: ['direct', 'selective'] },
    { repeat: 2, strategies: ['selective', 'direct'] },
    { repeat: 3, strategies: ['direct', 'selective'] },
  ]);
  expect(evaluationOrder(2, 'selective')).toEqual([
    { repeat: 1, strategies: ['selective'] },
    { repeat: 2, strategies: ['selective'] },
  ]);
  const smoke = {
    conditions: { phase: 'smoke', harnessSourceSHA256: 'source' },
    results: [row(), row({ strategy: 'selective' })],
  };
  expect(smokeCompatible(smoke, 'matched', 'source')).toBe(true);
  expect(smokeCompatible({ ...smoke, results: [row()] }, 'matched', 'source')).toBe(false);
  expect(smokeCompatible(smoke, 'changed', 'source')).toBe(false);
  expect(smokeCompatible(smoke, 'matched', 'different')).toBe(false);
  expect(
    smokeCompatible(
      { ...smoke, results: [row({ regressionPassed: false }), row({ strategy: 'selective' })] },
      'matched',
      'source',
    ),
  ).toBe(false);
  expect(smokeCompatible(null, 'matched', 'source')).toBe(false);
});

test('smoke is a readiness gate across cases and splits, independent of usage coverage', async () => {
  const { smokeCompatible } = await import('../scripts/eval-fixture');
  const report = {
    conditions: {
      phase: 'smoke',
      harnessSourceSHA256: 'source',
      split: 'development',
      corpusSHA256: 'smoke-corpus',
    },
    results: [
      row({ id: 'smoke-direct', usageComplete: false, costComplete: false }),
      row({ id: 'smoke-selective', strategy: 'selective', usageComplete: false }),
      row({ id: 'failed-case', passed: false }),
    ],
  };
  expect(smokeCompatible(report, 'matched', 'source')).toBe(true);
  for (const gate of [
    'passed',
    'executionConfirmed',
    'behaviorPassed',
    'regressionPassed',
    'scopePassed',
    'policyPassed',
  ] as const) {
    expect(
      smokeCompatible(
        { ...report, results: [row({ [gate]: false }), row({ strategy: 'selective' })] },
        'matched',
        'source',
      ),
    ).toBe(false);
  }
  expect(
    smokeCompatible(
      { ...report, conditions: { ...report.conditions, phase: 'benchmark' } },
      'matched',
      'source',
    ),
  ).toBe(false);
});

test('native session preparation preserves shared permissions and fails closed on unenforced DIRECT denial', async () => {
  const { prepareEvaluationSession, evaluationPermissions } = await import('../scripts/eval-usage');
  const base = [
    { action: '*', resource: '*', effect: 'ask' as const },
    { action: 'read', resource: '*', effect: 'allow' as const },
    { action: 'aorchestra_delegate', resource: '*', effect: 'allow' as const },
  ];
  expect(evaluationPermissions(base, 'selective')).toEqual(base);
  expect(evaluationPermissions(base, 'direct').slice(0, base.length)).toEqual(base);
  expect(base).toHaveLength(3);
  const created: any[] = [];
  let closes = 0;
  let enforced = true;
  const connect: NonNullable<Parameters<typeof prepareEvaluationSession>[4]> = async () => ({
    client: {
      location: { get: async () => ({}) },
      plugin: { list: async () => ({ data: [{ id: 'aorchestra', state: { status: 'active' } }] }) },
      agent: { list: async () => ({ data: [{ id: 'aorchestra', permissions: base }] }) },
      config: { get: async () => [{ type: 'document', info: { model: 'test/model' } }] },
      session: {
        update: async ({ permissions }: any) => {
          created[created.length - 1].permissions = permissions;
        },
        create: async (input: any) => {
          created.push(input);
          return { id: 'primary' };
        },
      },
      permission: { create: async () => ({ effect: enforced ? 'deny' : 'allow' }) },
    } as any,
    close: async () => {
      closes++;
    },
  });
  const direct = await prepareEvaluationSession('fixture', {}, 'direct', 'test/model', connect);
  const selective = await prepareEvaluationSession(
    'fixture',
    {},
    'selective',
    'test/model',
    connect,
  );
  expect(direct.settings).toEqual(selective.settings);
  expect(created[0].model).toEqual(created[1].model);
  expect(created[0].permissions.slice(-2)).toEqual([
    { action: 'aorchestra_delegate', resource: '*', effect: 'deny' },
    { action: 'subagent', resource: '*', effect: 'deny' },
  ]);
  expect(created[1].permissions).toEqual(base);
  enforced = false;
  await expect(
    prepareEvaluationSession('fixture', {}, 'direct', 'test/model', connect),
  ).rejects.toThrow('EVALUATION_DIRECT_PERMISSION_NOT_ENFORCED');
  expect(closes).toBe(3);
});

test('native reconciliation distinguishes complete costs from absent tokens and interrupted lifecycle', async () => {
  const { Telemetry } = await import('../lib/telemetry');
  const data = new Map<string, unknown>();
  const telemetry = new Telemetry({
    get: async (k) => data.get(k),
    set: async (k, v) => {
      data.set(k, v);
    },
    scan: async () => ({ entries: [] }),
  });
  const missing = {
    cost: 0,
    input: null,
    output: null,
    reasoning: null,
    cacheRead: null,
    cacheWrite: null,
  };
  await telemetry.begin('primary', 1, missing);
  await telemetry.finish('primary', 'succeeded', { ...missing, cost: 2 }, [], 'end', 2);
  const record = [...data.entries()].find(([key]) => key.startsWith('metrics/run/'))![1] as Run;
  const observed = reconcileEvaluation('primary', [record], [{ id: 'primary' }]);
  expect(observed.complete).toBe(false);
  expect(observed.costComplete).toBe(true);
  expect(observed.usage.totalTokens).toBeNull();
  expect(observed.usage.costUSD).toBe(2);
  expect(
    reconcileEvaluation(
      'primary',
      [{ ...record, runtimeOutcome: 'interrupted' }],
      [{ id: 'primary' }],
    ).costComplete,
  ).toBe(false);
});
