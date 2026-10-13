import { expect, test, spyOn } from 'bun:test';
import {
  checkUpdate,
  installUpdate,
  startUpdateCheck,
  updateOptions,
  updateInstallation,
  type Installation,
} from '../lib/update';
import { assertManagedUpdate, mergeSetup, readConfig } from '../lib/setup';
import { Flock } from '@opencode/util/flock';
import { mkdtemp, rm, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { Plugin } from '@opencode/plugin';
import pkg from '../package.json';
import { sidebarVersion, versionStatus, type VersionStatus } from '../lib/version-status';

const spec = 'aorchestra-opencode-v2@1.2.3';
const models = { primary: 'p/main', fast: 'p/fast', balanced: 'p/balanced', strong: 'p/strong' };
const template = {
  plugins: [{ options: {} }],
  agents: {
    aorchestra: { system: 'new primary' },
    'aorchestra-executor': { system: 'new worker' },
  },
};
function fixture(options: Record<string, unknown> = {}) {
  let config = readConfig(
    mergeSetup(
      JSON.stringify({
        default_agent: 'build',
        providers: { keep: true },
        agents: { aorchestra: { steps: 17 } },
        plugins: [{ package: spec, options }],
      }),
      template,
      spec,
      models,
      false,
      [],
      true,
    ),
  );
  let state: any;
  let now = 1000;
  let latest = '1.2.4';
  const installs: string[] = [];
  let requests = 0;
  let present = true;
  const deps = {
    version: '1.2.3',
    options,
    load: async (): Promise<Installation | undefined> =>
      present ? { config, spec: config.plugins[0].package } : undefined,
    get: async () => state,
    set: async (next: any) => {
      state = structuredClone(next);
    },
    now: () => now,
    latest: async () => {
      requests++;
      return latest;
    },
    install: async (version: string, from: string) => {
      assertManagedUpdate(config, from);
      installs.push(version);
      config = readConfig(
        mergeSetup(
          JSON.stringify(config),
          template,
          `aorchestra-opencode-v2@${version}`,
          models,
          false,
          [],
          true,
        ),
      );
    },
  };
  return {
    deps,
    installs,
    get config() {
      return config;
    },
    get requests() {
      return requests;
    },
    get state() {
      return state;
    },
    advance: () => {
      now += 86400000;
    },
    latest: (value: string) => {
      latest = value;
    },
    absent: () => {
      present = false;
    },
  };
}

test('managed stable setup enables updates and moves its marker while preserving user settings', async () => {
  const f = fixture();
  expect(f.config.plugins[0].options.updateManagedPackage).toBe(spec);
  expect(f.config.plugins[0].options.autoUpdate).toBe(true);
  expect(await checkUpdate(f.deps)).toContain('Restart OpenCode');
  expect(f.installs).toEqual(['1.2.4']);
  expect(f.config.plugins[0].options.updateManagedPackage).toBe('aorchestra-opencode-v2@1.2.4');
  expect(f.config.default_agent).toBe('build');
  expect(f.config.providers.keep).toBe(true);
  expect(f.config.agents.aorchestra.steps).toBe(17);
  expect(f.config.plugins[0].options.models).toEqual({
    fast: models.fast,
    balanced: models.balanced,
    strong: models.strong,
  });
});

test('disabled automatic installation and manual version pins only notify', async () => {
  for (const mode of ['disabled', 'pin', 'project-disabled']) {
    const f = fixture(mode === 'disabled' ? { autoUpdate: false } : {});
    if (mode === 'pin') delete f.config.plugins[0].options.updateManagedPackage;
    if (mode === 'project-disabled') f.deps.options = { autoUpdate: false };
    expect(await checkUpdate(f.deps)).toContain('is available');
    expect(f.installs).toHaveLength(0);
  }
});

test('explicit package and main setup remove management marker and retain disabled updates', () => {
  const f = fixture({ autoUpdate: false });
  const before = JSON.stringify(f.config);
  for (const target of [
    spec,
    'git+https://github.com/p-sternik/AOrchestra-opencode.git#' + 'a'.repeat(40),
  ]) {
    const after = readConfig(mergeSetup(before, template, target, models, false, [], false));
    expect(after.plugins[0].options.updateManagedPackage).toBeUndefined();
    expect(after.plugins[0].options.autoUpdate).toBe(false);
  }
});

test('checks can be disabled and source or prerelease installations do not access registry', async () => {
  for (const mode of ['disabled', 'source', 'prerelease', 'global-disabled']) {
    const f = fixture();
    if (mode === 'disabled') f.deps.options = { updateCheck: false };
    if (mode === 'source') f.absent();
    if (mode === 'prerelease') f.deps.version = '1.2.3-beta.1';
    if (mode === 'global-disabled') f.config.plugins[0].options.updateCheck = false;
    expect(await checkUpdate(f.deps)).toBeUndefined();
    expect(f.requests).toBe(0);
    expect(f.installs).toHaveLength(0);
  }
  for (const name of ['autoUpdate', 'updateCheck'])
    expect(() => updateOptions({ [name]: 'true' })).toThrow('INVALID_OPTION');
});

test('check attempts are throttled across restarts including offline and failed installs', async () => {
  for (const mode of ['offline', 'installation', 'current', 'notification']) {
    const f = fixture(mode === 'notification' ? { autoUpdate: false } : {});
    if (mode === 'offline')
      f.deps.latest = async () => {
        throw new Error('offline');
      };
    if (mode === 'installation')
      f.deps.install = async () => {
        throw new Error('failed setup');
      };
    if (mode === 'current') f.latest('1.2.3');
    const first = await checkUpdate(f.deps).catch(() => f.state.message);
    expect(f.state.checkedAt).toBe(1000);
    expect((await checkUpdate(f.deps)) === first).toBe(true);
    const previous = f.requests;
    f.advance();
    await checkUpdate(f.deps).catch(() => undefined);
    if (mode !== 'offline') expect(f.requests).toBe(previous + 1);
  }
});

test('major upgrades, downgrades, prereleases and invalid registry versions never install', async () => {
  for (const version of [
    '2.0.0',
    '1.2.2',
    '1.2.3',
    '1.2.4-beta.1',
    'invalid',
    '1.2.4; touch /tmp/unwanted',
  ]) {
    const f = fixture();
    f.latest(version);
    await checkUpdate(f.deps);
    expect(f.installs).toHaveLength(0);
  }
});

test('pin changes or disabling updates during network access prevent installation', async () => {
  for (const mode of ['pin', 'disable', 'remove']) {
    const f = fixture();
    f.deps.latest = async () => {
      if (mode === 'pin') f.config.plugins[0].package = 'aorchestra-opencode-v2@1.2.2';
      if (mode === 'disable') f.config.plugins[0].options.autoUpdate = false;
      if (mode === 'remove') f.absent();
      return '1.2.4';
    };
    await checkUpdate(f.deps).catch(() => undefined);
    expect(f.installs).toHaveLength(0);
  }
});

test('automatic setup rejects ambiguous registrations, changed pins and incomplete models', () => {
  for (const mode of ['duplicate', 'pin', 'marker', 'model', 'disabled', 'check-disabled']) {
    const f = fixture();
    if (mode === 'duplicate') f.config.plugins.push(spec);
    if (mode === 'pin') f.config.plugins[0].package = 'aorchestra-opencode-v2@1.2.2';
    if (mode === 'marker') delete f.config.plugins[0].options.updateManagedPackage;
    if (mode === 'model') delete f.config.plugins[0].options.models.strong;
    if (mode === 'disabled') f.config.plugins[0].options.autoUpdate = false;
    if (mode === 'check-disabled') f.config.plugins[0].options.updateCheck = false;
    expect(() => assertManagedUpdate(f.config, spec)).toThrow();
  }
});

test('native file locking prevents simultaneous startup checks from installing twice', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aorchestra-update-test-'));
  try {
    const f = fixture();
    await Promise.all(
      [1, 2].map(() =>
        Flock.withLock('update-test', () => checkUpdate(f.deps), {
          dir: directory,
          timeoutMs: 5000,
        }),
      ),
    );
    expect(f.installs).toEqual(['1.2.4']);
    expect(f.requests).toBe(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('update status publishes availability before installation and restores installed status on startup', async () => {
  const f = fixture();
  const observed: VersionStatus[] = [];
  const deps = {
    ...f.deps,
    publish: (state: any) => {
      observed.push(versionStatus('1.2.3', state));
    },
    install: async () => {
      expect(observed.at(-1)).toEqual({
        version: '1.2.3',
        availableVersion: '1.2.4',
        installedVersion: null,
      });
    },
  };
  await checkUpdate(deps);
  expect(observed.at(-1)).toEqual({
    version: '1.2.3',
    availableVersion: '1.2.4',
    installedVersion: '1.2.4',
  });
  observed.length = 0;
  await checkUpdate(deps);
  expect(observed).toEqual([
    { version: '1.2.3', availableVersion: '1.2.4', installedVersion: '1.2.4' },
  ]);
});

test('failed installation leaves availability visible without claiming a completed update', async () => {
  const f = fixture();
  let status: VersionStatus | undefined;
  await expect(
    checkUpdate({
      ...f.deps,
      publish: (state) => {
        status = versionStatus('1.2.3', state);
      },
      install: async () => {
        throw new Error('setup failed');
      },
    }),
  ).rejects.toThrow('setup failed');
  expect(status).toEqual({
    version: '1.2.3',
    availableVersion: '1.2.4',
    installedVersion: null,
    updateError: expect.stringContaining('Run setup manually'),
  });
  expect(f.state.installedVersion).toBeUndefined();
  expect(await checkUpdate(f.deps)).toContain('Run setup manually');
});

test('offline errors survive throttled startup and clear after a successful daily check', async () => {
  const f = fixture({ autoUpdate: false });
  const latest = f.deps.latest;
  f.deps.latest = async () => {
    throw new Error('offline');
  };
  await expect(checkUpdate(f.deps)).rejects.toThrow('offline');
  expect(f.state.updateError).toContain('Run setup manually');
  expect(await checkUpdate(f.deps)).toBe(f.state.message);
  f.deps.latest = latest;
  f.advance();
  expect(await checkUpdate(f.deps)).toContain('is available');
  expect(f.state.updateError).toBeUndefined();
});

test('startup schedules daily checks and disposal stops both timers and late callbacks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aorchestra-update-schedule-'));
  const names = [
    'OPENCODE_CONFIG_DIR',
    'OPENCODE_CONFIG',
    'OPENCODE_CONFIG_CONTENT',
    'AORCHESTRA_DISABLE_UPDATE',
  ];
  const prior = names.map((name) => process.env[name]);
  const callbacks: Array<() => Promise<void>> = [];
  const cleared: unknown[] = [];
  let checks = 0;
  const timeout = spyOn(globalThis, 'setTimeout');
  const recurring = spyOn(globalThis, 'setInterval');
  const clearTimeoutSpy = spyOn(globalThis, 'clearTimeout');
  const clearIntervalSpy = spyOn(globalThis, 'clearInterval');
  let status: ReturnType<typeof startUpdateCheck> | undefined;
  try {
    names.forEach((name) => delete process.env[name]);
    process.env.OPENCODE_CONFIG_DIR = directory;
    await writeFile(
      join(directory, 'opencode.json'),
      JSON.stringify({ plugins: [`${pkg.name}@${pkg.version}`] }),
    );
    // Restore real timers before running callbacks so native locking uses its own timers.
    timeout.mockImplementation(((callback: () => Promise<void>) => {
      callbacks.push(callback);
      return 101;
    }) as any);
    recurring.mockImplementation(((callback: () => Promise<void>, delay: number) => {
      expect(delay).toBe(86400000);
      callbacks.push(callback);
      return { unref() {} };
    }) as any);
    status = startUpdateCheck({
      options: {},
      plugin: {
        list: async () => {
          checks++;
          return { data: [] };
        },
      },
    } as unknown as Plugin.Context);
    timeout.mockRestore();
    recurring.mockRestore();
    expect(callbacks).toHaveLength(2);
    await callbacks[0]();
    await callbacks[1]();
    expect(checks).toBe(2);
    await Promise.all([callbacks[1](), callbacks[1]()]);
    expect(checks).toBe(3);
    clearTimeoutSpy.mockImplementation(((timer: unknown) => {
      cleared.push(timer);
    }) as any);
    clearIntervalSpy.mockImplementation(((timer: unknown) => {
      cleared.push(timer);
    }) as any);
    status.stop();
    expect(cleared).toHaveLength(2);
    await callbacks[1]();
    expect(checks).toBe(3);
  } finally {
    timeout.mockRestore();
    recurring.mockRestore();
    clearTimeoutSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    names.forEach((name, i) => {
      if (prior[i] === undefined) delete process.env[name];
      else process.env[name] = prior[i];
    });
    await rm(directory, { recursive: true, force: true });
  }
});

test('global JSONC discovery requires the matching active native package and rejects duplicate or local registrations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aorchestra-update-test-'));
  const target = `${pkg.name}@${pkg.version}`;
  let source: any = { type: 'package', target, version: pkg.version };
  const ctx = {
    plugin: {
      list: async () => ({ data: [{ id: 'aorchestra', source, state: { status: 'active' } }] }),
    },
  } as Pick<Plugin.Context, 'plugin'>;
  const text =
    '// keep\n' + JSON.stringify({ plugins: [{ package: target, options: { autoUpdate: true } }] });
  try {
    expect(await updateInstallation(directory, ctx)).toBeUndefined();
    await writeFile(join(directory, 'opencode.jsonc'), text);
    expect((await updateInstallation(directory, ctx))?.spec).toBe(target);
    for (const other of [
      { type: 'local', path: '/checkout/plugins/aorchestra' },
      { type: 'package', target: 'other', version: pkg.version },
      { type: 'package', target, version: '0.0.0' },
    ]) {
      source = other;
      expect(await updateInstallation(directory, ctx)).toBeUndefined();
    }
    source = { type: 'package', target, version: pkg.version };
    await writeFile(join(directory, 'opencode.json'), text);
    expect(await updateInstallation(directory, ctx)).toBeUndefined();
    await unlink(join(directory, 'opencode.json'));
    await writeFile(
      join(directory, 'opencode.jsonc'),
      JSON.stringify({ plugins: [target, target] }),
    );
    expect(await updateInstallation(directory, ctx)).toBeUndefined();
    await writeFile(join(directory, 'opencode.jsonc'), '{broken');
    await expect(updateInstallation(directory, ctx)).rejects.toThrow('INVALID_GLOBAL_CONFIG');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function withUpdater(
  run: (
    f: ReturnType<typeof fixture>,
    callbacks: Array<() => Promise<void>>,
    logs: string[],
    start: () => ReturnType<typeof startUpdateCheck>,
  ) => Promise<void>,
) {
  const names = ['OPENCODE_CONFIG', 'OPENCODE_CONFIG_CONTENT', 'AORCHESTRA_DISABLE_UPDATE'];
  const prior = names.map((name) => process.env[name]);
  const callbacks: Array<() => Promise<void>> = [];
  const logs: string[] = [];
  const timeout = spyOn(globalThis, 'setTimeout');
  const recurring = spyOn(globalThis, 'setInterval');
  const lock = spyOn(Flock, 'withLock');
  const log = spyOn(console, 'error');
  const statuses: Array<ReturnType<typeof startUpdateCheck>> = [];
  try {
    names.forEach((name) => delete process.env[name]);
    timeout.mockImplementation(((callback: () => Promise<void>, delay: number) => {
      expect(delay).toBe(0);
      callbacks.push(callback);
      return 101;
    }) as any);
    recurring.mockImplementation(((callback: () => Promise<void>, delay: number) => {
      expect(delay).toBe(86400000);
      callbacks.push(callback);
      return { unref() {} };
    }) as any);
    lock.mockImplementation(async (_key, fn) => fn());
    log.mockImplementation((message) => {
      logs.push(String(message));
    });
    const f = fixture();
    f.deps.version = pkg.version;
    f.config.plugins[0].package = `${pkg.name}@${pkg.version}`;
    f.config.plugins[0].options.updateManagedPackage = `${pkg.name}@${pkg.version}`;
    f.latest(
      `${pkg.version.split('.').slice(0, 2).join('.')}.${Number(pkg.version.split('.')[2]) + 1}`,
    );
    const start = () => {
      const status = startUpdateCheck(
        {
          options: {},
          storage: { get: f.deps.get, set: (_key: string, state: any) => f.deps.set(state) },
        } as unknown as Plugin.Context,
        f.deps,
      );
      statuses.push(status);
      return status;
    };
    await run(f, callbacks, logs, start);
  } finally {
    statuses.forEach((status) => status.stop());
    timeout.mockRestore();
    recurring.mockRestore();
    lock.mockRestore();
    log.mockRestore();
    names.forEach((name, i) => {
      if (prior[i] === undefined) delete process.env[name];
      else process.env[name] = prior[i];
    });
  }
}

test('registry and installation causes reach server diagnostics while RPC/TUI remain generic', async () => {
  for (const phase of ['registry', 'installation', 'configuration', 'locking']) {
    await withUpdater(async (f, callbacks, logs, start) => {
      const failure = new Error(
        `${phase === 'installation' ? 'AUTO_UPDATE_CONFIG_CHANGED: ' : ''}secret-token https://user:password@example.test/?token=secret config=private`,
        {
          cause: Object.assign(new Error('private environment contents'), { code: 'EACCES' }),
        },
      );
      if (phase === 'registry')
        f.deps.latest = async () => {
          throw failure;
        };
      if (phase === 'installation')
        f.deps.install = async () => {
          throw failure;
        };
      if (phase === 'configuration')
        f.deps.load = async () => {
          throw failure;
        };
      if (phase === 'locking')
        spyOn(Flock, 'withLock').mockImplementation(async () => {
          throw failure;
        });
      const status = start();
      await callbacks[0]();
      expect(logs.at(-1)).toBe(
        `AOrchestra automatic update failed (${phase}): ${phase === 'installation' ? 'AUTO_UPDATE_CONFIG_CHANGED, ' : ''}EACCES`,
      );
      expect(status.info.updateError).toContain('Run setup manually');
      expect(sidebarVersion(status.info).update).toBe('Update failed · run setup manually');
      for (const secret of ['secret-token', 'password', 'private', 'example.test', 'EACCES'])
        expect(JSON.stringify(status.info)).not.toContain(secret);
      expect(logs.join(' ')).not.toContain('secret-token');
      expect(logs.join(' ')).not.toContain('private');
      expect(logs.join(' ')).not.toContain('password');
    });
  }
});

test('registry HTTP status is logged and successful subsequent checks clear public errors', async () => {
  await withUpdater(async (f, callbacks, logs, start) => {
    f.deps.latest = async () => {
      throw new Error('AUTO_UPDATE_REGISTRY_UNAVAILABLE: HTTP 503');
    };
    const status = start();
    await callbacks[0]();
    expect(logs.at(-1)).toContain('registry): AUTO_UPDATE_REGISTRY_UNAVAILABLE, HTTP 503');
    expect(f.state.updateError).toBe(status.info.updateError);
    await f.deps.set({ ...f.state, checkedAt: 0 });
    // startUpdateCheck captures the injected dependency functions at startup.
    status.stop();
    f.deps.latest = async () => pkg.version;
    const recovered = start();
    await callbacks[2]();
    expect(recovered.info.updateError).toBeUndefined();
    expect(f.state.updateError).toBeUndefined();
  });
});

test('disposal during a registry request suppresses persisted failures, logs and overlapping checks', async () => {
  await withUpdater(async (f, callbacks, logs, start) => {
    let reject!: (error: Error) => void;
    let requests = 0;
    f.deps.latest = () => {
      requests++;
      return new Promise((_resolve, fail) => {
        reject = fail;
      });
    };
    const status = start();
    const pending = callbacks[0]();
    while (!reject) await Promise.resolve();
    await callbacks[1]();
    expect(requests).toBe(1);
    status.stop();
    reject(new Error('aborted secret'));
    await pending;
    await callbacks[1]();
    expect(requests).toBe(1);
    expect(status.info.updateError).toBeUndefined();
    expect(f.state.updateError).toBeUndefined();
    expect(logs).toEqual([]);
  });
});

test('installer drains bounded stderr and retains only failure categories and exit status', async () => {
  for (const code of [0, 1, null]) {
    const child = Object.assign(new EventEmitter(), { stderr: new PassThrough() });
    const spawnWorker = ((_command: string, _args: string[], options: any) => {
      expect(options.stdio).toEqual(['ignore', 'ignore', 'pipe']);
      expect(options.detached).toBe(process.platform !== 'win32');
      return child;
    }) as unknown as typeof spawn;
    const pending = installUpdate('1.2.4', spec, '/unused-controlled-config', spawnWorker);
    child.stderr.write(
      'secret-token ' +
        'x'.repeat(20000) +
        '\nAUTO_UPDATE_CONFIG_CHANGED: token=private password=secret\n',
    );
    child.emit('close', code, code === null ? 'SIGTERM' : null);
    if (code === 0) await pending;
    else {
      const error = await pending.catch((error: Error) => error);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(`AUTO_UPDATE_SETUP_FAILED: exit ${code}`);
      expect((error as Error).message).toContain('AUTO_UPDATE_CONFIG_CHANGED');
      expect((error as Error).message).not.toContain('private');
      expect((error as Error).message.length).toBeLessThan(200);
    }
    child.stderr.destroy();
  }
});

test('installer spawn errors and the fifteen-minute deadline retain rejection and timer cleanup', async () => {
  const timeout = spyOn(globalThis, 'setTimeout');
  const clear = spyOn(globalThis, 'clearTimeout');
  const kill = spyOn(process, 'kill');
  let expire!: () => void;
  try {
    timeout.mockImplementation(((callback: () => void, delay: number) => {
      expect(delay).toBe(15 * 60 * 1000);
      expire = callback;
      return 123;
    }) as any);
    clear.mockImplementation(() => {});
    kill.mockImplementation(() => true);
    for (const mode of ['spawn', 'timeout']) {
      const child = Object.assign(new EventEmitter(), {
        stderr: new PassThrough(),
        // Windows tree termination remains a native integration limitation.
        pid: process.platform === 'win32' ? undefined : 42,
      });
      const spawnWorker = (() => child) as unknown as typeof spawn;
      const pending = installUpdate('1.2.4', spec, '/unused-controlled-config', spawnWorker);
      if (mode === 'spawn') {
        const error = Object.assign(new Error('private spawn details'), { code: 'ENOENT' });
        child.emit('error', error);
        expect(await pending.catch((error) => error)).toBe(error);
        expect(clear).toHaveBeenCalledWith(123);
      } else {
        child.stderr.write('NpmInstallFailedError: private token=secret');
        expire();
        await expect(pending).rejects.toThrow('AUTO_UPDATE_TIMEOUT: NpmInstallFailedError');
        if (process.platform !== 'win32') expect(kill).toHaveBeenCalledWith(-42, 'SIGTERM');
      }
      child.emit('close', 1, null);
      expect(clear).toHaveBeenCalledWith(123);
      child.stderr.destroy();
    }
  } finally {
    timeout.mockRestore();
    clear.mockRestore();
    kill.mockRestore();
  }
});
