import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import packageInfo from '../package.json';
import {
  validateCorpus,
  writeFixture,
  checkFixture,
  evaluationOrder,
  smokeCompatible,
  type EvaluationCase as Case,
} from './eval-fixture';
import { command, assertRuntime } from './runtime';
import { readEvaluationUsage, prepareEvaluationSession } from './eval-usage';
import {
  comparison,
  caseComparisons,
  evaluationMarkdown,
  evaluationPolicy,
  evaluationOutcome,
  type EvaluationResult,
  type Strategy,
} from '../lib/eval-report';
import { snapshot, fingerprint } from '../lib/files';
const root = resolve(import.meta.dir, '..');
const split = process.argv.find((arg) => arg.startsWith('--split='))?.slice(8) ?? 'development';
if (!['development', 'holdout'].includes(split)) throw new Error('INVALID_SPLIT');
const corpusPath = join(root, split === 'holdout' ? 'eval/holdout.json' : 'eval/cases.json');
const corpusText = await Bun.file(corpusPath).text();
const corpus = JSON.parse(corpusText) as {
  version: number;
  cases: Case[];
};
validateCorpus(corpus);
const otherCorpus = (await Bun.file(
  join(root, split === 'holdout' ? 'eval/cases.json' : 'eval/holdout.json'),
).json()) as typeof corpus;
validateCorpus(otherCorpus);
if (
  new Set([...corpus.cases, ...otherCorpus.cases].map((c) => c.id)).size !==
  corpus.cases.length + otherCorpus.cases.length
)
  throw new Error('OVERLAPPING_SPLITS');
if (process.argv[2] === 'check') {
  console.log(
    JSON.stringify({
      cases: corpus.cases.length,
      split,
      totalCases: corpus.cases.length + otherCorpus.cases.length,
      strategies: ['direct', 'selective'],
      goldToolsInPrompt: false,
      independentBehaviorChecks: true,
    }),
  );
  process.exit(0);
}
if (process.argv[2] !== 'run') throw new Error('Use check or run');
const selected = process.argv.find((arg) => arg.startsWith('--strategy='))?.slice(11) ?? 'both';
if (!['direct', 'selective', 'both'].includes(selected)) throw new Error('INVALID_STRATEGY');
const repetitions = Number(
  process.argv.find((arg) => arg.startsWith('--repeat='))?.slice(9) ?? '1',
);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20)
  throw new Error('INVALID_REPEAT');
const phase =
  process.argv.find((arg) => arg.startsWith('--phase='))?.slice(8) ??
  (repetitions === 1 ? 'smoke' : 'benchmark');
if (
  !['smoke', 'benchmark'].includes(phase) ||
  (phase === 'benchmark' && (selected !== 'both' || repetitions < 2))
)
  throw new Error('BENCHMARK_REQUIRES_PAIRED_REPETITIONS');
const smokePath = process.argv.find((arg) => arg.startsWith('--smoke-report='))?.slice(15);
if (phase === 'benchmark' && !smokePath) throw new Error('BENCHMARK_REQUIRES_SMOKE_REPORT');
const smoke = smokePath ? await Bun.file(resolve(smokePath)).json() : null;
const caseID = process.argv.find((arg) => arg.startsWith('--case='))?.slice(7);
const cases = caseID ? corpus.cases.filter((c) => c.id === caseID) : corpus.cases;
if (!cases.length) throw new Error('INVALID_CASE_SELECTION');
const destination = resolve(
  process.argv.find((arg) => arg.startsWith('--output-dir='))?.slice(13) ?? join(root, 'work/eval'),
);
await mkdir(destination, { recursive: true });
const runtimeVersion = (await command(['--version'], root)).trim();
assertRuntime(runtimeVersion);
const configText = await Bun.file(join(root, 'opencode.json')).text();
const profile = JSON.parse(configText);
const revision = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: root });
const workingTree = Bun.spawnSync(['git', 'status', '--porcelain'], { cwd: root });
const harnessRevision = revision.exitCode === 0 ? revision.stdout.toString().trim() : null;
const workingTreeDirty =
  workingTree.exitCode === 0 ? workingTree.stdout.toString().trim().length > 0 : null;
