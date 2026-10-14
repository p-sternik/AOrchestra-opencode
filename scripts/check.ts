import { resolve, dirname } from 'node:path';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { command, binary, privateClient, removeTemporary, assertRuntime } from './runtime';
import { metricsRpc, type Run } from '../lib/telemetry';
import { Npm } from '@opencode/util/npm';
import { BUNDLED_SKILLS, permissionRules } from '../lib/core';
import { prepareEvaluationSession, trajectorySessionIDs } from './eval-usage';
import { versionRpc, setupRpc, type SetupStatus, type VersionStatus } from '../lib/version-status';
import packageInfo from '../package.json';
const root = resolve(import.meta.dir, '..');
const globalMode = process.argv.includes('--global');
const scratch = resolve(root, 'work/runtime');
// A project containing the template would override global config during discovery.
const neutralProject =
  globalMode && !process.env.AORCHESTRA_CHECK_PROJECT
    ? await mkdtemp(resolve(tmpdir(), 'aorchestra-global-check-'))
    : undefined;
const project = resolve(process.env.AORCHESTRA_CHECK_PROJECT || neutralProject || root);
const version = (await command(['--version'], root)).trim();
assertRuntime(version);
const source = await Bun.file(resolve(root, 'opencode.json')).json();
if (!source.agents?.aorchestra || !source.agents?.['aorchestra-executor'])
  throw new Error('AGENTS_MISSING');
if (source.agent || source.agents.aorchestra.tools || source.agents['aorchestra-executor'].tools)
  throw new Error('LEGACY_CONFIG');
