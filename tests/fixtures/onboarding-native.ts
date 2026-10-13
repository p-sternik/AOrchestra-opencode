// Opt-in no-inference integration check against an installed native V2 binary.
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { privateClient, command } from '../../scripts/runtime';
import { setupRpc, type SetupStatus } from '../../lib/version-status';
import pkg from '../../package.json';

const scratch = await mkdtemp(join(tmpdir(), 'aorchestra-onboarding-native-'));
let close = async () => {};
let inferenceRequests = 0;
let registry: ReturnType<typeof Bun.serve> | undefined;
const root = resolve(import.meta.dir, '../..');
const automatic = process.argv.includes('--configured-model');
try {
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error('Run through npm exec -- bun tests/fixtures/onboarding-native.ts');
  const pack = Bun.spawn(['node', npm, 'pack', '--json', '--pack-destination', scratch], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const packed = JSON.parse(await new Response(pack.stdout).text());
  if ((await pack.exited) !== 0) throw new Error(await new Response(pack.stderr).text());
  const info = Array.isArray(packed) ? packed[0] : (packed[pkg.name] ?? packed);
  const archive = join(scratch, info.filename);
  registry = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path.startsWith('/inference')) {
        inferenceRequests++;
        return new Response('Inference is forbidden in this check', { status: 503 });
      }
      if (path === '/archive.tgz') return new Response(Bun.file(archive));
      if (path === `/${pkg.name}` || path === `/${pkg.name}/latest`) {
        const version = {
          ...pkg,
          dist: { tarball: `http://127.0.0.1:${registry!.port}/archive.tgz` },
        };
        return Response.json(
          path.endsWith('/latest')
            ? version
            : {
                name: pkg.name,
                'dist-tags': { latest: pkg.version },
                versions: { [pkg.version]: version },
              },
        );
      }
      return Response.redirect(
        `https://registry.npmjs.org${path}${new URL(request.url).search}`,
        302,
      );
    },
  });
  const directory = join(scratch, 'config'),
    project = join(scratch, 'project');
  await Promise.all([mkdir(directory), mkdir(project)]);
  await writeFile(join(project, 'README.md'), '# Native onboarding fixture\n');
  const configPath = join(directory, 'opencode.jsonc');
  await writeFile(
    configPath,
    '// preserve this comment\n' +
      JSON.stringify({
        ...(automatic ? { model: 'aorchestra-smoke/main' } : {}),
        default_agent: 'build',
        agents: { keep: { system: 'Preserve this unrelated agent.' } },
        providers: {
          'aorchestra-smoke': {
            name: 'No-inference fixture',
            env: ['AORCHESTRA_SMOKE_KEY'],
            package: '@opencode/ai/providers/openai-compatible',
            settings: {
              apiKey: 'unused-smoke-key',
              baseURL: `http://127.0.0.1:${registry.port}/inference`,
            },
            models: { main: { name: 'No-inference fixture', capabilities: { tools: true } } },
          },
        },
      }),
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENCODE_CONFIG_DIR: directory,
    OPENCODE_DB: join(scratch, 'native.db'),
    OPENCODE_TEST_HOME: join(scratch, 'home'),
    XDG_DATA_HOME: join(scratch, 'data'),
    XDG_STATE_HOME: join(scratch, 'state'),
    XDG_CACHE_HOME: join(scratch, 'cache'),
    npm_config_registry: `http://127.0.0.1:${registry.port}`,
    AORCHESTRA_SMOKE_KEY: 'unused-smoke-key',
    AORCHESTRA_DISABLE_UPDATE: '1',
  };
  delete env.OPENCODE_CONFIG;
  delete env.OPENCODE_CONFIG_CONTENT;
  delete env.AORCHESTRA_DISABLE_SETUP;
  await command(
    ['plugin', 'add', `${pkg.name}@${automatic ? pkg.version : 'latest'}`],
    project,
    600000,
    env,
  );
  const registered = await readFile(configPath, 'utf8');
  const temporary = await privateClient(project, env);
  close = temporary.close;
  const client = temporary.client;
  await client.location.get({ location: { directory: project } });
  const rpc = client.rpc(setupRpc);
  let status: SetupStatus | undefined;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      status = (await rpc.get({}, { location: { directory: project } })) as SetupStatus;
    } catch {}
    if (status && !['checking', 'configuring'].includes(status.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (
    !automatic &&
    (status?.state !== 'needs-model' || !status.models.includes('aorchestra-smoke/main'))
  )
    throw new Error(`NATIVE_MODEL_PICKER_STATE: ${JSON.stringify(status)}`);
  if (!automatic && (await readFile(configPath, 'utf8')) !== registered)
    throw new Error('CONFIG_CHANGED_BEFORE_MODEL_CHOICE');
  if (!automatic)
    status = (await rpc.configure(
      { model: 'aorchestra-smoke/main' },
      { location: { directory: project } },
    )) as SetupStatus;
  if (!status || !['restart-required', 'ready'].includes(status.state))
    throw new Error(
      `NATIVE_CONFIGURATION_FAILED: ${JSON.stringify({ status, plugins: (await client.plugin.list({ location: { directory: project } })).data.filter((plugin) => plugin.source.type === 'package') })}`,
    );
  const text = await readFile(configPath, 'utf8');
  const config = JSON.parse(text.replace(/^\/\/[^\n]*\n/, ''));
  if (
    !text.includes('// preserve this comment') ||
    config.default_agent !== 'build' ||
    config.agents.keep.system !== 'Preserve this unrelated agent.' ||
    !config.agents.aorchestra.system.includes('bounded') ||
    !config.agents['aorchestra-executor']
  )
    throw new Error('NATIVE_CONFIG_PRESERVATION_FAILED');
  const backups = (await readdir(directory)).filter((name) => name.includes('.aorchestra-backup-'));
  if (backups.length !== 1 || (await readFile(join(directory, backups[0]), 'utf8')) !== registered)
    throw new Error('NATIVE_BACKUP_MISMATCH');
  await close();
  close = async () => {};
  const restarted = await privateClient(project, env);
  close = restarted.close;
  await restarted.client.location.get({ location: { directory: project } });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      ready =
        (
          (await restarted.client
            .rpc(setupRpc)
            .get({}, { location: { directory: project } })) as SetupStatus
        ).state === 'ready';
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const agents = (await restarted.client.agent.list({ location: { directory: project } })).data;
  if (
    !ready ||
    !agents.some((agent) => agent.id === 'aorchestra') ||
    !agents.some((agent) => agent.id === 'aorchestra-executor')
  )
    throw new Error('NATIVE_RESTART_FAILED');
  if ((await readFile(configPath, 'utf8')) !== text)
    throw new Error('SETUP_REPEATED_AFTER_RESTART');
  if (inferenceRequests !== 0) throw new Error('UNEXPECTED_INFERENCE');
  console.log(
    JSON.stringify({
      nativePluginAdd: true,
      modelChoice: !automatic,
      configuredModelReused: automatic,
      configPreserved: true,
      backupVerified: true,
      noInferenceCheckPassed: true,
      restartResolvedAgents: true,
      modelCalls: inferenceRequests,
    }),
  );
} finally {
  await close();
  registry?.stop(true);
  await rm(scratch, { recursive: true, force: true });
}
