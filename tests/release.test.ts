import { expect, test } from 'bun:test';
import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Execute the actual workflow commands with a recording GitHub CLI fixture.
// SHA rejection models the merge API lease; no GitHub writes occur.
test.skipIf(process.platform === 'win32')(
  'automatic release merges only the validated SHA and dispatches only after success',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'aorchestra-auto-release-'));
    try {
      const workflow = await readFile(
        new URL('../.github/workflows/release.yml', import.meta.url),
        'utf8',
      );
      const inline = workflow
        .split('      - name: Merge validated release PR and continue release\n        run: |\n')[1]
        ?.split('\n  prepare-publication:')[0];
      expect(inline).toBeDefined();
      const script = inline!
        .split('\n')
        .map((line) => line.replace(/^          /, ''))
        .join('\n');
      await writeFile(
        join(root, 'gh'),
        `#!/usr/bin/env node
const fs=require('node:fs');
const args=process.argv.slice(2);
fs.appendFileSync(process.env.CALL_LOG,JSON.stringify(args)+'\\n');
if(args[0]==='workflow')process.exit(process.env.SCENARIO==='dispatch-failed'?1:0);
if(args.includes('PUT')){
  if(!args.includes('sha='+process.env.PR_HEAD_SHA)||!args.includes('merge_method=squash'))process.exit(9);
  if(process.env.SCENARIO==='merge-failed'||process.env.SCENARIO==='head-race')process.exit(1);
}else if(process.env.SCENARIO==='identity-changed')process.exit(1);
console.log(args.includes('PUT')?'c'.repeat(40):'ok');
`,
      );
      await chmod(join(root, 'gh'), 0o755);
      for (const scenario of [
        'success',
        'identity-changed',
        'merge-failed',
        'head-race',
        'invalid-sha',
        'dispatch-failed',
      ]) {
        const log = join(root, scenario);
        const child = Bun.spawn(['bash', '-e', '-o', 'pipefail', '-c', script], {
          env: {
            ...process.env,
            PATH: `${root}:${process.env.PATH}`,
            GITHUB_REPOSITORY: 'owner/repo',
            GITHUB_RUN_ID: '123',
            PR_NUMBER: '12',
            PR_HEAD_SHA: scenario === 'invalid-sha' ? '' : 'a'.repeat(40),
            CALL_LOG: log,
            SCENARIO: scenario,
          },
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(await child.exited).toBe(scenario === 'success' ? 0 : 1);
        const calls = (await readFile(log, 'utf8').catch(() => ''))
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as string[]);
        expect(calls.length).toBe(
          scenario === 'invalid-sha'
            ? 0
            : scenario === 'identity-changed'
              ? 1
              : scenario === 'success' || scenario === 'dispatch-failed'
                ? 3
                : 2,
        );
        if (calls.length === 3)
          expect(calls[2]).toEqual([
            'workflow',
            'run',
            'release.yml',
            '--repo',
            'owner/repo',
            '--ref',
            'main',
            '-f',
            'source_run=123',
            '-f',
            'validated_sha=' + 'a'.repeat(40),
            '-f',
            'merged_sha=' + 'c'.repeat(40),
          ]);
        if (calls.length >= 2) expect(calls[1]).toContain('sha=' + 'a'.repeat(40));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

// The publication job runs on Linux. Execute its actual inline script against a
// local registry fixture and real npm packing, without publishing anything.
test.skipIf(process.platform === 'win32')(
  'release retries require matching archive integrity and publish metadata comes from the checked archive',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'aorchestra-release-'));
    let status = 200;
    let integrity = '';
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () =>
        Response.json(
          { name: 'aorchestra-release-fixture', version: '1.0.0', dist: { integrity } },
          { status },
        ),
    });
    try {
      await writeFile(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'aorchestra-release-fixture',
          version: '1.0.0',
          files: ['index.js'],
          scripts: { prepack: 'node -e "process.exit(42)"' },
        }),
      );
      await writeFile(join(root, 'index.js'), 'export const fixture = true;\n');
      const workflow = await readFile(
        new URL('../.github/workflows/release.yml', import.meta.url),
        'utf8',
      );
      const inline = workflow
        .split("node --input-type=module <<'JS'\n")[1]
        ?.split('\n          JS')[0];
      expect(inline).toBeDefined();
      const script = inline!
        .split('\n')
        .map((line) => line.replace(/^          /, ''))
        .join('\n')
        .replace('https://registry.npmjs.org', server.url.origin);
      const pack = Bun.spawn(['npm', 'pack', '--json', '--ignore-scripts'], {
        cwd: root,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const parsed = JSON.parse(await new Response(pack.stdout).text());
      const packed = Array.isArray(parsed)
        ? parsed[0]
        : parsed.files
          ? parsed
          : parsed['aorchestra-release-fixture'];
      expect(await pack.exited).toBe(0);
      expect(packed?.filename).toBeString();
      expect(packed?.integrity).toBeString();
      integrity = packed.integrity;
      for (const scenario of [
        { status: 200, match: true, success: true },
        { status: 200, match: false, success: false },
        { status: 404, match: false, success: true },
        { status: 503, match: false, success: false },
      ]) {
        status = scenario.status;
        integrity = scenario.match ? packed.integrity : 'sha512-mismatch';
        const output = join(root, `output-${status}-${scenario.match}`);
        const child = Bun.spawn(['node', '--input-type=module', '-e', script], {
          cwd: root,
          env: { ...process.env, GITHUB_OUTPUT: output },
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const error = await new Response(child.stderr).text();
        const code = await child.exited;
        if (scenario.success) {
          expect(code).toBe(0);
          expect(await readFile(output, 'utf8')).toBe(
            `exists=${status === 200}\narchive=${packed.filename}\n`,
          );
        } else {
          expect(code).not.toBe(0);
          expect(error).toContain(
            status === 200 ? 'differs from the tagged package' : 'Registry HTTP 503',
          );
          expect(await readFile(output, 'utf8').catch(() => undefined)).toBeUndefined();
        }
      }
    } finally {
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
  15000,
);

// Evaluate the checked-in YAML with GitHub's expression parser/evaluator rather
// than a second JavaScript implementation of the workflow conditions.
import { parse } from 'yaml';
import { Lexer, Parser, Evaluator, data } from '@actions/expressions';

type Workflow = {
  on: Record<string, unknown>;
  concurrency: { group: string; 'cancel-in-progress': string | boolean };
  jobs: Record<
    string,
    {
      if?: string;
      needs?: string | string[];
      uses?: string;
      with?: Record<string, string>;
      env?: Record<string, string>;
      steps?: Array<{ uses?: string; run?: string; with?: Record<string, unknown> }>;
    }
  >;
};
const releaseWorkflow = parse(
  await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'),
) as Workflow;
const validateWorkflow = parse(
  await readFile(new URL('../.github/workflows/validate.yml', import.meta.url), 'utf8'),
) as Workflow;
type Context = {
  github: {
    event_name: string;
    ref: string;
    sha: string;
    run_id: number;
    event: { pull_request?: { number: number } };
  };
  inputs: { publish_tag?: string; ref?: string; merged_sha?: string };
  vars: { NPM_PUBLISH_ENABLED: string };
  needs: Record<string, { result: string; outputs: Record<string, string> }>;
};
const context = (event = 'push', tag?: string, result = 'success', created = 'true'): Context => ({
  github: {
    event_name: event,
    ref: 'refs/heads/main',
    sha: 'a'.repeat(40),
    run_id: 123,
    event: {},
  },
  inputs: tag === undefined ? {} : { publish_tag: tag },
  vars: { NPM_PUBLISH_ENABLED: 'true' },
  needs: {
    'prepare-validation': { result: 'success', outputs: { reused: 'false' } },
    'validate-main': { result, outputs: {} },
    'prepare-publication': {
      result: 'success',
      outputs: { reused: 'true', tag: tag || '0.6.0', sha: 'a'.repeat(40) },
    },
    'validate-tag': { result: 'skipped', outputs: {} },
    release: {
      result,
      outputs: {
        release_created: created,
        tag_name: '0.6.0',
        'pr-number': '15',
        'pr-head-sha': 'b'.repeat(40),
      },
    },
    'validate-release-pr': { result, outputs: {} },
  },
});
function evaluate(expression: string, ctx: Context, cancelled = false, success = true) {
  const source = expression
    .trim()
    .replace(/^\$\{\{\s*/, '')
    .replace(/\s*\}\}$/, '');
  const functions = new Map([
    [
      'cancelled',
      { name: 'cancelled', minArgs: 0, maxArgs: 0, call: () => new data.BooleanData(cancelled) },
    ],
    [
      'success',
      { name: 'success', minArgs: 0, maxArgs: 0, call: () => new data.BooleanData(success) },
    ],
  ]);
  const ast = new Parser(new Lexer(source).lex().tokens, Object.keys(ctx), [
    ...functions.values(),
  ]).parse();
  return new Evaluator(
    ast,
    JSON.parse(JSON.stringify(ctx), data.reviver) as data.Dictionary,
    functions,
  ).evaluate();
}
function jobEnabled(name: string, ctx: Context, cancelled = false) {
  const job = releaseWorkflow.jobs[name];
  const needs = typeof job.needs === 'string' ? [job.needs] : (job.needs ?? []);
  const upstreamSucceeded = needs.every((id) => ctx.needs[id]?.result === 'success');
  const source = (job.if ?? 'true')
    .trim()
    .replace(/^\$\{\{\s*/, '')
    .replace(/\s*\}\}$/, '');
  // GitHub adds success() unless a status function is already present.
  const condition = /\b(?:cancelled|success|failure|always)\s*\(/.test(source)
    ? source
    : `success() && (${source})`;
  return evaluate(condition, ctx, cancelled, upstreamSucceeded).coerceString() === 'true';
}
function expand(template: string, ctx: Context) {
  return template.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, expression: string) =>
    evaluate(expression, ctx).coerceString(),
  );
}

test('main has one CI owner and validation checks immutable event or supplied SHAs', () => {
  expect(validateWorkflow.on).not.toHaveProperty('push');
  expect(validateWorkflow.on).toHaveProperty('pull_request');
  expect(validateWorkflow.on).toHaveProperty('workflow_call');
  expect(releaseWorkflow.on).toHaveProperty('push');
  const checkout = validateWorkflow.jobs.validate.steps!.find((s) =>
    s.uses?.startsWith('actions/checkout@'),
  )!;
  const main = context();
  expect(expand(checkout.with!.ref as string, main)).toBe(main.github.sha);
  const pr = context('pull_request');
  pr.github.ref = 'refs/pull/16/merge';
  pr.github.sha = 'c'.repeat(40);
  expect(expand(checkout.with!.ref as string, pr)).toBe(pr.github.sha);
  main.inputs.ref = 'b'.repeat(40);
  expect(expand(checkout.with!.ref as string, main)).toBe(main.inputs.ref!);
  expect(checkout.with!['persist-credentials']).toBe(false);
});

test('tag retries skip main and Release Please while publishing only the requested tag', () => {
  const retry = context('workflow_dispatch', '0.5.0', 'skipped');
  expect(jobEnabled('validate-main', retry)).toBe(false);
  expect(jobEnabled('release', retry)).toBe(false);
  expect(jobEnabled('merge-release-pr', retry)).toBe(false);
  expect(jobEnabled('prepare-publication', retry)).toBe(true);
  expect(expand(releaseWorkflow.jobs['prepare-publication'].env!.RELEASE_TAG, retry)).toBe('0.5.0');
  const branchRetry = context('workflow_dispatch', '0.5.0', 'skipped');
  branchRetry.github.ref = 'refs/heads/feature';
  expect(jobEnabled('validate-main', branchRetry)).toBe(false);
  expect(jobEnabled('release', branchRetry)).toBe(false);
  expect(jobEnabled('prepare-publication', branchRetry)).toBe(false);
  expect(jobEnabled('prepare-publication', context('push', '0.5.0', 'skipped'))).toBe(false);
});

test('publication fails closed on failed, cancelled, absent or disabled ordinary releases', () => {
  for (const event of ['push', 'workflow_dispatch']) {
    const normal = context(event);
    expect(jobEnabled('validate-main', normal)).toBe(true);
    expect(jobEnabled('release', normal)).toBe(true);
    expect(jobEnabled('prepare-publication', normal)).toBe(true);
    expect(jobEnabled('prepare-publication', context(event, undefined, 'success', 'false'))).toBe(
      false,
    );
    for (const result of ['failure', 'cancelled', 'skipped'])
      expect(jobEnabled('prepare-publication', context(event, undefined, result))).toBe(false);
  }
  const disabled = context();
  disabled.vars.NPM_PUBLISH_ENABLED = 'false';
  expect(jobEnabled('prepare-publication', disabled)).toBe(false);
  expect(jobEnabled('prepare-publication', context(), true)).toBe(false);
  expect(
    jobEnabled('prepare-publication', context('workflow_dispatch', '0.5.0', 'skipped'), true),
  ).toBe(false);
  expect(jobEnabled('prepare-publication', context('workflow_dispatch', '0.5.0', 'failure'))).toBe(
    false,
  );
  expect(jobEnabled('release', context('push', undefined, 'failure'))).toBe(false);
  expect(jobEnabled('validate-main', context('workflow_dispatch', ''))).toBe(true);
  expect(jobEnabled('prepare-publication', context('workflow_dispatch', ''))).toBe(true);
  const disabledRetry = context('workflow_dispatch', '0.5.0', 'skipped');
  disabledRetry.vars.NPM_PUBLISH_ENABLED = 'false';
  expect(jobEnabled('prepare-publication', disabledRetry)).toBe(false);
});

test('only obsolete PR checks share a cancellable concurrency group', () => {
  const first = context('pull_request');
  first.github.event.pull_request = { number: 16 };
  const update = context('pull_request');
  update.github.event.pull_request = { number: 16 };
  update.github.run_id = 124;
  update.github.sha = 'c'.repeat(40);
  const other = context('pull_request');
  other.github.event.pull_request = { number: 17 };
  const concurrency = validateWorkflow.concurrency;
  expect(expand(concurrency.group, first)).toBe(expand(concurrency.group, update));
  expect(expand(concurrency.group, first)).not.toBe(expand(concurrency.group, other));
  expect(evaluate(concurrency['cancel-in-progress'] as string, first).coerceString()).toBe('true');
  const main = context(),
    child = context();
  child.inputs.ref = 'b'.repeat(40);
  const newer = context();
  newer.github.run_id = 124;
  expect(expand(concurrency.group, main)).not.toBe(expand(concurrency.group, child));
  expect(expand(concurrency.group, main)).not.toBe(expand(concurrency.group, newer));
  expect(evaluate(concurrency['cancel-in-progress'] as string, main).coerceString()).toBe('false');
  expect(releaseWorkflow.concurrency['cancel-in-progress']).toBe(false);
});

test('generated release skip marker retains explicit SHA validation and its merge dependency', async () => {
  const config = JSON.parse(
    await readFile(new URL('../release-please-config.json', import.meta.url), 'utf8'),
  );
  expect(config.packages['.']['pull-request-title-pattern']).toContain('[skip ci]');
  const job = releaseWorkflow.jobs['validate-release-pr'];
  expect(job.uses).toBe('./.github/workflows/validate.yml');
  expect(expand(job.with!.ref, context())).toBe('b'.repeat(40));
  expect(jobEnabled('merge-release-pr', context())).toBe(true);
  const failed = context();
  failed.needs['validate-release-pr'].result = 'failure';
  expect(jobEnabled('merge-release-pr', failed)).toBe(false);
  const missing = context();
  missing.needs.release.outputs['pr-number'] = '';
  expect(jobEnabled('validate-release-pr', missing)).toBe(false);
  expect(jobEnabled('merge-release-pr', missing)).toBe(false);
});

test('ordinary main runs skip evidence preparation but still require full validation', () => {
  const ctx = context();
  expect(jobEnabled('prepare-validation', ctx)).toBe(false);
  ctx.needs['prepare-validation'].result = 'skipped';
  ctx.needs['prepare-validation'].outputs.reused = '';
  expect(jobEnabled('validate-main', ctx)).toBe(true);
  expect(jobEnabled('release', ctx)).toBe(true);
  for (const result of ['failure', 'cancelled', 'skipped']) {
    ctx.needs['validate-main'].result = result;
    expect(jobEnabled('release', ctx)).toBe(false);
  }
  ctx.inputs.merged_sha = ctx.github.sha;
  expect(jobEnabled('prepare-validation', ctx)).toBe(true);
  for (const result of ['failure', 'cancelled']) {
    ctx.needs['prepare-validation'].result = result;
    expect(jobEnabled('validate-main', ctx)).toBe(false);
  }
  expect(jobEnabled('validate-main', context(), true)).toBe(false);
});

test('release accepts skipped main validation only with successful tree evidence', () => {
  const ctx = context();
  ctx.needs['prepare-validation'].outputs.reused = 'true';
  ctx.needs['validate-main'].result = 'skipped';
  expect(jobEnabled('validate-main', ctx)).toBe(false);
  expect(jobEnabled('release', ctx)).toBe(true);
  ctx.needs['prepare-validation'].outputs.reused = 'false';
  expect(jobEnabled('release', ctx)).toBe(false);
  ctx.needs['prepare-validation'].outputs.reused = 'true';
  for (const result of ['failure', 'cancelled', 'skipped']) {
    ctx.needs['prepare-validation'].result = result;
    expect(jobEnabled('release', ctx)).toBe(false);
  }
  expect(jobEnabled('release', context(), true)).toBe(false);
});

test('publication requires reusable evidence or successful full tag validation', () => {
  const ctx = context();
  expect(jobEnabled('validate-tag', ctx)).toBe(false);
  expect(jobEnabled('publish-npm', ctx)).toBe(true);
  ctx.needs['prepare-publication'].outputs.reused = 'false';
  expect(jobEnabled('validate-tag', ctx)).toBe(true);
  expect(jobEnabled('publish-npm', ctx)).toBe(false);
  ctx.needs['validate-tag'].result = 'success';
  expect(jobEnabled('publish-npm', ctx)).toBe(true);
  for (const result of ['failure', 'cancelled']) {
    ctx.needs['validate-tag'].result = result;
    expect(jobEnabled('publish-npm', ctx)).toBe(false);
  }
  ctx.needs['validate-tag'].result = 'skipped';
  ctx.needs['prepare-publication'].outputs.reused = 'true';
  for (const result of ['failure', 'cancelled', 'skipped']) {
    ctx.needs['prepare-publication'].result = result;
    expect(jobEnabled('publish-npm', ctx)).toBe(false);
  }
  expect(jobEnabled('publish-npm', context(), true)).toBe(false);
  const commands = releaseWorkflow.jobs['publish-npm'].steps!.map((step) => step.run);
  expect(commands).not.toContain('bun run typecheck');
  expect(commands).not.toContain('bun run test');
  expect(commands).not.toContain('npm run pack:check');
  expect(commands.some((command) => command?.includes('npm ci'))).toBe(false);
  expect(
    releaseWorkflow.jobs['publish-npm'].steps!.some((step) =>
      step.uses?.startsWith('oven-sh/setup-bun@'),
    ),
  ).toBe(false);
  expect(releaseWorkflow.jobs['validate-tag'].with!.ref).toContain('outputs.sha');
  expect(validateWorkflow.jobs.receipt.needs).toBe('validate');
});

test('two platform lanes cover supported Node floor and publication toolchain', () => {
  const job = validateWorkflow.jobs.validate as unknown as {
    strategy: { matrix: { include: Array<Record<string, string>> } };
    steps: Array<{ name?: string; run?: string; if?: string }>;
  };
  expect(job.strategy.matrix.include).toEqual([
    { os: 'windows-latest', 'node-version': '22' },
    { os: 'ubuntu-24.04', 'node-version': '24', 'npm-version': '12.2.0' },
  ]);
  const shared = job.steps.find((step) => step.name === 'Shared static and release checks')!;
  expect(shared.if).toBe("matrix.os == 'ubuntu-24.04'");
  for (const command of [
    'npm run format:check',
    'bun run typecheck',
    'bun run eval:check',
    "python -m unittest discover -s tests -p '*_test.py'",
    'bun scripts/version-check.ts',
  ])
    expect(shared.run).toContain(command);
  for (const command of ['bun run test', 'npm run pack:check']) {
    const step = job.steps.find((step) => step.run === command)!;
    expect(step).toBeDefined();
    expect(step.if).toBeUndefined();
  }
});

test('downstream release stages tolerate skipped ancestors but require successful direct gates', () => {
  const ctx = context();
  ctx.needs['prepare-validation'].result = 'skipped';
  ctx.needs['prepare-publication'].outputs.reused = 'false';
  for (const name of ['validate-release-pr', 'merge-release-pr', 'validate-tag']) {
    const condition = releaseWorkflow.jobs[name].if!;
    expect(evaluate(condition, ctx, false, false).coerceString()).toBe('true');
    expect(jobEnabled(name, ctx, true)).toBe(false);
  }
  for (const result of ['failure', 'cancelled', 'skipped']) {
    ctx.needs.release.result = result;
    expect(jobEnabled('validate-release-pr', ctx)).toBe(false);
    expect(jobEnabled('merge-release-pr', ctx)).toBe(false);
    ctx.needs['prepare-publication'].result = result;
    expect(jobEnabled('validate-tag', ctx)).toBe(false);
  }
});

test('receipts are enabled by reusable inputs because calls retain the caller event', () => {
  const call = validateWorkflow.on.workflow_call as {
    inputs: { record_validation: { description: string; type: string; default: boolean } };
  };
  expect(call.inputs.record_validation).toEqual({
    description: 'Store evidence after the complete validation matrix succeeds',
    type: 'boolean',
    default: true,
  });
  expect(validateWorkflow.jobs.receipt.if).toBe('inputs.record_validation');
});
