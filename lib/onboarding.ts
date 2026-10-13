import type { Plugin } from '@opencode/plugin';
import { roots } from '@opencode/util/global-roots';
import { Flock } from '@opencode/util/flock';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { isAOrchestraTarget, readConfig } from './setup';
import { setupRpc, type SetupStatus } from './version-status';
import { supportedRuntime } from '../scripts/runtime';
import pkg from '../package.json';
import { updateDiagnostic } from './update';

type Options = {
  directory?: string;
  env?: NodeJS.ProcessEnv;
  configure?: (model: string, spec: string, signal: AbortSignal) => Promise<void>;
};

// This command uses the same discovery, merge, backup and check as setup, but
// configures the loaded package instead of invoking plugin add again.
export async function configureInstalled(
  model: string,
  spec: string,
  directory: string,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  signal.throwIfAborted();
  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    OPENCODE_CONFIG_DIR: directory,
    AORCHESTRA_DISABLE_SETUP: '1',
    AORCHESTRA_DISABLE_UPDATE: '1',
  };
  if (
    !childEnv.OPENCODE_BIN &&
    /^opencode2?(?:\.exe)?$/.test(process.execPath.split(/[\\/]/).at(-1)!)
  )
    childEnv.OPENCODE_BIN = process.execPath;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'bun',
      [
        fileURLToPath(new URL('../scripts/cli.ts', import.meta.url)),
        'configure',
        `--model=${model}`,
        // Let stable setup pin the loaded version and manage future updates.
        ...(/^(?:aorchestra-opencode-v2|aorchestra-opencode-v2@latest)$/.test(spec)
          ? []
          : [`--package=${spec}`]),
      ],
      {
        env: childEnv,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      },
    );
    // Drain diagnostics without exposing arbitrary provider/configuration data.
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-8192);
    });
    const timer = setTimeout(
      () => {
        if (!child.pid) return;
        if (process.platform === 'win32')
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).on(
            'error',
            () => {},
          );
        else
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch {}
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
      else reject(new Error(`FIRST_RUN_SETUP_FAILED: ${updateDiagnostic(new Error(stderr))}`));
    });
  });
}

