import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { snapshot, changedPaths } from '../lib/files';

export type EvaluationCase = {
  id: string;
  task: string;
  files: Record<string, string>;
  allowedChanges: string[];
  assertions: string;
};

export function validateCorpus(corpus: { version: number; cases: EvaluationCase[] }) {
  const safe = (path: string) =>
    path.length > 0 &&
    !path.includes('\\') &&
    path.split('/').every((p) => p && p !== '.' && p !== '..') &&
    !path.startsWith('/') &&
    !path.includes(':');
  if (
    corpus.version !== 1 ||
    !corpus.cases.length ||
    new Set(corpus.cases.map((c) => c.id)).size !== corpus.cases.length
  )
    throw new Error('INVALID_CORPUS');
  for (const c of corpus.cases) {
    if (
      !/^[a-z0-9-]+$/.test(c.id) ||
      !c.task ||
      !c.assertions ||
      !c.allowedChanges.length ||
      !Object.keys(c.files).length ||
      ![...Object.keys(c.files), ...c.allowedChanges].every(safe)
    )
      throw new Error('INVALID_CASE');
  }
}

export async function writeFixture(cwd: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(cwd, path)), { recursive: true });
    await writeFile(join(cwd, path), content);
  }
}

export async function independentCheck(cwd: string, assertions: string, prelude = true) {
  return new Promise<{ passed: boolean; output: string }>((resolve) => {
    const child = spawn(
      process.env.NODE_BIN || 'node',
      [
        '--input-type=module',
        '-e',
        `${prelude ? "import assert from 'node:assert/strict'; " : ''}${assertions}`,
      ],
      { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let detail = '';
    const timer = setTimeout(() => child.kill(), 10_000);
    const receive = (data: Buffer) => {
      detail = (detail + data).slice(-2000);
    };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ passed: false, output: String(err) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ passed: code === 0, output: detail });
    });
  });
}

export function evaluationOrder(
  repetitions: number,
  selected: 'both' | import('../lib/eval-report').Strategy,
) {
  return Array.from({ length: repetitions }, (_, index) => ({
    repeat: index + 1,
    strategies:
      selected === 'both'
        ? ((index % 2
            ? ['selective', 'direct']
            : ['direct', 'selective']) as import('../lib/eval-report').Strategy[])
        : [selected],
  }));
}

export async function regressionCheck(cwd: string, files: Record<string, string>) {
  const tests = Object.entries(files).filter(([name]) => name.endsWith('.test.js'));
  if (!tests.length) return { passed: false, output: 'independent-regression-not-defined' };
  const checks = [];
  for (const [path, source] of tests)
    checks.push(await independentCheck(dirname(join(cwd, path)), source, false));
  return {
    passed: checks.every((c) => c.passed),
    output: checks
      .map((c) => c.output)
      .filter(Boolean)
      .join('\n')
      .slice(-2000),
  };
}

export async function checkFixture(
  cwd: string,
  fixture: EvaluationCase,
  before: Record<string, string>,
) {
  // Freeze the agent's changes before runner-owned checks can mutate the workspace.
  const afterAgent = await snapshot(cwd);
  const changes = changedPaths(before, afterAgent);
  const checks = await independentCheck(cwd, fixture.assertions);
  const regressions = await regressionCheck(cwd, fixture.files);
  return {
    checks,
    regressions,
    changes,
    scoped: changes.every((path) => fixture.allowedChanges.includes(path)),
    independentCheckChangedPaths: changedPaths(afterAgent, await snapshot(cwd)),
  };
}

// Infrastructure readiness only: at least one verified attempt per protocol under
// matching source/settings. Case IDs, corpus hashes and splits need not match the
// benchmark; this gate establishes neither corpus coverage nor usage completeness.
export function smokeCompatible(
  report: unknown,
  settingsFingerprint: string,
  harnessSourceSHA256: string,
): boolean {
  const smoke = report as {
    conditions?: { phase?: string; harnessSourceSHA256?: string };
    results?: import('../lib/eval-report').EvaluationResult[];
  } | null;
  return (
    smoke?.conditions?.phase === 'smoke' &&
    smoke.conditions.harnessSourceSHA256 === harnessSourceSHA256 &&
    Array.isArray(smoke.results) &&
    ['direct', 'selective'].every((strategy) =>
      smoke.results!.some(
        (r) =>
          r.strategy === strategy &&
          r.passed &&
          r.executionConfirmed &&
          r.behaviorPassed &&
          r.scopePassed &&
          r.regressionPassed &&
          r.policyPassed &&
          r.settingsFingerprint === settingsFingerprint,
      ),
    )
  );
}
