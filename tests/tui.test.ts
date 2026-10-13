import { expect, test } from 'bun:test';
import { testRender } from '@opentui/solid';
import { createSignal } from 'solid-js';
import type { Plugin } from '@opencode/plugin/tui';
import tui from '../plugins/aorchestra-tui';
import { sidebarVersion, versionStatus, type VersionStatus } from '../lib/version-status';

test('sidebar keeps the running version until restart, and discards stale update records afterward', () => {
  const state = {
    spec: 'aorchestra-opencode-v2@1.2.3',
    availableVersion: '1.2.4',
    installedVersion: '1.2.4',
  };
  expect(sidebarVersion(versionStatus('1.2.3', state))).toEqual({
    title: 'AOrchestra v1.2.3',
    update: 'v1.2.4 installed · restart required',
  });
  expect(sidebarVersion(versionStatus('1.2.4', state))).toEqual({
    title: 'AOrchestra v1.2.4',
    update: null,
  });
  expect(
    sidebarVersion(versionStatus('1.2.3', { ...state, installedVersion: undefined })).update,
  ).toBe('v1.2.4 available');
  for (const version of ['invalid', '1.2.2', '1.2.3'])
    expect(
      versionStatus('1.2.3', { ...state, availableVersion: version, installedVersion: version }),
    ).toEqual({ version: '1.2.3', availableVersion: null, installedVersion: null });
});

test('sidebar shows updater failure while preserving availability and discards it after restart', () => {
  const state = {
    spec: 'aorchestra-opencode-v2@1.2.3',
    availableVersion: '1.2.4',
    updateError: 'failed',
  };
  expect(sidebarVersion(versionStatus('1.2.3', state))).toEqual({
    title: 'AOrchestra v1.2.3',
    update: 'Update failed · run setup manually',
  });
  expect(sidebarVersion(versionStatus('1.2.4', state)).update).toBeNull();
});

test('native sidebar slot renders server version and update states, then cancels requests on disposal', async () => {
  for (const installedVersion of [null, '1.2.4']) {
    let claim: any;
    let release: ((value: VersionStatus) => void) | undefined;
    let signal: AbortSignal | undefined;
    let location: any;
    const ctx = {
      theme: { text: { muted: '#999999' } },
      keymap: { layer: () => {} },
      data: { session: { get: () => ({ location: { directory: '/server/project' } }) } },
      client: {
        rpc: () => ({
          get: (_input: any, options: any) => {
            location = options.location;
            signal = options.signal;
            return new Promise<VersionStatus>((resolve) => {
              release = resolve;
            });
          },
        }),
      },
      ui: {
        slot: (value: any) => {
          claim = value;
          return () => {};
        },
      },
    } as unknown as Plugin.Context;
    const cleanup = await tui.setup(ctx);
    expect(claim.append).toBe('sidebar.footer');
    const view = await testRender(() => claim.render({ sessionID: 'session' }), {
      width: 60,
      height: 8,
    });
    try {
      await view.renderOnce();
      expect(view.captureCharFrame()).toContain('AOrchestra');
      expect(view.captureCharFrame()).not.toContain('AOrchestra v');
      expect(location).toEqual({ directory: '/server/project' });
      release!({ version: '1.2.3', availableVersion: '1.2.4', installedVersion });
      await view.waitForFrame((frame) =>
        frame.includes(installedVersion ? 'restart required' : 'v1.2.4 available'),
      );
      expect(view.captureCharFrame()).toContain('AOrchestra v1.2.3');
      expect(view.captureCharFrame()).toContain(
        installedVersion ? 'v1.2.4 installed' : 'v1.2.4 available',
      );
    } finally {
      view.renderer.destroy();
      if (cleanup) await cleanup();
    }
    expect(signal?.aborted).toBe(true);
  }
});

test('unavailable server status does not label the TUI bundle as the running plugin', async () => {
  let claim: any;
  const ctx = {
    theme: { text: { muted: '#999999' } },
    keymap: { layer: () => {} },
    data: { session: { get: () => ({ location: { directory: '/project' } }) } },
    client: {
      rpc: () => ({
        get: async () => {
          throw new Error('server unavailable');
        },
      }),
    },
    ui: {
      slot: (value: any) => {
        claim = value;
        return () => {};
      },
    },
  } as unknown as Plugin.Context;
  const cleanup = await tui.setup(ctx);
  const view = await testRender(() => claim.render({ sessionID: 'session' }), {
    width: 60,
    height: 8,
  });
  try {
    await view.waitForFrame((frame) => frame.includes('Status unavailable'));
    expect(view.captureCharFrame()).toContain('AOrchestra');
    expect(view.captureCharFrame()).not.toContain('AOrchestra v');
  } finally {
    view.renderer.destroy();
    if (cleanup) await cleanup();
  }
});

