import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Task } from '../lib/core';
import { taskVerifiers, validateVerificationRules, verificationPlan } from '../lib/verification';

const task = (): Task => ({
  id: 'fix',
  kind: 'change',
  instruction: 'Preserve consumers',
  context: '',
  dependsOn: [],
  writePaths: ['src/api.ts'],
  preserve: [],
  verifiers: [
    {
      id: 'regression',
      tool: 'shell',
      input: { command: 'node regression.js' },
      expect: { exitCode: 0 },
    },
  ],
  status: 'running',
  attempts: [],
  receipts: {},
});
async function fixture(files: Record<string, string>) {
  // Windows CI may expose tmpdir through an 8.3 alias; discovery returns canonical paths.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'aorchestra-verification-')));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return { root, clean: () => rm(root, { recursive: true, force: true }) };
}

test('affected package selects existing checks, inheriting the workspace manager without unrelated packages', async () => {
  const f = await fixture({
    'package.json': JSON.stringify({ scripts: { test: 'root-wide' } }),
    'pnpm-lock.yaml': 'lock',
    'packages/api/package.json': JSON.stringify({
      scripts: { typecheck: 'tsc', test: 'node --test', build: 'bundle' },
    }),
    'packages/ui/package.json': JSON.stringify({ scripts: { test: 'unrelated' } }),
  });
  try {
    const t = task();
    const plan = await verificationPlan(f.root, t, ['packages/api/src/file.ts'], 'snapshot');
    expect(plan.sources).toEqual(['packages/api/package.json']);
    expect(plan.verifiers.map((v) => v.input)).toEqual([
      { command: 'pnpm run typecheck', workdir: join(f.root, 'packages/api') },
      { command: 'pnpm run test', workdir: join(f.root, 'packages/api') },
    ]);
    expect(plan.gaps).toEqual([]);
    t.verification = plan;
    expect(taskVerifiers(t)).toHaveLength(3); // Explicit semantic regression remains required.
  } finally {
    await f.clean();
  }
});

test('path rules support non-JavaScript checks and deduplicate shared predicates', async () => {
  const f = await fixture({});
  try {
    const verifier = {
      id: 'unit',
      tool: 'shell',
      input: { command: 'python -m unittest' },
      expect: { exitCode: 0 },
    };
    const rules = validateVerificationRules([
      { paths: ['services'], verifiers: [verifier] },
      { paths: ['services/api'], verifiers: [verifier] },
    ]);
    const plan = await verificationPlan(
      f.root,
      task(),
      ['services/api/a.py', 'services/api/b.py'],
      'snapshot',
      rules,
    );
    expect(plan.verifiers).toHaveLength(1);
    expect(plan.sources).toEqual(['plugin options.verification']);
    expect(plan.gaps).toEqual([]);
    expect(plan.verifiers[0].input.command).toBe('python -m unittest');
  } finally {
    await f.clean();
  }
});

test('manual predicates are retained and an identical discovered check does not run twice', async () => {
  const f = await fixture({ 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }) });
  try {
    const t = task();
    t.verifiers = [
      { id: 'test', tool: 'shell', input: { command: 'npm run test' }, expect: { exitCode: 0 } },
    ];
    const plan = await verificationPlan(f.root, t, ['src/file.ts'], 'snapshot');
    expect(plan.verifiers).toEqual([]);
    expect(plan.gaps).toEqual([]);
    t.verifiers[0].input.workdir = '.';
    expect((await verificationPlan(f.root, t, ['src/file.ts'], 'snapshot')).verifiers).toEqual([]);
    t.verifiers[0].input.workdir = join(f.root, 'other');
    const separate = await verificationPlan(f.root, t, ['src/file.ts'], 'snapshot');
    expect(separate.verifiers).toHaveLength(1);
    expect(separate.verifiers[0].input.workdir).toBe(f.root);
  } finally {
    await f.clean();
  }
});