const pkg = await Bun.file(
  resolve(dirname(Bun.resolveSync('@opencode/plugin', root)), '../../package.json'),
).json();
if (pkg.version !== '2.0.26') throw new Error('PLUGIN_VERSION_MISMATCH');
await mkdir(scratch, { recursive: true });
const checkEnv: NodeJS.ProcessEnv = {
  ...process.env,
  AORCHESTRA_DISABLE_UPDATE: '1',
  AORCHESTRA_DISABLE_SETUP: '1',
  OPENCODE_DB: resolve(scratch, globalMode ? 'global-check.db' : 'check.db'),
};
if (globalMode) {
  delete checkEnv.OPENCODE_CONFIG;
  delete checkEnv.OPENCODE_CONFIG_CONTENT;
} else checkEnv.OPENCODE_CONFIG = resolve(root, 'opencode.json');
const temporary = await privateClient(globalMode ? project : root, checkEnv);
const { client } = temporary;
try {
  let globalTargets: string[] = [];
  await client.location.get({ location: { directory: project } });
  if (globalMode) {
    const paths = await command(['debug', 'paths'], project, 120_000, checkEnv);
    const directory = checkEnv.OPENCODE_CONFIG_DIR ?? /^config\s+(.+)$/m.exec(paths)?.[1]?.trim();
    if (!directory) throw new Error('GLOBAL_CONFIG_DIRECTORY_UNKNOWN');
    const entries = await client.config.get({ location: { directory: project } });
    const globalFiles = ['opencode.json', 'opencode.jsonc'].map((name) => resolve(directory, name));
    const documents = entries.filter(
      (entry) =>
        entry.type === 'document' && entry.path && globalFiles.includes(resolve(entry.path)),
    );
    if (
      !['aorchestra', 'aorchestra-executor'].every((id) =>
        documents.some((entry) => entry.type === 'document' && entry.info.agents?.[id]),
      )
    )
      throw new Error('GLOBAL_AGENT_CONFIG_MISSING');
    globalTargets = documents.flatMap((entry) =>
      entry.type === 'document'
        ? (entry.info.plugins ?? []).map((plugin) => {
            const target = typeof plugin === 'string' ? plugin : plugin.package;
            return target.startsWith('./') || target.startsWith('../')
              ? resolve(dirname(entry.path!), target)
              : target;
          })
        : [],
    );
  }
  // The pinned native shell API supports bounded output retrieval without inference.
  // This is an API byte limit, separate from model-facing tool_output truncation.
  const outputScript = resolve(scratch, 'large-json.cjs');
  await Bun.write(
    outputScript,
    'console.log(JSON.stringify(Array.from({length:20000},(_,id)=>({id,text:"x".repeat(64)}))));',
  );
  const nativeShell = await client.shell.create({
    location: { directory: project },
    command: `node "${outputScript}"`,
    timeout: 10_000,
  });
  try {
    let terminal = nativeShell.data;
    for (let attempt = 0; attempt < 100 && terminal.status === 'running'; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      terminal = (
        await client.shell.get({ id: nativeShell.data.id, location: { directory: project } })
      ).data;
    }
    if (terminal.status !== 'exited' || terminal.exit !== 0)
      throw new Error('NATIVE_JSON_OUTPUT_FAILED');
    const bounded = (
      await client.shell.output({ id: terminal.id, limit: 12000, location: { directory: project } })
    ).data;
    if (
      bounded.size < 1_000_000 ||
      Buffer.byteLength(bounded.output) !== 12000 ||
      bounded.cursor !== 12000 ||
      bounded.cursor >= bounded.size
    )
      throw new Error('NATIVE_OUTPUT_LIMIT_FAILED');
    const next = (
      await client.shell.output({
        id: terminal.id,
        cursor: bounded.cursor,
        limit: 12000,
        location: { directory: project },
      })
    ).data;
    if (next.cursor <= bounded.cursor || Buffer.byteLength(next.output) > 12000)
      throw new Error('NATIVE_OUTPUT_CURSOR_FAILED');
  } finally {
    await client.shell.remove({ id: nativeShell.data.id, location: { directory: project } });
  }
  const bootstrap = await client.session.create({ location: { directory: project } });
  let [plugins, agents] = await Promise.all([
    client.plugin.list({ location: { directory: project } }),
    client.agent.list({ location: { directory: project } }),
  ]);
  for (
    let attempt = 0;
    attempt < 120 &&
    !plugins.data.some((p) => p.id === 'aorchestra' && p.state.status === 'active');
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    [plugins, agents] = await Promise.all([
      client.plugin.list({ location: { directory: project } }),
      client.agent.list({ location: { directory: project } }),
    ]);
  }
  if (
    !plugins.data.some((plugin) => plugin.id === 'aorchestra' && plugin.state.status === 'active')
  ) {
    console.log(
      JSON.stringify(
        {
          location: bootstrap.location,
          localPluginStates: plugins.data
            .filter((p) => p.source.type === 'local')
            .map((p) => ({ id: p.id, state: p.state })),
          primaryFound: agents.data.some((a) => a.id === 'aorchestra'),
        },
        null,
        2,
      ),
    );
    throw new Error('PLUGIN_NOT_LOADED');
  }
  const active = plugins.data.filter(
    (plugin) => plugin.id === 'aorchestra' && plugin.state.status === 'active',
  );
  if (active.length !== 1) throw new Error('DUPLICATE_AORCHESTRA_PLUGINS');
  const loaded = active[0];
  const registered =
    loaded.source.type === 'package'
      ? globalTargets.includes(loaded.source.target)
      : loaded.source.type === 'local' &&
        (globalTargets.includes(loaded.source.path) ||
          globalTargets.includes(dirname(loaded.source.path)));
  if (globalMode && !registered) throw new Error('GLOBAL_PLUGIN_CONFIG_MISSING');
  const bundleRoot =
    loaded.source.type === 'package' ? (await Npm.resolve(loaded.source.target)).directory : root;
  const loadedVersion =
    loaded.source.type === 'package' ? loaded.source.version : packageInfo.version;
  const status = (await client
    .rpc(versionRpc)
    .get({}, { location: { directory: project } })) as VersionStatus;
  if (
    status.version !== loadedVersion ||
    status.availableVersion !== null ||
    status.installedVersion !== null ||
    status.updateError !== undefined
  )
    throw new Error('NATIVE_VERSION_STATUS_MISMATCH');
  if (!globalMode) {
    const setup = (await client
      .rpc(setupRpc)
      .get({}, { location: { directory: project } })) as SetupStatus;
    if (setup.state !== 'skipped') throw new Error('NATIVE_SETUP_GUARD_MISSING');
  }
  const expectedSkills = BUNDLED_SKILLS.map((skill) => ({
    ...skill,
    path: resolve(bundleRoot, `skills/${skill.directory}/SKILL.md`),
  }));
  if (!agents.data.some((agent) => agent.id === 'aorchestra'))
    throw new Error('RESOLVED_PRIMARY_MISSING');
  const session = await client.session.create({
    agent: 'aorchestra-executor',
    location: { directory: project },
    permissions: [
      { action: '*', resource: '*', effect: 'deny' },
      { action: 'read', resource: 'README.md', effect: 'allow' },
    ],
  });
  const persisted = await client.session.get({ sessionID: session.id });
  // Exercise the shipped policy through native evaluation without dispatching tools
  // or depending on the user's customized global permission rules.
  const permissionSession = await client.session.create({
    agent: 'aorchestra',
    location: { directory: project },
    permissions: source.agents.aorchestra.permissions,
  });
  const assertPermission = async (
    sessionID: string,
    resources: string[],
    expected: 'allow' | 'ask' | 'deny',
    action = 'shell',
  ) => {
    const agent = action === 'skill' ? (await client.session.get({ sessionID })).agent : undefined;
    const decision = await client.permission.create({ sessionID, action, resources, agent });
    if (decision.effect === 'ask')
      await client.permission.reply({ sessionID, requestID: decision.id, decision: 'reject' });
    if (decision.effect !== expected)
      throw new Error(
        `NATIVE_PERMISSION_MISMATCH: ${JSON.stringify(resources)} expected ${expected}, got ${decision.effect}`,
      );
  };
  try {
    for (const manager of ['npm', 'pnpm', 'yarn', 'bun'])
      for (const script of ['typecheck', 'lint', 'test'])
        await assertPermission(permissionSession.id, [`${manager} run ${script}`], 'allow');
    for (const resource of [
      'bun test',
      'bun test tests/api.test.ts',
      'git status --short',
      'git diff HEAD',
      'git log -5',
      'git show HEAD',
      'git rev-parse HEAD',
    ])
      await assertPermission(permissionSession.id, [resource], 'allow');
    await assertPermission(permissionSession.id, ['npm publish'], 'ask');
    await assertPermission(permissionSession.id, ['npm run test', 'npm publish'], 'ask');
    await assertPermission(permissionSession.id, ['npm run test > output.txt'], 'ask');
    await assertPermission(permissionSession.id, ['git push origin main'], 'deny');
    await assertPermission(session.id, ['npm run test'], 'deny');
    for (const skill of BUNDLED_SKILLS) {
      await assertPermission(permissionSession.id, [skill.id], 'allow', 'skill');
      await assertPermission(session.id, [skill.id], 'deny', 'skill');
    }
    await assertPermission(permissionSession.id, ['unrelated-skill'], 'deny', 'skill');
    for (const skill of BUNDLED_SKILLS) {
      for (const prefix of [
        '/global/opencode',
        '/global/opencode/cache/npm/package@0.9.0/install',
      ]) {
        const directory = `${prefix}/node_modules/aorchestra-opencode-v2/skills/${skill.directory}`;
        await assertPermission(
          permissionSession.id,
          [`${directory}/*`],
          'allow',
          'external_directory',
        );
        await assertPermission(
          permissionSession.id,
          [`${directory}/references/*`],
          'allow',
          'external_directory',
        );
        await assertPermission(session.id, [`${directory}/*`], 'deny', 'external_directory');
      }
    }
    for (const directory of [
      '/global/opencode/node_modules/*',
      '/global/opencode/node_modules/another-plugin/skills/improve/*',
      '/global/opencode/node_modules/aorchestra-opencode-v2/lib/*',
      '/global/opencode/node_modules/aorchestra-opencode-v2/skills/other/*',
      '/global/opencode/node_modules/aorchestra-opencode-v2/skills/improve-extra/*',
      '/outside/project/*',
    ])
      await assertPermission(permissionSession.id, [directory], 'ask', 'external_directory');
    if (!globalMode) {
      const protocolSessions: string[] = [];
      try {
        let settings: string | undefined;
        for (const strategy of ['direct', 'selective'] as const) {
          const prepared = await prepareEvaluationSession(
            project,
            checkEnv,
            strategy,
            'aorchestra-smoke-missing-provider/missing',
            async () => ({ client, close: async () => {} }),
          );
          protocolSessions.push(prepared.sessionID);
          const current = JSON.stringify(prepared.settings);
          settings ??= current;
          if (current !== settings) throw new Error('NATIVE_EVALUATION_SETTINGS_MISMATCH');
          // Resume exactly as eval.ts does, with an unavailable provider so no
          // external inference can run. --auto must preserve explicit session denies.
          let resumeOutput = '';
          await command(
            [
              'run',
              '--standalone',
              '--session',
              prepared.sessionID,
              '--agent',
              'aorchestra',
              '--model',
              'aorchestra-smoke-missing-provider/missing',
              '--auto',
              '--format',
              'json',
              'Controlled protocol resume smoke',
            ],
            project,
            20_000,
            checkEnv,
            (chunk) => {
              resumeOutput += chunk;
            },
          ).catch(() => {});
          if (
            JSON.stringify(trajectorySessionIDs(resumeOutput)) !==
            JSON.stringify([prepared.sessionID])
          )
            throw new Error('NATIVE_EVALUATION_RESUME_NOT_OBSERVED');
          await assertPermission(
            prepared.sessionID,
            ['*'],
            strategy === 'direct' ? 'deny' : 'allow',
            'aorchestra_delegate',
          );
          await assertPermission(prepared.sessionID, ['*'], 'deny', 'subagent');
          await assertPermission(prepared.sessionID, ['README.md'], 'allow', 'read');
          await assertPermission(prepared.sessionID, ['README.md'], 'allow', 'edit');
          await assertPermission(prepared.sessionID, ['bun test'], 'allow');
          if ((await client.session.list({ parentID: prepared.sessionID })).data.length)
            throw new Error('NATIVE_DIRECT_CHILD_OBSERVED');
        }
      } finally {
        await Promise.all(
          protocolSessions.map((sessionID) => client.session.remove({ sessionID })),
        );
      }
    }
    const concurrentChildren = await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        client.session.create({
          parentID: permissionSession.id,
          agent: 'aorchestra-executor',
          location: { directory: project },
          permissions: permissionRules({
            owner: permissionSession.id,
            taskId: `native-analysis-${index}`,
            root: project,
            tools: ['read'],
            writePaths: [],
            kind: 'analysis',
          }),
        }),
      ),
    );
    try {
      const persistedChildren = await Promise.all(
        concurrentChildren.map((child) => client.session.get({ sessionID: child.id })),
      );
      if (
        new Set(persistedChildren.map((child) => child.id)).size !== 3 ||
        persistedChildren.some((child) => child.parentID !== permissionSession.id)
      )
        throw new Error('NATIVE_CONCURRENT_CHILD_MISMATCH');
      for (const child of concurrentChildren) {
        await assertPermission(child.id, ['README.md'], 'allow', 'read');
        await assertPermission(child.id, ['README.md'], 'deny', 'edit');
        await assertPermission(child.id, ['bun test'], 'deny');
      }
    } finally {
      await Promise.all(
        concurrentChildren.map((child) => client.session.remove({ sessionID: child.id })),
      );
    }
  } finally {
    await client.session.remove({ sessionID: permissionSession.id });
  }
  if (!globalMode) {
    let frozen: string | undefined;
    const sessionIDs = new Set<string>();
    for (const strategy of ['direct', 'selective'] as const) {
      const attempt = await mkdtemp(resolve(scratch, 'eval-protocol-'));
      const cwd = resolve(attempt, 'workspace');
      await mkdir(cwd);
      const prepared = await prepareEvaluationSession(
        cwd,
        { ...checkEnv, OPENCODE_DB: resolve(attempt, 'opencode.db') },
        strategy,
        'aorchestra-smoke-missing-provider/missing',
      );
      const settings = JSON.stringify(prepared.settings);
      frozen ??= settings;
      if (settings !== frozen || sessionIDs.has(prepared.sessionID))
        throw new Error('NATIVE_FRESH_EVALUATION_MISMATCH');
      sessionIDs.add(prepared.sessionID);
    }
  }
  let skills = await client.skill.list({ location: { directory: project } });
  const registeredSkills = () =>
    expectedSkills.every((expected) =>
      skills.data.some(
        (skill) =>
          skill.id === expected.id && skill.path === expected.path && skill.autoinvoke === false,
      ),
    );
  for (let attempt = 0; attempt < 10 && !registeredSkills(); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    skills = await client.skill.list({ location: { directory: project } });
  }
  if (!registeredSkills()) {
    console.log(
      JSON.stringify({
        skills: skills.data.filter((skill) =>
          expectedSkills.some((expected) => expected.id === skill.id),
        ),
        expected: expectedSkills,
      }),
    );
    throw new Error('BUNDLED_SKILL_NOT_REGISTERED_EXPLICITLY');
  }
  const rpc = client.rpc(metricsRpc);
  const controlled = await client.session.create({
    agent: 'aorchestra',
    location: { directory: project },
    model: { providerID: 'aorchestra-smoke-missing-provider', id: 'missing' },
  });
  await client.session
    .prompt({
      sessionID: controlled.id,
      text: 'Controlled local smoke failure. No external model should run.',
    })
    .catch(() => {});
  await client.session
    .wait({ sessionID: controlled.id }, { signal: AbortSignal.timeout(10000) })
    .catch(() => {});
  let metrics: { version: 1; runs: Run[]; next: string | null } | undefined;
  for (let attempt = 0; attempt < 40; attempt++) {
    metrics = (await rpc.list(
      { limit: 500 },
      { location: { directory: project } },
    )) as typeof metrics;
    if (metrics?.runs.some((r) => r.sessionID === controlled.id && r.endedAt !== null)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const observed = metrics?.runs.find((r) => r.sessionID === controlled.id && r.endedAt !== null);
  if (!observed || observed.runtimeOutcome !== 'failed')
    throw new Error('NATIVE_FAILURE_TELEMETRY_NOT_OBSERVED');
  await Bun.write(
    resolve(scratch, 'check.metrics.json'),
    JSON.stringify({ version: 1, runs: metrics!.runs }, null, 2),
  );
  await client.session.remove({ sessionID: session.id });
  await client.session.remove({ sessionID: bootstrap.id });
  console.log(
    JSON.stringify(
      {
        binary,
        runtime: version,
        configMode: globalMode ? 'global-discovery' : 'repository-profile',
        project,
        pluginApi: pkg.version,
        pluginLoaded: true,
        loadedVersion: status.version,
        resolvedAgents: true,
        nativeSessionCreated: !!persisted.id,
        nativePermissionPolicy: true,
        nativeConcurrentReadOnlyChildren: 3,
        bundledSkill: true,
        skillAutoinvoke: false,
        nativeFailureTelemetry: true,
        nativeLargeJsonOutputLimit: true,
        nativeEvaluationProtocols: globalMode ? null : true,
        nativeEvaluationFreshAttempts: globalMode ? null : true,
        modelCalls: 0,
      },
      null,
      2,
    ),
  );
} finally {
  await temporary.close();
  if (neutralProject) await removeTemporary(neutralProject, 'aorchestra-global-check-');
}
// The native package resolver retains its service scope; this is a one-shot CLI.
process.exit(0);
