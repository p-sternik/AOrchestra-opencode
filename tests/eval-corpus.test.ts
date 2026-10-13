import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import developmentData from '../eval/cases.json';
import holdoutData from '../eval/holdout.json';
import solutions from './fixtures/eval-solutions.json';
import {
  type EvaluationCase,
  validateCorpus,
  writeFixture,
  independentCheck,
  checkFixture,
} from '../scripts/eval-fixture';
import { snapshot, changedPaths } from '../lib/files';

const development = developmentData as unknown as { version: number; cases: EvaluationCase[] };
const holdout = holdoutData as unknown as { version: number; cases: EvaluationCase[] };
const cases = [...development.cases, ...holdout.cases];

for (const forbiddenEdit of [false, true]) {
  test(`scope isolates agent edits from test mutations (forbidden edit: ${forbiddenEdit})`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'aorchestra-scope-'));
    const fixture: EvaluationCase = {
      id: 'test-mutations',
      task: 'Update allowed.js',
      files: {
        'allowed.js': 'before',
        'protected.js': 'original',
        'regression.test.js':
          "import { writeFileSync } from 'node:fs'; writeFileSync('regression-output.txt', 'generated');",
      },
      allowedChanges: ['allowed.js'],
      assertions:
        "const { writeFileSync } = await import('node:fs'); writeFileSync('protected.js', 'original'); writeFileSync('assertion-output.txt', 'generated');",
    };
    try {
      await writeFixture(cwd, fixture.files);
      const before = await snapshot(cwd);
      await writeFixture(cwd, {
        'allowed.js': 'after',
        ...(forbiddenEdit ? { 'protected.js': 'agent edit' } : {}),
      });
      const checked = await checkFixture(cwd, fixture, before);
      expect(checked.checks.passed).toBe(true);
      expect(checked.regressions.passed).toBe(true);
      expect(checked.changes).toEqual(
        forbiddenEdit ? ['allowed.js', 'protected.js'] : ['allowed.js'],
      );
      expect(checked.scoped).toBe(!forbiddenEdit);
      expect(checked.independentCheckChangedPaths).toEqual(
        forbiddenEdit
          ? ['assertion-output.txt', 'protected.js', 'regression-output.txt']
          : ['assertion-output.txt', 'regression-output.txt'],
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
}

test('development and holdout remain disjoint and fixture paths stay relative', () => {
  validateCorpus(development);
  validateCorpus(holdout);
  expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  expect(Object.keys(solutions)).toHaveLength(10);
  expect(() =>
    validateCorpus({
      ...development,
      cases: [{ ...development.cases[0], allowedChanges: ['../escape'] }],
    }),
  ).toThrow('INVALID_CASE');
});

for (const c of cases.filter((c) => c.id.startsWith('brownfield-'))) {
  test(`${c.id}: independent oracle rejects baseline, accepts a scoped repair and detects regression`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'aorchestra-corpus-'));
    try {
      await writeFixture(cwd, c.files);
      const before = await snapshot(cwd);
      const existing = await independentCheck(cwd, "await import('./regression.test.js');");
      expect(existing.passed).toBe(true);
      expect((await independentCheck(cwd, c.assertions)).passed).toBe(false);
      await writeFixture(cwd, solutions[c.id as keyof typeof solutions]);
      const repaired = await independentCheck(cwd, c.assertions);
      expect(repaired.output).toBe('');
      expect(repaired.passed).toBe(true);
      expect((await independentCheck(cwd, "await import('./regression.test.js');")).passed).toBe(
        true,
      );
      expect(
        changedPaths(before, await snapshot(cwd)).every((path) => c.allowedChanges.includes(path)),
      ).toBe(true);
      // Agent-written tests cannot turn broken fixture behavior into success.
      await writeFixture(cwd, c.files);
      if (c.allowedChanges.includes('findings.json')) await rm(join(cwd, 'findings.json'));
      await writeFixture(cwd, { 'regression.test.js': '// all tests removed\n' });
      expect((await independentCheck(cwd, c.assertions)).passed).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
}

test('regression gate uses original fixture tests even when agent tests are removed', async () => {
  const { regressionCheck } = await import('../scripts/eval-fixture');
  const cwd = await mkdtemp(join(tmpdir(), 'aorchestra-regression-'));
  try {
    const files = {
      'module.js': 'export const original=1;',
      'original.test.js':
        "import assert from 'node:assert/strict';import {original} from './module.js';assert.equal(original,1);",
    };
    await writeFixture(cwd, files);
    expect((await regressionCheck(cwd, files)).passed).toBe(true);
    await writeFixture(cwd, {
      'module.js': 'export const original=2;',
      'original.test.js': '// removed',
    });
    expect((await regressionCheck(cwd, files)).passed).toBe(false);
    expect((await regressionCheck(cwd, {})).passed).toBe(false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('frozen regression sources retain their original import directory', async () => {
  const { regressionCheck } = await import('../scripts/eval-fixture');
  const cwd = await mkdtemp(join(tmpdir(), 'aorchestra-nested-regression-'));
  try {
    const files = {
      'src/value.js': 'export const value=1;',
      'tests/value.test.js':
        "import assert from 'node:assert/strict';import {value} from '../src/value.js';assert.equal(value,1);",
    };
    await writeFixture(cwd, files);
    await rm(join(cwd, 'tests/value.test.js'));
    expect((await regressionCheck(cwd, files)).passed).toBe(true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