const harnessOptions = profile.plugins.find(
  (p: any) => typeof p === 'object' && p.package === './plugins/aorchestra',
)?.options;
const timeoutMs = 600_000;
async function sourceFingerprint() {
  const sources: Record<string, string> = {
    'package.json': createHash('sha256')
      .update(await Bun.file(join(root, 'package.json')).text())
      .digest('hex'),
  };
  for (const directory of ['lib', 'plugins', 'instructions', 'scripts']) {
    for (const [path, hash] of Object.entries(await snapshot(join(root, directory))))
      sources[`${directory}/${path}`] = hash;
  }
  return fingerprint(sources);
}
const harnessSourceSHA256 = await sourceFingerprint();
const results: EvaluationResult[] = [];
let frozenSettingsFingerprint: string | undefined;
const frozenEnv = { ...process.env };
for (const c of cases)
  for (const { repeat, strategies } of evaluationOrder(repetitions, selected as 'both' | Strategy))
    for (const strategy of strategies) {
      const attemptDir = await mkdtemp(join(destination, `${strategy}-${c.id}-`));
      const cwd = join(attemptDir, 'workspace');
      await mkdir(cwd);
      const env: NodeJS.ProcessEnv = {
        ...frozenEnv,
        OPENCODE_DB: join(attemptDir, 'opencode.db'),
        OPENCODE_CONFIG: join(root, 'opencode.json'),
        AORCHESTRA_DISABLE_UPDATE: '1',
      };
      delete env.OPENCODE_CONFIG_CONTENT;
      const result: EvaluationResult = {
        id: c.id,
        strategy,
        repeat,
        passed: false,
        executionConfirmed: false,
        behaviorPassed: false,
        regressionPassed: false,
        policyPassed: false,
        scopePassed: false,
        changedPaths: [],
        delegations: 0,
        durationMs: 0,
        totalWorkflowCost: null,
        totalWorkflowTokens: null,
        inputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        usageComplete: false,
        costComplete: false,
        lifecycleComplete: false,
        providerRetries: null,
        delegationRetries: null,
        repairs: null,
        toolActivity: null,
        usageIssues: ['attempt-not-observed'],
        missingSessions: [],
        sessionID: null,
        runID: null,
        runtimeOutcome: null,
        error: null,
        independentCheck: '',
        workspace: cwd,
      };
      results.push(result);
      try {
        await writeFixture(cwd, c.files);
        const before = await snapshot(cwd);
        let startedAt: number | undefined;
        let output = '',
          error: string | null = null;
        let directRestrictionEnforced = false;
        try {
          const prepared = await prepareEvaluationSession(cwd, env, strategy, profile.model);
          result.sessionID = prepared.sessionID;
          directRestrictionEnforced = prepared.directRestrictionEnforced;
          result.settingsFingerprint = createHash('sha256')
            .update(JSON.stringify(prepared.settings))
            .digest('hex');
          frozenSettingsFingerprint ??= result.settingsFingerprint;
          if ((await sourceFingerprint()) !== harnessSourceSHA256)
            throw new Error('EVALUATION_HARNESS_CHANGED');
          if (
            phase === 'benchmark' &&
            !smokeCompatible(smoke, result.settingsFingerprint, harnessSourceSHA256)
          )
            throw new Error('EVALUATION_SMOKE_NOT_MATCHED');
          if (result.settingsFingerprint !== frozenSettingsFingerprint)
            throw new Error('EVALUATION_SETTINGS_CHANGED');
          await writeFile(
            join(attemptDir, 'protocol.json'),
            JSON.stringify(
              {
                strategy,
                sessionID: prepared.sessionID,
                settingsFingerprint: result.settingsFingerprint,
                permissions: prepared.permissions,
                directRestrictionEnforced: prepared.directRestrictionEnforced,
              },
              null,
              2,
            ),
          );
          startedAt = Date.now();
          await command(
            [
              'run',
              '--standalone',
              '--session',
              result.sessionID!,
              '--agent',
              'aorchestra',
              '--model',
              profile.model,
              '--format',
              'json',
              '--auto',
              `${strategy === 'direct' ? 'For this run perform all work directly; do not delegate. ' : 'Choose direct work or selective delegation using your normal policy. '}Task: ${c.task}`,
            ],
            cwd,
            timeoutMs,
            env,
            (chunk) => {
              output += chunk;
            },
          );
        } catch (err) {
          error = String(err);
        }
        const durationMs = startedAt === undefined ? 0 : Date.now() - startedAt;
        result.durationMs = durationMs;
        await writeFile(join(attemptDir, 'trajectory.jsonl'), output);
        let measured: Awaited<ReturnType<typeof readEvaluationUsage>> | undefined;
        let usageError: string | undefined;
        try {
          measured = await readEvaluationUsage(cwd, env, output);
          await writeFile(
            join(attemptDir, 'metrics.json'),
            JSON.stringify(
              {
                version: 1,
                sessionID: measured.sessionID,
                family: measured.family,
                runs: measured.records,
              },
              null,
              2,
            ),
          );
        } catch (err) {
          usageError = `usage-reconciliation-failed:${String(err)}`;
        }
        const usage = measured?.usage;
        const runtimeOutcome = measured?.run?.runtimeOutcome ?? measured?.nativeOutcome ?? null;
        Object.assign(result, {
          totalWorkflowCost: usage?.costUSD ?? null,
          totalWorkflowTokens: usage?.totalTokens ?? null,
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          reasoningTokens: usage?.reasoningTokens ?? null,
          cacheReadTokens: usage?.cacheReadTokens ?? null,
          cacheWriteTokens: usage?.cacheWriteTokens ?? null,
          usageComplete: measured?.complete ?? false,
          costComplete: measured?.costComplete ?? false,
          lifecycleComplete: measured?.lifecycleComplete ?? false,
          providerRetries: measured?.providerRetries ?? null,
          delegationRetries: measured?.delegationRetries ?? null,
          repairs: measured?.repairs ?? null,
          toolActivity: measured?.toolActivity ?? null,
          activityIssues: measured?.activityIssues ?? ['activity-not-observed'],
          usageIssues: usageError ? [usageError] : (measured?.issues ?? ['usage-not-observed']),
          missingSessions: usage?.missingSessions ?? [],
          sessionID: measured?.sessionID ?? result.sessionID,
          runID: measured?.run?.id ?? null,
          runtimeOutcome,
          executionConfirmed: runtimeOutcome === 'succeeded',
          error,
          observedModels: measured?.run?.models ?? null,
        });
        const events = output
          .split(/\r?\n/)
          .filter(Boolean)
          .flatMap((line) => {
            try {
              return [JSON.parse(line)];
            } catch {
              return [];
            }
          });
        const delegationEvents = events.filter(
          (event) =>
            event.type === 'tool_use' &&
            ['aorchestra_delegate', 'subagent'].includes(event.part?.name ?? event.part?.tool),
        );
        const delegationCalls = new Set(
          delegationEvents.map((event, index) => event.part?.id ?? index),
        ).size;
        const policy = evaluationPolicy(
          strategy,
          measured?.sessionID ?? result.sessionID,
          measured?.records ?? [],
          measured?.family ?? [],
          Math.max(delegationCalls, measured?.nativeDelegationCalls ?? 0),
        );
        const policyPassed =
          policy.passed && (strategy === 'selective' || directRestrictionEnforced);
        result.delegations = policy.delegations;
        result.policyPassed = policyPassed;
        if (!policyPassed) error ??= 'DIRECT_PROTOCOL_VIOLATION';
        const { checks, regressions, changes, scoped, independentCheckChangedPaths } =
          await checkFixture(cwd, c, before);
        Object.assign(result, {
          ...evaluationOutcome(
            {
              runtimeOutcome,
              error,
              behaviorPassed: checks.passed,
              regressionPassed: regressions.passed,
              scopePassed: scoped,
            },
            policyPassed,
          ),
          behaviorPassed: checks.passed,
          regressionPassed: regressions.passed,
          scopePassed: scoped,
          changedPaths: changes,
          independentCheckChangedPaths,
          error,
          independentCheck: [checks.output, regressions.output].filter(Boolean).join('\n'),
        });
      } catch (err) {
        result.error = String(err);
        result.passed = false;
      }
      // Retain every started attempt even if later infrastructure work fails.
      await writeFile(join(destination, 'attempts.json'), JSON.stringify(results, null, 2));
    }
