import type { Plugin } from '@opencode/plugin';
import { roots } from '@opencode/util/global-roots';
import { Flock } from '@opencode/util/flock';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { isAOrchestraTarget, readConfig, assertManagedUpdate } from './setup';
import pkg from '../package.json';
import { versionStatus, type VersionStatus } from './version-status';

const interval = 24 * 60 * 60 * 1000;
const key = 'updates/state';
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const failureMessage =
  'AOrchestra update check or installation could not finish. Run setup manually; if configuration changed, review its backup.';
export type Installation = { config: Record<string, any>; spec: string };
type UpdateState = {
  spec: string;
  checkedAt: number;
  message?: string;
  availableVersion?: string;
  installedVersion?: string;
  updateError?: string;
};
type Dependencies = {
  version: string;
  options: Record<string, unknown>;
  load: () => Promise<Installation | undefined>;
  get: () => Promise<unknown>;
  set: (state: UpdateState) => Promise<void>;
  publish?: (state: UpdateState) => void;
  latest: () => Promise<string>;
  install: (version: string, from: string) => Promise<void>;
  now?: () => number;
};
export function updateOptions(options: Record<string, unknown>): void {
  for (const name of ['autoUpdate', 'updateCheck'])
    if (options[name] !== undefined && typeof options[name] !== 'boolean')
      throw new Error(`INVALID_OPTION: ${name} must be boolean`);
}
// Called under a native cross-process lock. Persist the attempt before network
// access so offline startup and failed installation do not produce a retry loop.
export async function checkUpdate(deps: Dependencies): Promise<string | undefined> {
  updateOptions(deps.options);
  if (deps.options.updateCheck === false || !stable.test(deps.version)) return;
  const installed = await deps.load();
  if (!installed || installed.spec !== `${pkg.name}@${deps.version}`) return;
  const entry = installed.config.plugins.find((entry: any) => entry?.package === installed.spec);
  updateOptions(entry?.options ?? {});
  if (entry?.options?.updateCheck === false) return;
  const now = (deps.now ?? Date.now)();
  const prior = (await deps.get()) as UpdateState | undefined;
  if (
    prior?.spec === installed.spec &&
    typeof prior.checkedAt === 'number' &&
    now >= prior.checkedAt &&
    now - prior.checkedAt < interval
  ) {
    deps.publish?.(prior);
    return prior.message;
  }
  const save = async (state: UpdateState) => {
    await deps.set(state);
    deps.publish?.(state);
  };
  await save({ spec: installed.spec, checkedAt: now });
  let latest: string | undefined;
  try {
    latest = await deps.latest();
    if (!stable.test(latest) || !Bun.semver.satisfies(latest, `>${deps.version}`)) return;
    let message = `AOrchestra ${latest} is available. Run the latest CLI with setup to update.`;
    let installedVersion: string | undefined;
    await save({ spec: installed.spec, checkedAt: now, availableVersion: latest });
    const managed = entry?.options?.updateManagedPackage === installed.spec;
    if (
      managed &&
      deps.options.autoUpdate !== false &&
      entry.options?.autoUpdate !== false &&
      latest.split('.')[0] === deps.version.split('.')[0]
    ) {
      // Re-read after the network request: an edited pin or disabled updater wins.
      const current = await deps.load();
      if (!current || current.spec !== installed.spec) return;
      assertManagedUpdate(current.config, installed.spec);
      await deps.install(latest, installed.spec);
      installedVersion = latest;
      message = `AOrchestra updated from ${deps.version} to ${latest}. Restart OpenCode to load the updated plugin and agent instructions.`;
    }
    await save({
      spec: installed.spec,
      checkedAt: now,
      message,
      availableVersion: latest,
      ...(installedVersion ? { installedVersion } : {}),
    });
    return message;
  } catch (error) {
    await save({
      spec: installed.spec,
      checkedAt: now,
      message: failureMessage,
      updateError: failureMessage,
      ...(latest && stable.test(latest) && Bun.semver.satisfies(latest, `>${deps.version}`)
        ? { availableVersion: latest }
        : {}),
    });
    throw error;
  }
}