test('conflicting managers and unsupported check conventions remain explicit gaps', async () => {
  const f = await fixture({
    'package.json': JSON.stringify({ scripts: { test: 'tests' } }),
    'package-lock.json': 'lock',
    'yarn.lock': 'lock',
  });
  try {
    const plan = await verificationPlan(f.root, task(), ['src/file.ts'], 'snapshot');
    expect(plan.verifiers).toEqual([]);
    expect(plan.gaps[0]).toContain('package manager unresolved');
    await writeFile(
      join(f.root, 'package.json'),
      JSON.stringify({ packageManager: 'bun@1.2.15', scripts: { custom: 'tests' } }),
    );
    const custom = await verificationPlan(f.root, task(), ['src/file.ts'], 'snapshot');
    expect(custom.gaps[0]).toContain('no typecheck/lint/test scripts');
    await writeFile(
      join(f.root, 'package.json'),
      JSON.stringify({ packageManager: 'bun@1.2.15', scripts: { test: 'tests' } }),
    );
    expect(
      (await verificationPlan(f.root, task(), ['src/file.ts'], 'snapshot')).verifiers[0].input
        .command,
    ).toBe('bun run test');
  } finally {
    await f.clean();
  }
});

test('stable check IDs survive resume; removed checks do not retain successful observations', async () => {
  const f = await fixture({
    'package.json': JSON.stringify({ scripts: { test: 'tests', lint: 'lint' } }),
  });
  try {
    const t = task();
    const a = await verificationPlan(f.root, t, ['src/file.ts'], 'old');
    const testId = a.verifiers.find((v) => v.input.command === 'npm run test')!.id;
    a.observations[testId] = { event: 'native:1', snapshot: 'old', passed: true };
    t.verification = a;
    await writeFile(join(f.root, 'package.json'), JSON.stringify({ scripts: { test: 'tests' } }));
    const b = await verificationPlan(f.root, t, ['src/file.ts'], 'new');
    expect(b.verifiers[0].id).toBe(testId);
    expect(b.observations[testId].snapshot).toBe('old');
    expect(b.verifiers).toHaveLength(1);
  } finally {
    await f.clean();
  }
});

test('verification discovery fails closed on malformed or escaped manifests', async () => {
  const f = await fixture({ 'package.json': '{' });
  const outside = await fixture({ 'package.json': '{}' });
  try {
    await expect(verificationPlan(f.root, task(), ['src/file.ts'], 'snapshot')).rejects.toThrow();
    await rm(join(f.root, 'package.json'));
    await symlink(
      outside.root,
      join(f.root, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(
      verificationPlan(f.root, task(), ['linked/src/file.ts'], 'snapshot'),
    ).rejects.toThrow('SYMLINK_ESCAPE');
  } finally {
    await f.clean();
    await outside.clean();
  }
});

test('configured predicates reject traversal, globs and missing expected results', () => {
  for (const path of ['../external', '/absolute', 'src/*', 'C:/repo'])
    expect(() => validateVerificationRules([{ paths: [path], verifiers: [] }])).toThrow();
  expect(() =>
    validateVerificationRules([
      {
        paths: ['.'],
        verifiers: [{ id: 'empty', tool: 'shell', input: { command: 'test' }, expect: {} }],
      },
    ]),
  ).toThrow('INVALID_VERIFICATION_PREDICATE');
});

test('nested packages inherit an explicit workspace manager even without a lockfile', async () => {
  const f = await fixture({
    'package.json': JSON.stringify({ packageManager: 'yarn@4.0.0' }),
    'packages/api/package.json': JSON.stringify({ scripts: { test: 'tests' } }),
  });
  try {
    const plan = await verificationPlan(f.root, task(), ['packages/api/file.ts'], 'snapshot');
    expect(plan.verifiers[0].input).toEqual({
      command: 'yarn run test',
      workdir: join(f.root, 'packages/api'),
    });
    expect(plan.sources).toEqual(['packages/api/package.json', 'package.json']);
  } finally {
    await f.clean();
  }
});