const report = {
  version: 2,
  generatedAt: new Date().toISOString(),
  conditions: {
    harnessVersion: packageInfo.version,
    harnessSourceSHA256,
    phase,
    smokeReport: smokePath ? resolve(smokePath) : null,
    harnessRevision,
    workingTreeDirty,
    runtimeVersion,
    split,
    corpusSHA256: createHash('sha256').update(corpusText).digest('hex'),
    configuredMainModel: profile.model,
    configSHA256: createHash('sha256').update(configText).digest('hex'),
    configuredWorkerModels: harnessOptions?.models ?? null,
    harnessOptions,
    primarySteps: profile.agents.aorchestra.steps,
    executorSteps: profile.agents['aorchestra-executor'].steps,
    timeoutMs,
    independentCheckTimeoutMs: 10_000,
    repetitions,
    strategy: selected,
    nativeConfigDiscovery: true,
    settingsFingerprint: frozenSettingsFingerprint ?? null,
    strategyOrder: 'paired; DIRECT first on odd repetitions, SELECTIVE first on even repetitions',
    directRestriction: 'native session deny: aorchestra_delegate and subagent',
  },
  results,
  summary: {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    strategies: comparison(results),
    cases: caseComparisons(results),
  },
  limitations: [
    'Synthetic brownfield baseline; not representative of large real-world repositories',
    'Costs are native counter estimates, not provider invoices; incomplete correlation, lifecycle or counters prevent cost-per-success comparisons',
    '--auto is used only for isolated evaluation fixtures; explicit denials remain enforced',
  ],
};
await writeFile(join(destination, 'report.json'), JSON.stringify(report, null, 2));
await writeFile(join(destination, 'report.md'), evaluationMarkdown(results));
console.log(JSON.stringify(report, null, 2));
process.exit(results.every((r) => r.passed) ? 0 : 1);
