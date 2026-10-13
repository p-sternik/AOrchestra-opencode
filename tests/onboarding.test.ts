import { expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Plugin } from '@opencode/plugin';
import { createOnboarding } from '../lib/onboarding';
import { mergeSetup, saveConfig, readConfig } from '../lib/setup';
import pkg from '../package.json';
import template from '../opencode.json';

const spec = `${pkg.name}@latest`;
async function fixture(config: Record<string, any> = {}, env: NodeJS.ProcessEnv = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'aorchestra-onboarding-test-'));
  const path = join(directory, 'opencode.jsonc');
  const before = '// keep this comment\n' + JSON.stringify({ plugins: [spec], ...config });
  await writeFile(path, before);
  let available = ['p/main', 'p/fast'];
  let source: any = { type: 'package', target: spec, version: pkg.version };
  let calls = 0,
    catalogueCalls = 0;
  let backup: string | undefined;
  const rpc = new Map<string, any>();
  const storage = new Map<string, any>();
  const ctx = {
    storage: {
      get: async (key: string) => storage.get(key),
      set: async (key: string, value: unknown) => {
        storage.set(key, value);
      },
    },
    app: { version: '2.0.26' },
    options: {},
    plugin: {
      list: async () => ({ data: [{ id: 'aorchestra', state: { status: 'active' }, source }] }),
    },
    model: {
      list: async () => {
        catalogueCalls++;
        return {
          data: available.map((value) => {
            const [providerID, id] = value.split('/');
            return { providerID, id };
          }),
        };
      },
    },
    rpc: {
      register: async (definition: any, methods: any) => {
        rpc.set(definition.id, methods);
      },
    },
  } as unknown as Plugin.Context;
  const onboarding = await createOnboarding(ctx, {
    directory,
    env,
    configure: async (model, registeredSpec) => {
      calls++;
      expect(registeredSpec).toBe(spec);
      const current = await readFile(path, 'utf8');
      const after = mergeSetup(current, template, `${pkg.name}@${pkg.version}`, {
        primary: model,
        fast: model,
        balanced: model,
        strong: model,
      });
      backup = (await saveConfig(path, current, after)).backup;
    },
  });
  return {
    directory,
    path,
    before,
    ctx,
    onboarding,
    rpc,
    setAvailable: (models: string[]) => {
      available = models;
    },
    setSource: (value: any) => {
      source = value;
    },
    calls: () => calls,
    catalogueCalls: () => catalogueCalls,
    backup: () => backup,
    close: async () => {
      onboarding.stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('first launch reuses a configured model, backs up JSONC and preserves unrelated configuration', async () => {
  const f = await fixture({
    model: 'p/main',
    default_agent: 'build',
    agents: { custom: { system: 'keep' } },
    providers: { keep: true },
  });
  try {
    expect((await f.onboarding.refresh()).state).toBe('restart-required');
    expect(f.calls()).toBe(1);
    expect(await readFile(f.backup()!, 'utf8')).toBe(f.before);
    const text = await readFile(f.path, 'utf8'),
      config = readConfig(text);
    expect(text).toContain('// keep this comment');
    expect(config.agents.custom).toEqual({ system: 'keep' });
    expect(config.agents.aorchestra.model).toBe('p/main');
    expect(config.providers.keep).toBe(true);
    expect(config.default_agent).toBe('build');
    expect((await f.onboarding.refresh()).state).toBe('skipped'); // pinned source must reload
    expect(f.calls()).toBe(1);
  } finally {
    await f.close();
  }
});

test('missing model requires a choice; unavailable choices and provider sign-in gaps do not write config', async () => {
  const f = await fixture();
  try {
    const pending = await f.onboarding.refresh();
    expect(pending.state).toBe('needs-model');
    expect(pending.models).toEqual(['p/main', 'p/fast']);
    expect((await f.onboarding.refresh('p/missing')).state).toBe('needs-model');
    expect(await readFile(f.path, 'utf8')).toBe(f.before);
    expect(f.calls()).toBe(0);
    f.setAvailable([]);
    expect((await f.onboarding.refresh()).message).toContain('Authenticate a provider');
    f.setAvailable(['p/main']);
    expect((await f.rpc.get('aorchestra.setup').configure({ model: 'p/main' })).state).toBe(
      'restart-required',
    );
    expect(f.calls()).toBe(1);
  } finally {
    await f.close();
  }
}, 15000);

test('existing agent definitions are left intact without model discovery or setup', async () => {
  const f = await fixture({
    agents: { aorchestra: { system: 'custom' }, 'aorchestra-executor': { permissions: [] } },
  });
  try {
    expect((await f.onboarding.refresh()).state).toBe('ready');
    expect(f.calls()).toBe(0);
    expect(f.catalogueCalls()).toBe(0);
    expect(await readFile(f.path, 'utf8')).toBe(f.before);
  } finally {
    await f.close();
  }
});

test('explicit overrides, disabled setup and mismatched/local sources cannot configure a global package', async () => {
  for (const env of [
    { OPENCODE_CONFIG: '/project/custom.json' },
    { OPENCODE_CONFIG_CONTENT: '{}' },
    { AORCHESTRA_DISABLE_SETUP: '1' },
  ]) {
    const f = await fixture({ model: 'p/main' }, env);
    try {
      expect((await f.onboarding.refresh()).state).toBe('skipped');
      expect(f.calls()).toBe(0);
    } finally {
      await f.close();
    }
  }
  for (const source of [
    { type: 'local', path: '/project/plugin' },
    { type: 'package', target: `${pkg.name}@other`, version: pkg.version },
    { type: 'package', target: spec, version: '0.0.0' },
  ]) {
    const f = await fixture({ model: 'p/main' });
    try {
      f.setSource(source);
      expect((await f.onboarding.refresh()).state).toBe('skipped');
      expect(f.calls()).toBe(0);
    } finally {
      await f.close();
    }
  }
  const f = await fixture({
    model: 'p/main',
    plugins: [{ package: spec, options: { autoSetup: false } }],
  });
  try {
    expect((await f.onboarding.refresh()).state).toBe('skipped');
    expect(f.calls()).toBe(0);
  } finally {
    await f.close();
  }
});

test('duplicate registrations and JSON/JSONC precedence conflicts require manual reconciliation', async () => {
  for (const lower of [{ plugins: [spec] }, { plugins: [spec], model: 'p/main' }]) {
    const f = await fixture({ model: 'p/main' });
    try {
      await writeFile(join(f.directory, 'opencode.json'), JSON.stringify(lower));
      expect((await f.onboarding.refresh()).state).toBe('skipped');
      expect(await readFile(f.path, 'utf8')).toBe(f.before);
      expect(f.calls()).toBe(0);
    } finally {
      await f.close();
    }
  }
  const f = await fixture({ plugins: [], model: 'p/main' });
  try {
    await writeFile(join(f.directory, 'opencode.json'), JSON.stringify({ plugins: [spec] }));
    expect((await f.onboarding.refresh()).state).toBe('failed');
    expect(f.calls()).toBe(0);
  } finally {
    await f.close();
  }
});

test('concurrent setup requests share one operation and a failed post-save check retains the backup', async () => {
  const f = await fixture({ model: 'p/main' });
  let release!: () => void;
  let signal: AbortSignal | undefined;
  let calls = 0;
  const flow = await createOnboarding(f.ctx, {
    directory: f.directory,
    env: {},
    configure: async (_model, _spec, currentSignal) => {
      signal = currentSignal;
      calls++;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      const before = await readFile(f.path, 'utf8');
      await saveConfig(f.path, before, before + '\n');
      throw new Error('check failed with a private provider detail');
    },
  });
  try {
    const first = flow.refresh(),
      second = flow.refresh();
    while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
    release();
    expect((await first).state).toBe('failed');
    expect(await second).toEqual(await first);
    expect((await first).message).toContain('backup');
    expect((await first).message).not.toContain('private provider detail');
    expect(calls).toBe(1);
    expect(await readFile(f.path, 'utf8')).toBe(f.before + '\n');
    flow.stop();
    expect(signal?.aborted).toBe(true);
  } finally {
    flow.stop();
    await f.close();
  }
});

test('a started configuration survives plugin reload and its check result remains visible', async () => {
  const f = await fixture({ model: 'p/main' });
  let begin!: () => void, finish!: () => void;
  const started = new Promise<void>((resolve) => {
    begin = resolve;
  });
  const flow = await createOnboarding(f.ctx, {
    directory: f.directory,
    env: {},
    configure: async (_model, _spec, signal) => {
      const before = await readFile(f.path, 'utf8');
      const after = mergeSetup(before, template, `${pkg.name}@${pkg.version}`, {
        primary: 'p/main',
        fast: 'p/main',
        balanced: 'p/main',
        strong: 'p/main',
      });
      await saveConfig(f.path, before, after);
      begin();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      expect(signal.aborted).toBe(false);
    },
  });
  let reloaded: Awaited<ReturnType<typeof createOnboarding>> | undefined;
  try {
    const result = flow.refresh();
    await started;
    flow.stop(); // the config write unloads the old plugin
    finish();
    expect((await result).state).toBe('restart-required');
    f.setSource({ type: 'package', target: `${pkg.name}@${pkg.version}`, version: pkg.version });
    reloaded = await createOnboarding(f.ctx, { directory: f.directory, env: {} });
    expect((await reloaded.refresh()).state).toBe('restart-required');
  } finally {
    flow.stop();
    reloaded?.stop();
    await f.close();
  }
});

test('loading native metadata waits rather than treating startup as a mismatched source', async () => {
  const f = await fixture({ model: 'p/main' });
  const original = f.ctx.plugin.list;
  let loaded = false;
  f.ctx.plugin.list = (async () => (loaded ? original() : { data: [] })) as typeof original;
  try {
    expect((await f.onboarding.refresh()).state).toBe('checking');
    expect(f.calls()).toBe(0);
    loaded = true;
    expect((await f.onboarding.refresh()).state).toBe('restart-required');
  } finally {
    await f.close();
  }
});

test('a failed post-save check survives reload and an explicit retry can complete it', async () => {
  const f = await fixture({ model: 'p/main' });
  let flow: Awaited<ReturnType<typeof createOnboarding>> | undefined;
  let reloaded: Awaited<ReturnType<typeof createOnboarding>> | undefined;
  try {
    flow = await createOnboarding(f.ctx, {
      directory: f.directory,
      env: {},
      configure: async () => {
        const before = await readFile(f.path, 'utf8');
        await saveConfig(
          f.path,
          before,
          mergeSetup(before, template, `${pkg.name}@${pkg.version}`, {
            primary: 'p/main',
            fast: 'p/main',
            balanced: 'p/main',
            strong: 'p/main',
          }),
        );
        throw new Error('GLOBAL_CHECK_FAILED');
      },
    });
    expect((await flow.refresh()).state).toBe('failed');
    flow.stop();
    f.setSource({ type: 'package', target: `${pkg.name}@${pkg.version}`, version: pkg.version });
    let retries = 0;
    reloaded = await createOnboarding(f.ctx, {
      directory: f.directory,
      env: {},
      configure: async () => {
        retries++;
      },
    });
    expect((await reloaded.refresh()).state).toBe('failed');
    expect(retries).toBe(0);
    expect((await f.rpc.get('aorchestra.setup').configure({})).state).toBe('restart-required');
    expect(retries).toBe(1);
  } finally {
    flow?.stop();
    reloaded?.stop();
    await f.close();
  }
});

test('first launch reuses a model from lower-priority global JSON without modifying that file', async () => {
  const f = await fixture();
  const lower = JSON.stringify({ model: 'p/main', agents: { another: { system: 'keep' } } });
  try {
    await writeFile(join(f.directory, 'opencode.json'), lower);
    expect((await f.onboarding.refresh()).state).toBe('restart-required');
    expect(f.calls()).toBe(1);
    expect(await readFile(join(f.directory, 'opencode.json'), 'utf8')).toBe(lower);
    expect(readConfig(await readFile(f.path, 'utf8')).agents.aorchestra.model).toBe('p/main');
  } finally {
    await f.close();
  }
});