export async function createOnboarding(ctx: Plugin.Context, options: Options = {}) {
  const env = options.env ?? process.env;
  const paths = roots('opencode');
  const directory = resolve(options.directory ?? env.OPENCODE_CONFIG_DIR ?? paths.config);
  const controller = new AbortController();
  let status: SetupStatus = {
    state: 'checking',
    models: [],
    message: 'Checking AOrchestra setup…',
  };
  let inFlight: Promise<SetupStatus> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resultSpec: string | undefined;
  const resultKey = 'setup/result';
  const saveResult = async () => {
    if (resultSpec)
      await ctx.storage.set(resultKey, {
        ...status,
        spec: resultSpec,
        version: pkg.version,
        pid: process.pid,
      });
  };
  const set = (state: SetupStatus['state'], message: string, models: string[] = []) =>
    (status = { state, message, models });
  const inspect = async (selected?: string, retry = false): Promise<SetupStatus> => {
    if (env.AORCHESTRA_DISABLE_SETUP === '1' || ctx.options.autoSetup === false)
      return set('skipped', 'Automatic setup is disabled.');
    if (env.OPENCODE_CONFIG || env.OPENCODE_CONFIG_CONTENT)
      return set(
        'skipped',
        'Explicit config overrides are active; use packaged setup for global installation.',
      );
    if (!supportedRuntime(ctx.app.version))
      return set('failed', 'Setup requires stable OpenCode >=2.0.26 <3.0.0.');
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
    if (entries.length !== 1)
      return set(
        'skipped',
        'Use packaged setup to resolve missing or duplicate global registrations.',
      );
    const entry = entries[0];
    if (entry?.options?.autoSetup === false) return set('skipped', 'Automatic setup is disabled.');
    const spec = typeof entry === 'string' ? entry : entry.package;
    // Only the globally registered, actually loaded package may configure itself.
    // A project/source plugin must never rewrite a global installation.
    const active = (await ctx.plugin.list()).data.find((plugin) => plugin.id === 'aorchestra');
    if (!active || active.state.status !== 'active')
      return set('checking', 'Waiting for OpenCode to finish loading AOrchestra…');
    if (
      active.source.type !== 'package' ||
      active.source.target !== spec ||
      active.source.version !== pkg.version
    )
      return set('skipped', 'This plugin source does not match the global package registration.');
    const config = readConfig(jsonc ?? json!);
    if (
      !(config.plugins ?? []).some(
        (entry: any) => (typeof entry === 'string' ? entry : entry.package) === spec,
      )
    )
      return set(
        'failed',
        'Move the AOrchestra registration into global JSONC, then run packaged setup.',
      );
    if (
      ['aorchestra', 'aorchestra-executor'].every((id) =>
        configs.some((config) => config.agents?.[id]),
      )
    ) {
      // Config writes hot-reload the plugin. Preserve the worker's result across
      // that reload instead of treating newly saved agents as a passing check.
      const result = (await ctx.storage.get(resultKey)) as
        (SetupStatus & { spec: string; version: string; pid: number }) | undefined;
      const matches =
        result?.pid === process.pid && result.spec === spec && result.version === pkg.version;
      if (
        matches &&
        result &&
        (result.state === 'restart-required' || result.state === 'failed') &&
        !(result.state === 'failed' && (retry || selected))
      )
        return set(result.state, result.message);
      if (!matches || result?.state !== 'failed') return set('ready', 'AOrchestra is configured.');
    }
    const priority = [...configs].reverse();
    const primary =
      selected ??
      priority.find((config) => config.agents?.aorchestra?.model)?.agents.aorchestra.model ??
      priority.find((config) => config.model)?.model;
    let models: string[] = [];
    // Configured providers/model catalogues load after third-party plugins.
    for (let attempt = 0; attempt < 20 && !controller.signal.aborted; attempt++) {
      models = (await ctx.model.list()).data.map((model) => `${model.providerID}/${model.id}`);
      if (selected || (models.length && (!primary || models.includes(primary)))) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!primary || !models.includes(primary)) {
      if (selected)
        return set(
          'needs-model',
          'That model is unavailable. Choose an authenticated provider model.',
          models,
        );
      return set(
        'needs-model',
        models.length
          ? 'Choose a model to finish AOrchestra setup.'
          : 'Authenticate a provider in OpenCode, then run /aorchestra-setup.',
        models,
      );
    }
    set('configuring', 'Configuring AOrchestra and checking loading without inference…');
    resultSpec = /^(?:aorchestra-opencode-v2|aorchestra-opencode-v2@latest)$/.test(spec)
      ? `${pkg.name}@${pkg.version}`
      : spec;
    await (
      options.configure ??
      ((model, spec, signal) => configureInstalled(model, spec, directory, signal, env))
    )(primary, spec, controller.signal);
    set(
      'restart-required',
      'AOrchestra setup passed. Restart OpenCode to load its agents and instructions.',
    );
    await saveResult();
    return status;
  };
  const refresh = (model?: string, retry = false): Promise<SetupStatus> => {
    if (controller.signal.aborted) return Promise.resolve(status);
    // Configure/check subprocesses run while their parent owns this lock.
    // Never acquire it again when onboarding is disabled or overridden.
    if (
      env.AORCHESTRA_DISABLE_SETUP === '1' ||
      ctx.options.autoSetup === false ||
      env.OPENCODE_CONFIG ||
      env.OPENCODE_CONFIG_CONTENT
    )
      return inspect(model, retry);
    if (inFlight) return inFlight;
    inFlight = Flock.withLock(`aorchestra-update:${directory}`, () => inspect(model, retry), {
      dir: join(paths.state, 'locks'),
      timeoutMs: 15 * 60 * 1000,
      signal: controller.signal,
    })
      .catch(async (error) => {
        if (controller.signal.aborted) return status;
        const diagnostic = updateDiagnostic(error);
        console.error(`AOrchestra first-launch setup failed: ${diagnostic}`);
        set(
          'failed',
          `Automatic setup could not finish (${diagnostic}). Run packaged setup and review any configuration backup.`,
        );
        await saveResult().catch(() => {});
        return status;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
  await ctx.rpc.register(setupRpc, {
    get: async () => status,
    configure: async (input) => refresh((input as { model?: string }).model, true),
  });
  return {
    start: () => {
      let attempts = 0;
      const run = async () => {
        await refresh();
        if (!controller.signal.aborted && status.state === 'checking') {
          if (++attempts < 120)
            timer = setTimeout(() => {
              void run();
            }, 500);
          else set('failed', 'OpenCode is still loading. Run /aorchestra-setup to retry.');
        }
      };
      timer = setTimeout(() => {
        void run();
      }, 0);
    },
    refresh,
    status: () => status,
    stop: () => {
      clearTimeout(timer);
      // Saving config hot-reloads the plugin in V2. The already-started worker
      // must finish its global check and release the lock across that reload.
      // Queued/discovery work can still be cancelled before configuration starts.
      if (status.state !== 'configuring') controller.abort();
    },
  };
}
