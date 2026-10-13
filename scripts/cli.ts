import { readFile, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Npm } from '@opencode/util/npm';
import {
  mergeSetup,
  readConfig,
  saveConfig,
  isAOrchestraTarget,
  globalEnvironment,
  primaryPermissions,
  setupPackage,
  assertSetupVersion,
  assertManagedUpdate,
  type Models,
} from '../lib/setup';
import {
  command,
  binary,
  privateClient,
  removeTemporary,
  assertRuntime,
  OPENCODE_RUNTIME_RANGE,
} from './runtime';
import pkg from '../package.json';

const root = resolve(import.meta.dir, '..');
const args = process.argv.slice(2);
const operation = args[0];
const value = (name: string) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!operation || args.includes('--help') || operation === 'help') {
  console.log(
    `AOrchestra ${pkg.version}\n\nUsage: aorchestra setup [--model=provider/model] [--fast=...] [--balanced=...] [--strong=...] [--default] [--channel=stable|main | --package=npm-or-git-spec]\n       aorchestra configure [--model=provider/model] [--package=registered-spec]\n       aorchestra check [--project=/path]\n       aorchestra report [report options]\n\nRequires Bun and OpenCode ${OPENCODE_RUNTIME_RANGE}. Set OPENCODE_BIN if V2 is not named opencode2.\nSetup preserves global JSONC and makes no model calls. Stable setup pins this CLI version from npm; --channel=main pins a Git commit. Configure completes an existing plugin registration without reinstalling.`,
  );
  process.exit(0);
}
if (operation === '--version') {
  console.log(pkg.version);
  process.exit(0);
}
try {
  if (operation === 'check' || operation === 'report') {
    const env = { ...process.env };
    if (value('project')) env.AORCHESTRA_CHECK_PROJECT = resolve(value('project')!);
    const child = Bun.spawn(
      [
        'bun',
        join(root, operation === 'check' ? 'scripts/check.ts' : 'scripts/report.ts'),
        ...(operation === 'check' ? ['--global'] : args.slice(1)),
      ],
      { env, stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' },
    );
    process.exit(await child.exited);
  }
  if (operation !== 'setup' && operation !== 'configure')
    throw new Error('UNKNOWN_COMMAND: use --help');
  if (operation === 'configure' && (value('channel') || value('update-from')))
    throw new Error('UNKNOWN_OPTION: configure does not install or switch channels');
  const allowed = new Set([
    'model',
    'fast',
    'balanced',
    'strong',
    'package',
    'channel',
    'update-from',
  ]);
  if (
    args
      .slice(1)
      .some(
        (arg) =>
          arg !== '--default' &&
          (!arg.startsWith('--') || !allowed.has(arg.slice(2).split('=')[0]) || !arg.includes('=')),
      )
  )
    throw new Error('UNKNOWN_OPTION: use --help');
  const spec = await setupPackage(pkg.version, value('package'), value('channel'), async () => {
    const revision = Bun.spawnSync(
      [
        'git',
        'ls-remote',
        'https://github.com/p-sternik/AOrchestra-opencode.git',
        'refs/heads/main',
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    if (revision.exitCode !== 0)
      throw new Error('CANNOT_PIN_GITHUB_REVISION: provide --package explicitly');
    return new TextDecoder().decode(revision.stdout).split(/\s/)[0];
  });
  const updateFrom = value('update-from');
  if (updateFrom !== undefined && !/^aorchestra-opencode-v2@\d+\.\d+\.\d+$/.test(updateFrom))
    throw new Error('INVALID_UPDATE_SOURCE');
  if (
    updateFrom &&
    (!Bun.semver.satisfies(pkg.version, `>${updateFrom.split('@')[1]}`) ||
      pkg.version.split('.')[0] !== updateFrom.split('@')[1].split('.')[0])
  )
    throw new Error('AUTO_UPDATE_VERSION_REJECTED');
  if (
    updateFrom &&
    (value('package') ||
      value('channel') ||
      args.includes('--default') ||
      ['model', 'fast', 'balanced', 'strong'].some(value))
  )
    throw new Error('AUTO_UPDATE_OPTION_CONFLICT');
  const version = await command(['--version'], root);
  assertRuntime(version);
  const neutral = await mkdtemp(join(tmpdir(), 'aorchestra-setup-'));
  try {
    const env: NodeJS.ProcessEnv = {
      ...globalEnvironment(process.env),
      AORCHESTRA_DISABLE_UPDATE: '1',
      AORCHESTRA_DISABLE_SETUP: '1',
    };
    const paths = await command(['debug', 'paths'], neutral, 120000, env);
    const directory = resolve(
      env.OPENCODE_CONFIG_DIR ??
        /^config\s+(.+)$/m.exec(paths)?.[1]?.trim() ??
        (() => {
          throw new Error('GLOBAL_CONFIG_UNKNOWN');
        })(),
    );
    const jsonc = join(directory, 'opencode.jsonc'),
      json = join(directory, 'opencode.json');
    const read = (path: string) =>
      readFile(path, 'utf8').catch((error) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
    const [jsoncText, jsonText] = await Promise.all([read(jsonc), read(json)]);
    if (jsonText !== undefined) readConfig(jsonText);
    const configPath = jsoncText !== undefined ? jsonc : json;
    const before = jsoncText ?? jsonText;
    const config = readConfig(before ?? '{}');
    const lowerConfig =
      jsoncText !== undefined && jsonText !== undefined ? readConfig(jsonText) : undefined;
    if (updateFrom) assertManagedUpdate(config, updateFrom);
    if (jsonText !== undefined && jsoncText !== undefined) {
      const lower = lowerConfig!;
      const targets =
        lower.plugins?.map((p: any) => (typeof p === 'string' ? p : p?.package)) ?? [];
      if (targets.some((target: any) => typeof target === 'string' && isAOrchestraTarget(target)))
        throw new Error(
          'AORCHESTRA_IN_LOWER_PRIORITY_CONFIG: move its JSON registration into JSONC before setup',
        );
    }
    // Model discovery needs the user's normal DB because V2 stores credentials there.
    // Only the subsequent smoke check uses a separate test DB.
    const temporary = await privateClient(neutral, env);
    const prior =
      config.agents?.aorchestra?.model ??
      lowerConfig?.agents?.aorchestra?.model ??
      config.model ??
      lowerConfig?.model;
    const configuredTiers = config.plugins?.find(
      (entry: any) => entry && typeof entry === 'object' && isAOrchestraTarget(entry.package ?? ''),
    )?.options?.models;
    const preferred = [
      value('model') ?? (typeof prior === 'string' ? prior : undefined),
      ...['fast', 'balanced', 'strong'].map((name) => value(name) ?? configuredTiers?.[name]),
    ].filter((model): model is string => typeof model === 'string');
    let available: string[] = [];
    let observedTargets: string[] = [];
    let configuredVersion: string | undefined;
    try {
      await temporary.client.location.get({ location: { directory: neutral } });
      for (let attempt = 0; attempt < 20; attempt++) {
        available = (
          await temporary.client.model.list({ location: { directory: neutral } })
        ).data.map((model) => `${model.providerID}/${model.id}`);
        if (available.length && preferred.every((model) => available.includes(model))) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const loaded = (
        await temporary.client.plugin.list({ location: { directory: neutral } })
      ).data.filter((plugin) => plugin.id === 'aorchestra');
      const configuredSource = loaded.find((plugin) => plugin.source.type === 'package')?.source;
      configuredVersion =
        configuredSource?.type === 'package' ? configuredSource.version : undefined;
      observedTargets = loaded.flatMap((plugin) =>
        plugin.source.type === 'package'
          ? [plugin.source.target]
          : plugin.source.type === 'local'
            ? [plugin.source.path]
            : [],
      );
    } finally {
      await temporary.close();
    }
    let primary =
      value('model') ??
      (typeof prior === 'string' && available.includes(prior) ? prior : undefined);
    if (!primary && stdin.isTTY) {
      console.log('Choose an available main model (all tiers use it unless specified):');
      for (const model of available) console.log(`  ${model}`);
      const prompt = createInterface({ input: stdin, output: stdout });
      try {
        primary = (await prompt.question('provider/model: ')).trim();
      } finally {
        prompt.close();
      }
    }
    if (!primary)
      throw new Error('MODEL_REQUIRED: pass --model=provider/model after provider sign-in');
    const priorOptions = config.plugins?.find(
      (entry: any) =>
        entry &&
        typeof entry === 'object' &&
        (isAOrchestraTarget(entry.package ?? '') || observedTargets.includes(entry.package)),
    )?.options?.models;
    const tier = (name: string) =>
      value(name) ??
      (typeof priorOptions?.[name] === 'string' &&
      (updateFrom || available.includes(priorOptions[name]))
        ? priorOptions[name]
        : primary!);
    const models: Models = {
      primary,
      fast: tier('fast'),
      balanced: tier('balanced'),
      strong: tier('strong'),
    };
    for (const model of Object.values(models))
      if (!available.includes(model)) throw new Error(`MODEL_NOT_IN_CATALOGUE: ${model}`);
    if (operation === 'configure') {
      if (!configuredVersion || !observedTargets.some(isAOrchestraTarget))
        throw new Error('PLUGIN_REGISTRATION_REQUIRED: run plugin add or setup first');
      assertSetupVersion(pkg.version, configuredVersion, spec);
      if (value('package') && !observedTargets.includes(spec))
        throw new Error(
          'REGISTERED_PACKAGE_REQUIRED: configure cannot change the installed source',
        );
      if (
        !value('package') &&
        !observedTargets.some((target) => target === pkg.name || target.startsWith(`${pkg.name}@`))
      )
        throw new Error('REGISTERED_PACKAGE_REQUIRED: pass the registered Git spec with --package');
    }
    console.log(
      operation === 'setup'
        ? 'Installing through OpenCode’s native package manager…'
        : 'Configuring the registered plugin without reinstalling…',
    );
    // Let the V2 executable perform installation with its own runtime. Its config
    // write goes to a staging directory; we merge the real JSONC ourselves.
    if (operation === 'setup')
      await command(['plugin', 'add', spec], neutral, 600_000, {
        ...env,
        OPENCODE_CONFIG_DIR: join(neutral, 'install-config'),
      });
    const installed = operation === 'configure' ? { directory: root } : await Npm.resolve(spec);
    const installedPkg = JSON.parse(
      await readFile(join(installed.directory, 'package.json'), 'utf8'),
    );
    if (installedPkg.name !== pkg.name) throw new Error('UNEXPECTED_PLUGIN_PACKAGE');
    assertSetupVersion(pkg.version, installedPkg.version, spec);
    const template = JSON.parse(await readFile(join(installed.directory, 'opencode.json'), 'utf8'));
    for (const id of ['aorchestra', 'aorchestra-executor']) {
      template.agents[id].system = await readFile(
        join(installed.directory, 'instructions', `${id}.md`),
        'utf8',
      );
    }
    const after = mergeSetup(
      before ?? '{}',
      template,
      spec,
      models,
      args.includes('--default'),
      observedTargets,
      value('package') === undefined && value('channel') !== 'main',
      lowerConfig,
    );
    const permissionUpdate = primaryPermissions(
      readConfig(after).agents.aorchestra.permissions,
      template.agents.aorchestra.permissions,
    );
    if (lowerConfig && (await read(json)) !== jsonText)
      throw new Error('CONFIG_CHANGED_DURING_SETUP: retry after reviewing global JSON');
    const saved = await saveConfig(configPath, before, after);
    const updatePolicy = readConfig(after).plugins.find(
      (entry: any) => entry?.package === spec,
    )?.options;
    const automaticUpdates =
      updatePolicy?.updateManagedPackage === spec &&
      updatePolicy.autoUpdate !== false &&
      updatePolicy.updateCheck !== false;
    console.log(
      JSON.stringify(
        {
          version: installedPkg.version,
          package: spec,
          configPath,
          changed: saved.changed,
          backup: saved.backup ?? null,
          models,
          automaticUpdates,
          customPermissionsPreserved: permissionUpdate.customized,
        },
        null,
        2,
      ),
    );
    if (permissionUpdate.customized)
      console.log(
        'Custom AOrchestra permissions were preserved; routine-command defaults were not applied. Review agents.aorchestra.permissions to adopt them.',
      );
    const check = Bun.spawn(['bun', join(installed.directory, 'scripts/check.ts'), '--global'], {
      cwd: neutral,
      env: { ...env, OPENCODE_BIN: binary },
      stdout: 'inherit',
      stderr: 'inherit',
    });
    if ((await check.exited) !== 0)
      throw new Error(
        'GLOBAL_CHECK_FAILED: config saved; review the diagnostic and backup before retrying',
      );
    console.log(
      `Ready. In any project: ${binary} run --standalone --agent aorchestra "Your task"\nCatalogue checked; successful provider inference remains untested.`,
    );
    if (process.env.OPENCODE_CONFIG || process.env.OPENCODE_CONFIG_CONTENT)
      console.log(
        'Your current terminal has explicit config overrides; restore/unset them before normal global usage.',
      );
  } finally {
    await removeTemporary(neutral, 'aorchestra-setup-');
  }
} catch (error) {
  console.error(
    error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : error && typeof error === 'object' && '_tag' in error
        ? `Setup failed: ${error._tag}`
        : 'Setup failed',
  );
  process.exit(1);
}
process.exit(0);
