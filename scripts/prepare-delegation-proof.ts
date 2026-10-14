// Deterministic preparation only: no prompt dispatch or inference CLI invocation.
import { cp, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { command, privateClient, assertRuntime, binary } from './runtime';
import { writeFixture, checkFixture, validateCorpus, type EvaluationCase } from './eval-fixture';
import { snapshot } from '../lib/files';
import { tmpdir } from 'node:os';
import { readyForProof } from '../tests/fixtures/delegation-proof/gate';

const root = resolve(import.meta.dir, '..');
const destination = resolve(
  process.argv.find((arg) => arg.startsWith('--output-dir='))?.slice(13) ??
    join(root, 'work/delegation-foundation/prepared'),
);
const model = 'opencode/mimo-v2.6-flash-free';
const runtime = (await command(['--version'], root)).trim();
assertRuntime(runtime);
// Refuse to overwrite a preparation or an executed archive.
await mkdir(dirname(destination), { recursive: true });
await mkdir(destination, { recursive: false });
// Native project discovery must not inherit this repository's opencode.json.
const runtimeRoot = await mkdtemp(join(tmpdir(), 'aorchestra-foundation-proof-'));
const harness = join(runtimeRoot, 'harness');
await mkdir(harness);
for (const path of [
  'lib',
  'plugins',
  'scripts',
  'instructions',
  'skills',
  'tests',
  'eval',
  'package.json',
  'bun.lock',
  'tsconfig.json',
  'AGENTS.md',
]) {
  // Some checkouts have no Bun lock; it is not an inference prerequisite.
  try {
    await cp(join(root, path), join(harness, path), { recursive: true });
  } catch (error) {
    if (path !== 'bun.lock' || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
await symlink(join(root, 'node_modules'), join(harness, 'node_modules'), 'dir');
const original = (
  JSON.parse(await readFile(join(root, 'eval/cases.json'), 'utf8')) as { cases: EvaluationCase[] }
).cases.find((item) => item.id === 'brownfield-analysis-callers')!;
const fixture: EvaluationCase = {
  ...original,
  task: 'Forced delegation capability proof. Read AGENTS.md and package.json. Register exactly one task named lookup: kind analysis, analysisMode lookup, no dependencies or write paths, preservation of source files, and a structured candidate-source handoff for config.js (revision unknown). Set its bounded instruction to read config.js and identify exported settings that discard an explicit numeric zero, with file-backed evidence. Require the standard STATUS/RESULT/EVIDENCE/CHANGED/OPEN report. Register a native read verifier using input {"path":"config.js"}, expect {"contains":"export"}. Delegate lookup exactly once with a configured valid model tier, tools ["read"] as an array, and a routing reason; omit handoff to reuse registration. Consume the child result. Run the returned pending verifiers and explicitly accept lookup with a compatibilityReview before writing. Then write findings.json containing only zeroDiscardingSettings, a sorted array of names from the child result. Run npm run test and finish by identifying the child result used. Completion requires the child result, accepted lookup, findings.json, and successful project verification. A rejected or failed delegation ends this single-attempt protocol; no repairs or replacement tasks are authorized. Source files are read-only. This is a capability proof, not an autonomous routing evaluation.',
  assertions:
    "const {readFile}=await import('node:fs/promises'); const f=JSON.parse(await readFile('findings.json','utf8')); assert.deepEqual(f,{zeroDiscardingSettings:['timeout']});",
};
validateCorpus({ version: 1, cases: [fixture] });
// Preserve the corpus and its split conventions; replace only the selected case.
const corpus = JSON.parse(await readFile(join(harness, 'eval/cases.json'), 'utf8'));
corpus.cases = corpus.cases.map((item: EvaluationCase) =>
  item.id === fixture.id ? fixture : item,
);
await writeFile(join(harness, 'eval/cases.json'), JSON.stringify(corpus, null, 2) + '\n');
await writeFile(join(destination, 'fixture.json'), JSON.stringify(fixture, null, 2) + '\n');
const config = JSON.parse(await readFile(join(root, 'opencode.json'), 'utf8'));
config.model = model;
config.agents.aorchestra.steps = 20;
config.agents['aorchestra-executor'].steps = 8;
config.compaction.auto = false;
const evidencePath = join(destination, 'execution.jsonl');
config.plugins = [
  '*',
  {
    package: './tests/fixtures/delegation-proof',
    options: {
      autoSetup: false,
      updateCheck: false,
      telemetry: true,
      models: { fast: model, balanced: model, strong: model },
      maxConcurrentAnalyses: 1,
      maxDelegations: 1,
      maxAttempts: 1,
      maxRepairs: 1,
      timeoutMs: 180000,
      proofEvidencePath: evidencePath,
    },
  },
];
// The existing evaluation runner computes options from its production registration
// selector. Runtime loading still uses the wrapper; record the actual profile in
// the manifest and native preflight rather than changing evaluation policy.
await writeFile(join(harness, 'opencode.json'), JSON.stringify(config, null, 2) + '\n');
const workspace = join(runtimeRoot, 'preflight/workspace');
await mkdir(workspace, { recursive: true });
await writeFixture(workspace, fixture.files);
const checks = await checkFixture(workspace, fixture, await snapshot(workspace));
const env: NodeJS.ProcessEnv = {
  ...process.env,
  OPENCODE_CONFIG: join(harness, 'opencode.json'),
  OPENCODE_DB: join(runtimeRoot, 'preflight/opencode.db'),
  AORCHESTRA_DISABLE_SETUP: '1',
  AORCHESTRA_DISABLE_UPDATE: '1',
};
delete env.OPENCODE_CONFIG_CONTENT;
const native = await privateClient(workspace, env);
let preflight: unknown;
try {
  await native.client.location.get({ location: { directory: workspace } });
  const catalog = await native.client.model.list();
  const selected = catalog.data.find((item) => `${item.providerID}/${item.id}` === model);
  const agents = await native.client.agent.list({ location: { directory: workspace } });
  const settings = await native.client.config.get({ location: { directory: workspace } });
  const plugins = await native.client.plugin.list({ location: { directory: workspace } });
  preflight = {
    runtime,
    model,
    availableInCatalog: !!selected,
    toolsSupported: selected?.capabilities.tools ?? null,
    providerHealth: 'UNVERIFIED',
    modelCalls: 0,
    promptSent: false,
    agents: agents.data
      .filter((agent) => ['aorchestra', 'aorchestra-executor'].includes(agent.id))
      .map((agent) => ({ id: agent.id, steps: agent.steps })),
    plugins: plugins.data.filter((plugin) => plugin.id === 'aorchestra'),
    settings,
    baseline: {
      behaviorPassed: checks.checks.passed,
      regressionPassed: checks.regressions.passed,
      scopePassed: checks.scoped,
    },
    ready: readyForProof({
      available: !!selected,
      tools: !!selected?.capabilities.tools,
      behavior: checks.checks.passed,
      regression: checks.regressions.passed,
      agents: agents.data,
      wrapperActive:
        plugins.data.filter(
          (plugin) => plugin.id === 'aorchestra' && plugin.state.status === 'active',
        ).length === 1 &&
        plugins.data.some(
          (plugin) =>
            plugin.id === 'aorchestra' &&
            plugin.state.status === 'active' &&
            plugin.source.type === 'local' &&
            plugin.source.path === join(harness, 'tests/fixtures/delegation-proof/index.ts'),
        ),
    }),
  };
} finally {
  await native.close();
}
await writeFile(join(destination, 'preflight.json'), JSON.stringify(preflight, null, 2) + '\n');
if (!(preflight as { ready: boolean }).ready) throw new Error('DIAGNOSTIC_PREFLIGHT_BLOCKED');
const sourceHashes = await snapshot(harness);
await writeFile(
  join(destination, 'source-hashes.json'),
  JSON.stringify(sourceHashes, null, 2) + '\n',
);
const manifest = {
  status: 'BLOCKED_AWAITING_FRESH_AUTHORIZATION',
  providerCalls: 0,
  runtime,
  model,
  provider: 'opencode',
  harness,
  runtimeRoot,
  archiveLocation: destination,
  fixture: join(destination, 'fixture.json'),
  evidencePath,
  preflight: join(destination, 'preflight.json'),
  budget: {
    primaryRuns: 1,
    primarySteps: 20,
    childSteps: 8,
    delegationInvocations: 1,
    admittedDelegations: 1,
    childAttempts: 1,
    childTimeoutSeconds: 180,
    cliTimeoutSeconds: 600,
    cleanupGraceSeconds: 5,
    repairs: 0,
    providerRetries: 0,
    reruns: 0,
    providerRequests: 28,
    auxiliaryRequests: 0,
  },
  enforcement: {
    invocations:
      'Persisted evaluation-only wrapper counts before validation; rejected input halts further parent context; a later call is blocked before admission. Successful continuation removes delegate from parent tool schema.',
    retries:
      'Native retry hook sets retry:false; replacement lookups and repair/recovery are denied.',
    attempts: 'Native maxDelegations=1 and maxAttempts=1; single-task only.',
    timeout: 'Existing command helper SIGINT at 600s then directly owned CLI SIGKILL after 5s.',
    auxiliary:
      'Evaluation title hook supplies a fixed title without inference; HTTP gate denies auxiliary requests and caps primary sends at 20, child sends at 8 across reloads. In-flight network latency remains timeout-bounded.',
  },
  independentAcceptance: [
    'Runner-owned exact findings.json assertion',
    'Original fixture regression',
    'Only findings.json changes',
    'Native child succeeded with structured file-backed result',
    'Lookup explicitly accepted after pending native verifiers',
    'Actual child model request matches configured M; selected T and deny-first permissions match',
    'I/C delivered including stored handoff and source fingerprint',
    'Parent tool result consumption and continuation are archived',
  ],
  uncertainties: [
    'Provider health is unknown without authorized dispatch',
    'Primary argument generation and child/parent behavior are unverified',
    'Raw provider response bodies are not captured; native arguments and request/response-status evidence retained',
    'SIGKILL/process-tree and provider cleanup limitations remain as previously documented',
  ],
  executionEnvironment: { OPENCODE_BIN: binary },
  command: [
    process.execPath,
    join(harness, 'scripts/eval.ts'),
    'run',
    '--phase=smoke',
    '--strategy=selective',
    `--case=${fixture.id}`,
    '--repeat=1',
    `--output-dir=${join(runtimeRoot, 'run')}`,
  ],
  fixtureSHA256: createHash('sha256').update(JSON.stringify(fixture)).digest('hex'),
};
await writeFile(
  join(destination, 'prepared-diagnostic.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      status: manifest.status,
      manifest: join(destination, 'prepared-diagnostic.json'),
      modelCalls: 0,
      preflight,
    },
    null,
    2,
  ),
);