test('switching sessions cancels the previous request and ignores its late version response', async () => {
  let claim: any;
  const requests: Array<{ signal: AbortSignal; resolve: (value: VersionStatus) => void }> = [];
  const ctx = {
    theme: { text: { muted: '#999999' } },
    keymap: { layer: () => {} },
    data: { session: { get: (id: string) => ({ location: { directory: `/projects/${id}` } }) } },
    client: {
      rpc: () => ({
        get: (_input: any, options: any) =>
          new Promise<VersionStatus>((resolve) => {
            requests.push({ signal: options.signal, resolve });
          }),
      }),
    },
    ui: {
      slot: (value: any) => {
        claim = value;
        return () => {};
      },
    },
  } as unknown as Plugin.Context;
  const cleanup = await tui.setup(ctx);
  const [session, setSession] = createSignal('first');
  const view = await testRender(
    () =>
      claim.render({
        get sessionID() {
          return session();
        },
      }),
    { width: 60, height: 8 },
  );
  try {
    await view.renderOnce();
    setSession('second');
    await view.renderOnce();
    expect(requests).toHaveLength(2);
    expect(requests[0].signal.aborted).toBe(true);
    requests[0].resolve({ version: '1.0.0', availableVersion: null, installedVersion: null });
    await view.renderOnce();
    expect(view.captureCharFrame()).not.toContain('v1.0.0');
    requests[1].resolve({ version: '2.0.0', availableVersion: null, installedVersion: null });
    await view.waitForFrame((frame) => frame.includes('AOrchestra v2.0.0'));
  } finally {
    view.renderer.destroy();
    if (cleanup) await cleanup();
  }
});

test('first-launch model picker configures the chosen model without a model call, and cancellation preserves setup', async () => {
  for (const selected of [undefined, 'p/main']) {
    const calls: unknown[] = [],
      alerts: string[] = [];
    let claim: any;
    let layer: any;
    const pending = { state: 'needs-model', models: ['p/main'], message: 'Choose a model.' };
    const ctx = {
      theme: { text: { muted: '#999999' } },
      location: { directory: '/project' },
      keymap: {
        layer: (callback: any) => {
          layer = callback();
        },
      },
      client: {
        rpc: () => ({
          get: async () => pending,
          configure: async (input: unknown) => {
            calls.push(input);
            return {
              state: 'restart-required',
              models: [],
              message: 'Setup passed. Restart OpenCode.',
            };
          },
        }),
      },
      ui: {
        slot: (value: any) => {
          claim = value;
          return () => {};
        },
        dialog: {
          select: async (input: any) => {
            expect(input.options).toEqual([{ title: 'p/main', value: 'p/main' }]);
            return selected;
          },
          alert: async (input: any) => {
            alerts.push(input.message);
          },
        },
      },
    } as unknown as Plugin.Context;
    const { setupOnboardingUI } = await import('../plugins/aorchestra-tui');
    const cleanup = setupOnboardingUI(ctx);
    expect(layer.commands[0].slash.name).toBe('aorchestra-setup');
    expect(claim.append).toBe('home.footer');
    const view = await testRender(() => claim.render({}), { width: 80, height: 8 });
    try {
      await view.waitForFrame((frame) => frame.includes('Choose a model.'));
      expect(calls).toEqual(selected ? [{ model: selected }] : []);
      expect(alerts).toEqual(selected ? ['Setup passed. Restart OpenCode.'] : []);
    } finally {
      view.renderer.destroy();
      cleanup();
    }
  }
});

test('setup command retries provider discovery and reports authentication gaps without writing', async () => {
  let layer: any;
  const requests: unknown[] = [],
    alerts: string[] = [];
  const ctx = {
    location: { directory: '/project' },
    keymap: {
      layer: (callback: any) => {
        layer = callback();
      },
    },
    client: {
      rpc: () => ({
        configure: async (input: unknown) => {
          requests.push(input);
          return {
            state: 'needs-model',
            models: [],
            message: 'Authenticate a provider, then retry.',
          };
        },
      }),
    },
    ui: {
      slot: () => () => {},
      dialog: {
        alert: async (input: any) => {
          alerts.push(input.message);
        },
      },
    },
  } as unknown as Plugin.Context;
  const { setupOnboardingUI } = await import('../plugins/aorchestra-tui');
  const cleanup = setupOnboardingUI(ctx);
  try {
    await layer.commands[0].run();
    expect(requests).toEqual([{}]);
    expect(alerts).toEqual(['Authenticate a provider, then retry.']);
  } finally {
    cleanup();
  }
});
