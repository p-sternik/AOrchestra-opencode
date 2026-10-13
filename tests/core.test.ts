import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import {
  Ledger,
  inside,
  parseResult,
  permissionRules,
  ready,
  registerTask,
  reserve,
  validateTools,
  validateHandoff,
  verifierPassed,
  type State,
  type Task,
} from '../lib/core';
const task = (id = 'fix'): Task => ({
  id,
  kind: 'change',
  instruction: 'Preserve old API and fix the bug',
  context: '',
  dependsOn: [],
  writePaths: ['src/api.ts'],
  preserve: ['Existing caller remains supported'],
  verifiers: [
    {
      id: 'tests',
      tool: 'shell',
      input: { command: 'bun test tests/api.test.ts' },
      expect: { exitCode: 0 },
    },
  ],
  status: 'pending',
  attempts: [],
  receipts: {},
});
const state = (): State => ({ version: 1, revision: 0, delegations: 0, tasks: [] });
const event = (exitCode: unknown = 0) => ({
  tool: 'shell',
  input: { command: 'bun test tests/api.test.ts' },
  status: 'completed',
  result: { metadata: { exitCode } },
});

test('Windows and POSIX containment rejects sibling prefix, parent traversal and another drive', () => {
  expect(inside('C:\\repo', 'C:\\repo\\src\\api.ts')).toBe(true);
  expect(inside('C:\\repo', 'C:\\repository\\src')).toBe(false);
  expect(inside('C:\\repo', 'D:\\repo\\src')).toBe(false);
  expect(inside('/repo', '/repo/src/api.ts')).toBe(true);
  expect(inside('/repo', '/repo-other/file')).toBe(false);
});
test('failed or unknown exit code cannot verify a completed native shell call', () => {
  const v = task().verifiers[0];
  expect(verifierPassed(v, event(1))).toBe(false);
  expect(verifierPassed(v, { ...event(), result: { metadata: {} } })).toBe(false);
  expect(verifierPassed(v, { ...event(), result: { content: 'all tests passed' } })).toBe(false);
  expect(verifierPassed(v, event(0))).toBe(true);
});
test('a successful unrelated command is not the declared verifier', () => {
  expect(
    verifierPassed(task().verifiers[0], { ...event(), input: { command: 'echo tests passed' } }),
  ).toBe(false);
  expect(verifierPassed(task().verifiers[0], { ...event(), status: 'error' })).toBe(false);
});
test('shell evidence binds omitted and explicit workdirs to the session location', () => {
  const root = resolve('review-project'),
    other = resolve(root, 'other');
  const verifier = task().verifiers[0];
  for (const workdir of [undefined, '.', root]) {
    expect(
      verifierPassed(
        verifier,
        { ...event(), input: { ...verifier.input, ...(workdir === undefined ? {} : { workdir }) } },
        root,
      ),
    ).toBe(true);
  }
  expect(
    verifierPassed(verifier, { ...event(), input: { ...verifier.input, workdir: other } }, root),
  ).toBe(false);
  expect(
    verifierPassed(verifier, { ...event(), input: { ...verifier.input, workdir: null } }, root),
  ).toBe(false);
  const nested = { ...verifier, input: { ...verifier.input, workdir: other } };
  expect(verifierPassed(nested, event(), root)).toBe(false);
  expect(
    verifierPassed(nested, { ...event(), input: { ...verifier.input, workdir: 'other' } }, root),
  ).toBe(true);
});
test('read verifier requires observed content and matching input', () => {
  const v = {
    id: 'read',
    tool: 'read',
    input: { filePath: 'src/api.ts' },
    expect: { contains: 'export function oldApi' },
  };
  expect(
    verifierPassed(v, {
      tool: 'read',
      input: v.input,
      status: 'completed',
      result: { content: 'export function oldApi' },
    }),
  ).toBe(true);
  expect(verifierPassed(v, { tool: 'read', input: v.input, status: 'completed', result: {} })).toBe(
    false,
  );
});
test('analysis cannot get shell, Code Mode, edits or MCP mutations', () => {
  const t = { ...task(), kind: 'analysis' as const, writePaths: [] };
  for (const tool of ['shell', 'execute', 'patch', 'atlassian_update_issue'])
    expect(() => validateTools(t, [tool], new Set([tool]))).toThrow();
  validateTools(t, ['read', 'grep'], new Set(['read', 'grep']));
});
test('change worker cannot get arbitrary shell or delegate', () => {
  for (const tool of ['shell', 'subagent', 'aorchestra_delegate'])
    expect(() => validateTools(task(), [tool], new Set([tool]))).toThrow();
});
test('native rules have exact edit paths and finish with an external-directory denial', () => {
  const rules = permissionRules({
    owner: 'owner',
    taskId: 'fix',
    root: process.cwd(),
    kind: 'change',
    writePaths: ['src/api.ts'],
    tools: ['read', 'patch'],
  });
  expect(rules[0]).toEqual({ action: '*', resource: '*', effect: 'deny' });
  expect(
    rules.filter((r) => r.action === 'edit' && r.effect === 'allow').map((r) => r.resource),
  ).toContain('src/api.ts');
  expect(rules.some((r) => r.action === 'shell' && r.effect === 'allow')).toBe(false);
  expect(rules.at(-1)?.action).toBe('external_directory');
});
test('result protocol rejects empty evidence and does not accept contradictory COMPLETE', () => {
  expect(() =>
    parseResult('STATUS: COMPLETE\nRESULT: fixed\nEVIDENCE:\nCHANGED: src/api.ts\nOPEN: none'),
  ).toThrow();
  expect(() =>
    parseResult(
      'STATUS: COMPLETE\nRESULT: fixed\nEVIDENCE: file read\nCHANGED: src/api.ts\nOPEN: tests not run',
    ),
  ).toThrow();
  expect(
    parseResult(
      'STATUS: PARTIAL\nRESULT: fixed\nEVIDENCE: observed diff\nCHANGED: src/api.ts\nOPEN: primary validation',
    ).status,
  ).toBe('PARTIAL');
});
test('dependencies require accepted tasks; registration rejects cycles by allowing older dependencies only', () => {
  const s = state();
  registerTask(s, task('producer'));
  const consumer = task('consumer');
  consumer.dependsOn = ['producer'];
  registerTask(s, consumer);
  expect(() => ready(s, consumer)).toThrow('DEPENDENCY_UNMET');
  s.tasks[0].status = 'complete';
  ready(s, consumer);
  const invalid = task('invalid');
  invalid.dependsOn = ['invalid'];
  expect(() => registerTask(s, invalid)).toThrow();
});
test('scope registration forbids wildcard patterns, traversal and sensitive files', () => {
  for (const path of ['../file', 'src/*', '.env', '.opencode/plugin.ts', 'C:/file'])
    expect(() => registerTask(state(), { ...task(), writePaths: [path] })).toThrow();
});
test('fast-to-strong requires an explicit escalation reason while retaining the two-attempt budget', () => {
  const s = state();
  const t = task();
  registerTask(s, t);
  reserve(s, t, 'fast', 'settled procedure', '', 8, 2);
  t.attempts[0].status = 'error';
  t.status = 'blocked';
  expect(() => reserve(s, t, 'strong', 'reasoning gap', 'new evidence', 8, 2)).toThrow(
    'ESCALATION_REASON_REQUIRED',
  );
  reserve(
    s,
    t,
    'strong',
    'New consumer changes the compatibility assessment',
    'Observed a previously missed public consumer',
    8,
    2,
    'compatibility-risk',
  );
  expect(t.attempts[1].escalationReason).toBe('compatibility-risk');
  t.attempts[1].status = 'error';
  t.status = 'blocked';
  expect(() => reserve(s, t, 'strong', 'retry', 'another finding', 8, 2)).toThrow(
    'BUDGET_EXCEEDED',
  );
});
test('a stronger retry still requires delta and does not allow tier downgrades', () => {
  const s = state(),
    t = task();
  registerTask(s, t);
  reserve(s, t, 'balanced', 'Interpret consumers', '', 8, 2);
  t.status = 'blocked';
  t.attempts[0].status = 'error';
  expect(() => reserve(s, t, 'strong', 'retry', '', 8, 2, 'reasoning-gap')).toThrow(
    'ROUTING_REASON_AND_RETRY_DELTA_REQUIRED',
  );
  expect(() => reserve(s, t, 'fast', 'cheaper', 'new data', 8, 2)).toThrow('TIER_DOWNGRADE_DENIED');
});
test('fast research is restricted to declared lookups, not synthesis', () => {
  const t = {
      ...task(),
      kind: 'analysis' as const,
      writePaths: [],
      analysisMode: 'synthesis' as const,
    },
    s = state();
  registerTask(s, t);
  expect(() => reserve(s, t, 'fast', 'Research', '', 8, 2)).toThrow(
    'FAST_RESEARCH_REQUIRES_LOOKUP_MODE',
  );
  const lookup = { ...t, id: 'lookup', analysisMode: 'lookup' as const };
  registerTask(s, lookup);
  reserve(s, lookup, 'fast', 'Locate all callers', '', 8, 2);
  expect(lookup.attempts[0].tier).toBe('fast');
  expect(s.delegations).toBe(1);
});
test('source handoff distinguishes candidates and unknown revisions and rejects unusable or excessive input', () => {
  const handoff = {
    sources: [{ ref: 'src/api.ts', status: 'candidate' as const, revision: 'unknown' }],
    facts: [],
    unknowns: ['Find current callers'],
    checks: ['Not run'],
  };
  validateHandoff(handoff);
  expect(() => validateHandoff({ ...handoff, sources: [] })).toThrow('HANDOFF_SOURCES_INVALID');
  expect(() =>
    validateHandoff({ ...handoff, sources: [{ ...handoff.sources[0], revision: ' ' }] }),
  ).toThrow('HANDOFF_SOURCES_INVALID');
  expect(() =>
    validateHandoff({ ...handoff, facts: Array.from({ length: 10 }, () => 'x'.repeat(1500)) }),
  ).toThrow('HANDOFF_TOO_LARGE');
});
test('retry requires delta; independent task waits for acceptance and is not a retry', () => {
  const s = state();
  const first = task();
  registerTask(s, first);
  reserve(s, first, 'fast', 'settled', '', 8, 2);
  first.status = 'review';
  first.attempts[0].status = 'review';
  expect(() => reserve(s, first, 'fast', 'retry', '', 8, 2)).toThrow();
  const second = task('other');
  registerTask(s, second);
  expect(() => reserve(s, second, 'fast', 'independent', '', 8, 2)).toThrow('ACTIVE_TASK_EXISTS');
  expect(s.delegations).toBe(1);
  expect(second.attempts).toHaveLength(0);
  first.status = 'complete';
  first.attempts[0].status = 'complete';
  reserve(s, second, 'fast', 'independent', '', 8, 2);
  expect(second.attempts.length).toBe(1);
  expect(s.delegations).toBe(2);
});
test('budget survives new ledger instance and concurrent reservations cannot lose updates', async () => {
  const data = new Map<string, unknown>();
  const storage = {
    get: async (key: string) => data.get(key),
    set: async (key: string, value: unknown) => {
      data.set(key, structuredClone(value));
    },
  };
  const ledger = new Ledger(storage);
  await ledger.mutate('owner', (s) => {
    registerTask(s, task());
  });
  await Promise.all(
    Array.from({ length: 5 }, () =>
      ledger.mutate('owner', (s) => {
        s.delegations++;
      }),
    ),
  );
  expect((await new Ledger(storage).read('owner')).delegations).toBe(5);
});