export async function updateInstallation(
  directory: string,
  ctx: Pick<Plugin.Context, 'plugin'>,
): Promise<Installation | undefined> {
  const read = (name: string) =>
    readFile(join(directory, name), 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
  const [json, jsonc] = await Promise.all([read('opencode.json'), read('opencode.jsonc')]);
  const configs = [json, jsonc]
    .filter((text): text is string => text !== undefined)
    .map(readConfig);
  const entries = configs.flatMap((config) =>
    (config.plugins ?? []).filter((entry: any) =>
      isAOrchestraTarget(typeof entry === 'string' ? entry : (entry?.package ?? '')),
    ),
  );
  if (entries.length !== 1) return;
  const entry = entries[0],
    spec = typeof entry === 'string' ? entry : entry.package;
  if (spec !== `${pkg.name}@${pkg.version}`) return;
  // A global registration cannot authorize updating a project/source checkout.
  const active = (await ctx.plugin.list()).data.find(
    (plugin) => plugin.id === 'aorchestra' && plugin.state.status === 'active',
  );
  if (
    active?.source.type !== 'package' ||
    active.source.target !== spec ||
    active.source.version !== pkg.version
  )
    return;
  const text = jsonc ?? json!;
  const config = readConfig(text);
  if (
    !(config.plugins ?? []).some(
      (entry: any) => (typeof entry === 'string' ? entry : entry?.package) === spec,
    )
  )
    return;
  return { config, spec };
}

async function install(version: string, from: string, directory: string): Promise<void> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENCODE_CONFIG_DIR: directory,
    AORCHESTRA_DISABLE_UPDATE: '1',
  };
  // Use the hosting binary when launched directly by OpenCode. Bun is still a
  // prerequisite for the packaged CLI; alternate launchers use OPENCODE_BIN.
  if (!env.OPENCODE_BIN && /^opencode2?(?:\.exe)?$/.test(process.execPath.split(/[\\/]/).at(-1)!))
    env.OPENCODE_BIN = process.execPath;
  delete env.OPENCODE_CONFIG;
  delete env.OPENCODE_CONFIG_CONTENT;
  await new Promise<void>((resolve, reject) => {
    const worker = fileURLToPath(new URL('../scripts/update.ts', import.meta.url));
    const child = spawn('bun', [worker, version, from], {
      env,
      stdio: ['ignore', 'ignore', 'inherit'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    const timer = setTimeout(
      () => {
        if (child.pid) {
          if (process.platform === 'win32')
            spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
              stdio: 'ignore',
              windowsHide: true,
            }).on('error', () => {});
          else
            try {
              process.kill(-child.pid, 'SIGTERM');
            } catch {}
        }
        reject(new Error('AUTO_UPDATE_TIMEOUT'));
      },
      15 * 60 * 1000,
    );
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error('AUTO_UPDATE_SETUP_FAILED'));
    });
  });
}

export function startUpdateCheck(ctx: Plugin.Context): {
  message?: string;
  info: VersionStatus;
  stop: () => void;
} {
  const options = ctx.options as Record<string, unknown>;
  updateOptions(options);
  const controller = new AbortController();
  const status: { message?: string; info: VersionStatus; stop: () => void } = {
    info: versionStatus(pkg.version),
    stop: () => controller.abort(),
  };
  // Setup/check subprocesses must never recursively start an updater. Explicit
  // config overrides cannot authorize writes to the normal global config.
  if (
    process.env.AORCHESTRA_DISABLE_UPDATE === '1' ||
    process.env.OPENCODE_CONFIG ||
    process.env.OPENCODE_CONFIG_CONTENT ||
    options.updateCheck === false
  )
    return status;
  const paths = roots('opencode');
  const directory = resolve(process.env.OPENCODE_CONFIG_DIR ?? paths.config);
  let busy = false;
  const run = async () => {
    if (busy || controller.signal.aborted || status.info.installedVersion) return;
    busy = true;
    try {
      await Flock.withLock(
        `aorchestra-update:${directory}`,
        async () => {
          if (controller.signal.aborted) return;
          status.message = await checkUpdate({
            version: pkg.version,
            options,
            load: () => updateInstallation(directory, ctx),
            get: () => ctx.storage.get(key),
            set: (state) => ctx.storage.set(key, state),
            publish: (state) => {
              status.info = versionStatus(pkg.version, state);
            },
            latest: async () => {
              const response = await fetch(`https://registry.npmjs.org/${pkg.name}/latest`, {
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
              });
              if (!response.ok) throw new Error('AUTO_UPDATE_REGISTRY_UNAVAILABLE');
              return ((await response.json()) as { version: string }).version;
            },
            install: (version, from) => install(version, from, directory),
          });
          if (status.message) console.error(status.message);
        },
        { dir: join(paths.state, 'locks'), timeoutMs: 1000, signal: controller.signal },
      );
    } catch {
      if (controller.signal.aborted) return;
      status.message = failureMessage;
      status.info = { ...status.info, updateError: failureMessage };
      console.error(status.message);
    } finally {
      busy = false;
    }
  };
  const timer = setTimeout(run, 0);
  const recurring = setInterval(run, interval);
  recurring.unref();
  status.stop = () => {
    clearTimeout(timer);
    clearInterval(recurring);
    controller.abort();
  };
  return status;
}
