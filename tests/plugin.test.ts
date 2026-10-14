import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { Plugin } from '@opencode/plugin';
import plugin from '../plugins/aorchestra';
import { Ledger, type Handoff } from '../lib/core';
import { fingerprint, snapshot } from '../lib/files';
import archivedDelegation from './fixtures/delegation-contract.json';
import { proofContext, requestBudget, readyForProof } from './fixtures/delegation-proof/gate';

async function fixture(options: Record<string, unknown> = {}, proof = false) {
  const scratch = resolve(import.meta.dir, '../work/aorchestra-v2-tests');
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'run-'));
  await writeFile(join(root, 'api.ts'), 'export const oldApi = true;\n');
  const data = new Map<string, unknown>();
  const hooks = new Map<string, (event: any) => Promise<void>>();
  const tools = new Map<string, any>();
  const searchMatches: any[] = [];
  tools.set('grep', {
    execute: async () => ({ output: searchMatches, content: 'search results' }),
  });
  const creations: any[] = [];
  const interruptions: any[] = [];
  const prompts: any[] = [];
  let currentAgent = 'aorchestra';
  const skills: any[] = [];
  const rpc = new Map<string, any>();
  const events: any[] = [];
  let wake: (() => void) | undefined;
  const ctx = {
    app: { version: '2.0.26' },
    plugin: { list: async () => ({ data: [] }) },
    location: { directory: root },
    options: { updateCheck: false, autoSetup: false, ...options },
    storage: {
      get: async (key: string) => data.get(key),
      set: async (key: string, value: unknown) => {
        data.set(key, structuredClone(value));
      },
      scan: async ({ prefix, after, limit = 100 }: any) => {
        const keys = [...data.keys()]
          .filter((k) => k.startsWith(prefix) && (!after || k > after))
          .sort();
        const selected = keys.slice(0, limit);
        return {
          entries: selected.map((key) => ({ key, value: data.get(key) })),
          next: keys.length > limit ? selected.at(-1) : undefined,
        };
      },
    },
    rpc: {
      register: async (definition: any, handlers: any) => {
        rpc.set(definition.id, handlers);
      },
    },
    event: {
      subscribe: async function* ({ signal }: any) {
        while (!signal.aborted) {
          if (!events.length)
            await new Promise<void>((resolve) => {
              wake = resolve;
              signal.addEventListener('abort', resolve, { once: true });
            });
          if (signal.aborted) return;
          const event = events.shift();
          if (event) yield event;
        }
      },
    },
    session: {
      hook: async (name: string, callback: any) => {
        hooks.set(
          `session:${name}`,
          name === 'context' ? (event: any) => callback({ system: [], ...event }) : callback,
        );
      },
      get: async ({ sessionID }: any) => ({
        id: sessionID,
        agent: sessionID === 'primary' ? currentAgent : 'aorchestra-executor',
        location: { directory: root },
        cost: 0.01,
        tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
        outcome: 'succeeded',
      }),
      create: async (input: any) => {
        creations.push(input);
        return { id: `child-${creations.length}` };
      },
      prompt: async (input: any) => {
        prompts.push(input);
      },
      wait: async () => {},
      interrupt: async (input: any) => {
        interruptions.push(input);
      },
      context: async () => [
        {
          type: 'assistant',
          content: [
            {
              type: 'text',
              text: 'STATUS: PARTIAL\nRESULT: investigated\nEVIDENCE: read api.ts\nCHANGED: none\nOPEN: primary validation',
            },
          ],
        },
      ],
    },
    permission: {
      hook: async (name: string, callback: any) => {
        hooks.set(`permission:${name}`, callback);
      },
    },
    skill: {
      transform: async (callback: any) => callback({ add: (skill: any) => skills.push(skill) }),
    },
    tool: {
      hook: async (name: string, callback: any) => {
        hooks.set(`tool:${name}`, callback);
      },
      list: async () =>
        ['read', 'grep', 'patch', 'shell', 'execute'].map((id) => ({
          id,
          options: { codemode: false },
        })),
      transform: async (callback: any) =>
        callback({
          add: (tool: any) => tools.set(tool.name, tool),
          update: (id: string, update: any) => {
            if (tools.has(id)) update(tools.get(id));
          },
        }),
    },
    model: {
      list: async () => ({
        data: ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'].map((id) => ({
          providerID: 'github-copilot',
          id,
          capabilities: { tools: true },
          variants: [],
        })),
      }),
    },
  } as unknown as Plugin.Context;
  const cleanup = await plugin.setup(proof ? proofContext(ctx) : ctx);
  const execution = {
    sessionID: 'primary',
    agent: 'aorchestra',
    signal: new AbortController().signal,
    progress: async () => {},
  };
  const invoke = (name: string, input: unknown) => tools.get(name).execute(input, execution);
  const task = {
    id: 'api',
    kind: 'change',
    instruction: 'Preserve API',
    context: '',
    handoff: {
      sources: [{ ref: 'api.ts', status: 'observed', revision: 'unknown' }],
      facts: ['Existing oldApi export'],
      unknowns: [],
      checks: ['Regression test not run'],
    },
    dependsOn: [] as string[],
    writePaths: ['api.ts'],
    preserve: ['oldApi export remains'],
    verifiers: [
      {
        id: 'tests',
        tool: 'shell',
        input: { command: 'bun test api.test.ts' },
        expect: { exitCode: 0 },
      },
    ],
  };
  const register = () => invoke('aorchestra_task', { operation: 'register', task });
  const start = () => invoke('aorchestra_task', { operation: 'start', taskId: 'api' });
  const runTool = async (event: any) => {
    await hooks.get('tool:execute.before')!(event);
    await hooks.get('tool:execute.after')!(event);
  };
  const verify = (exitCode = 0, command = 'bun test api.test.ts') =>
    runTool({
      tool: 'shell',
      agent: 'aorchestra',
      sessionID: 'primary',
      id: 'verifier-1',
      input: { command },
      status: 'completed',
      result: { metadata: { exitCode } },
    });
  const accept = () =>
    invoke('aorchestra_task', {
      operation: 'accept',
      taskId: 'api',
      compatibilityReview: 'oldApi export preserved and focused test passed',
    });
  const clean = async () => {
    if (cleanup) await cleanup();
    if (!root.startsWith(`${scratch}\\`) && !root.startsWith(`${scratch}/`))
      throw new Error('TEST_CLEANUP_ESCAPE');
    await rm(root, { recursive: true });
  };
  const emit = (event: any) => {
    events.push(event);
    wake?.();
  };
  return {
    root,
    ctx,
    hooks,
    tools,
    searchMatches,
    data,
    creations,
    interruptions,
    prompts,
    skills,
    rpc,
    emit,
    invoke,
    task,
    register,
    start,
    verify,
    runTool,
    accept,
    clean,
    switchAgent: (agent: string) => {
      currentAgent = agent;
    },
  };
}

test('checks started before repair cannot grant receipts or revoke freshly accepted evidence', async () => {
  const f = await fixture();
  try {
    await f.hooks.get('session:context')!({
      agent: 'aorchestra',
      sessionID: 'primary',
      tools: {},
      options: {},
      system: [],
      model: { providerID: 'test', id: 'model' },
    });
    await f.register();
    await f.start();
    const ledger = new Ledger(f.ctx.storage);
    // Existing v1 tasks without an epoch remain usable until evidence is reset.
    await ledger.mutate('primary', (state) => {
      delete state.tasks[0].verificationEpoch;
    });
    const success = {
      tool: 'shell',
      agent: 'aorchestra',
      sessionID: 'primary',
      id: 'pre-repair-success',
      input: { command: 'bun test api.test.ts' },
      status: 'completed',
      result: { metadata: { exitCode: 0 } },
    };
    const failure = { ...success, id: 'pre-repair-failure', result: { metadata: { exitCode: 1 } } };
    await f.hooks.get('tool:execute.before')!(success);
    await f.hooks.get('tool:execute.before')!(failure);
    await f.verify(1);
    await f.invoke('aorchestra_task', {
      operation: 'repair',
      taskId: 'api',
      reason: 'Investigated the failure; obtain new evidence',
    });
    await f.hooks.get('tool:execute.after')!(success);
    const repaired = (await ledger.read('primary')).tasks[0];
    expect(repaired.receipts).toEqual({});
    expect(repaired.workflow!.phase).toBe('repair');
    expect(repaired.workflow!.repairRequired).toBeUndefined();
    expect(repaired.verificationEpoch).toBe(1);
    await expect(f.accept()).rejects.toThrow('VERIFIER_MISSING_OR_STALE');
    await f.verify();
    await f.accept();
    const accepted = (await ledger.read('primary')).tasks[0];
    await f.hooks.get('tool:execute.after')!(failure);
    expect((await ledger.read('primary')).tasks[0]).toEqual(accepted);
    const metrics = (await f.ctx.storage.get('metrics/session/primary')) as {
      active: { verifierPasses: number; verifierFailures: number };
    };
    expect(metrics.active.verifierPasses).toBe(1);
    expect(metrics.active.verifierFailures).toBe(1);
  } finally {
    await f.clean();
  }
});

test('invalidation and recovery reject check results from the previous execution', async () => {
  for (const operation of ['invalidate', 'recover']) {
    const f = await fixture();
    try {
      await f.register();
      await f.start();
      const event = {
        tool: 'shell',
        agent: 'aorchestra',
        sessionID: 'primary',
        id: 'old-execution',
        input: { command: 'bun test api.test.ts' },
        status: 'completed',
        result: { metadata: { exitCode: 0 } },
      };
      const lateFailure = { ...event, id: 'old-failure', result: { metadata: { exitCode: 1 } } };
      await f.hooks.get('tool:execute.before')!(event);
      await f.hooks.get('tool:execute.before')!(lateFailure);
      await f.invoke('aorchestra_task', {
        operation,
        taskId: 'api',
        reason: 'Reinspect the task contract',
      });
      await f.start();
      await f.hooks.get('tool:execute.after')!(event);
      const task = (await new Ledger(f.ctx.storage).read('primary')).tasks[0];
      expect(task.receipts).toEqual({});
      expect(task.workflow!.phase).toBe('execute');
      expect(task.workflow!.repairRequired).toBeUndefined();
      await expect(f.accept()).rejects.toThrow('VERIFIER_MISSING_OR_STALE');
      await f.verify();
      await f.accept();
      const accepted = (await new Ledger(f.ctx.storage).read('primary')).tasks[0];
      await f.hooks.get('tool:execute.after')!(lateFailure);
      expect((await new Ledger(f.ctx.storage).read('primary')).tasks[0]).toEqual(accepted);
    } finally {
      await f.clean();
    }
  }
});

test('review serializes overlapping and disjoint tasks until primary acceptance', async () => {
  for (const writePaths of [['api.ts'], ['other.ts']]) {
    const f = await fixture();
    try {
      await f.register();
      await f.invoke('aorchestra_delegate', {
        taskId: 'api',
        model: 'fast',
        tools: ['read'],
        routingEvidence: 'Bounded investigation before primary review',
      });
      await f.invoke('aorchestra_task', {
        operation: 'register',
        task: { ...f.task, id: 'next', writePaths },
      });
      await expect(
        f.invoke('aorchestra_task', { operation: 'start', taskId: 'next' }),
      ).rejects.toThrow('ACTIVE_TASK_EXISTS');
      await expect(
        f.invoke('aorchestra_delegate', {
          taskId: 'next',
          model: 'fast',
          tools: ['read'],
          routingEvidence: 'Next bounded slice',
        }),
      ).rejects.toThrow('ACTIVE_TASK_EXISTS');
      const before = await new Ledger(f.ctx.storage).read('primary');
      expect(before.tasks.map((task) => task.status)).toEqual(['review', 'pending']);
      expect(before.delegations).toBe(1);
      expect(f.creations).toHaveLength(1);
      await f.verify();
      await f.accept();
      await f.invoke('aorchestra_task', { operation: 'start', taskId: 'next' });
      const after = await new Ledger(f.ctx.storage).read('primary');
      expect(after.tasks.map((task) => task.status)).toEqual(['complete', 'running']);
      const allowed = {
        agent: 'aorchestra',
        sessionID: 'primary',
        action: 'edit',
        resources: writePaths,
        effect: 'allow',
      };
      await f.hooks.get('permission:evaluate')!(allowed);
      expect(allowed.effect).toBe('allow');
    } finally {
      await f.clean();
    }
  }
});

test('legacy concurrent running and review tasks cannot choose a primary edit owner', async () => {
  const f = await fixture();
  try {
    await f.register();
    await f.start();
    await f.invoke('aorchestra_task', { operation: 'register', task: { ...f.task, id: 'legacy' } });
    await new Ledger(f.ctx.storage).mutate('primary', (state) => {
      state.tasks[1].status = 'review';
    });
    const permission = {
      agent: 'aorchestra',
      sessionID: 'primary',
      action: 'edit',
      resources: ['api.ts'],
      effect: 'allow',
    };
    await f.hooks.get('permission:evaluate')!(permission);
    expect(permission.effect).toBe('deny');
  } finally {
    await f.clean();
  }
});

test('native token warnings count reasoning and cache without blocking primary or executor', async () => {
  for (const agent of ['aorchestra', 'aorchestra-executor']) {
    const f = await fixture({ maxSessionTokens: 100 });
    try {
      const sessionID = agent === 'aorchestra' ? 'primary' : 'child-1';
      if (agent === 'aorchestra-executor') {
        await f.register();
        await f.invoke('aorchestra_delegate', {
          taskId: 'api',
          model: 'fast',
          tools: ['read'],
          routingEvidence: 'Bounded lookup',
        });
        const saved = (await f.ctx.storage.get('child/child-1')) as Record<string, unknown>;
        await f.ctx.storage.set('child/child-1', { ...saved, active: true });
      }
      const get = f.ctx.session.get;
      for (const [cacheRead, cacheWrite] of [
        [84, 0],
        [85, 0],
        [0, 85],
        [40, 45],
      ]) {
        f.ctx.session.get = async (input) => ({
          ...(await get(input)),
          tokens: {
            input: 10,
            output: 4,
            reasoning: 1,
            cache: { read: cacheRead, write: cacheWrite },
          },
        });
        const context = {
          agent,
          sessionID,
          tools: { read: {} },
          options: {},
          system: [] as any[],
          model: { providerID: 'test', id: 'model' },
        };
        await f.hooks.get('session:context')!(context);
        const warning = context.system.find((item) => item.text.includes('session usage is high'));
        expect(warning.text).toContain(`\"consumed\":${15 + cacheRead + cacheWrite}`);
        expect(warning.text).toContain('does not block dispatch');
      }
    } finally {
      await f.clean();
    }
  }
});

test('bundled repo-context is available by explicit ID without automatic invocation', async () => {
  const f = await fixture();
  try {
    expect(f.skills[0].id).toBe('aorchestra-repo-context');
    expect(f.skills[0].autoinvoke).toBe(false);
    expect(f.skills[0].path).toContain('skills');
    expect(f.skills[0].content.startsWith('---')).toBe(false);
  } finally {
    await f.clean();
  }
});
test('native primary edits are denied outside a tracked task before filesystem mutation', async () => {
  const f = await fixture();
  try {
    await f.register();
    await f.start();
    const forbidden = {
      agent: 'aorchestra',
      sessionID: 'primary',
      action: 'edit',
      resources: ['unrelated.ts'],
      effect: 'allow',
    };
    await f.hooks.get('permission:evaluate')!(forbidden);
    expect(forbidden.effect).toBe('deny');
    const allowed = { ...forbidden, resources: ['api.ts'], effect: 'allow' };
    await f.hooks.get('permission:evaluate')!(allowed);
    expect(allowed.effect).toBe('allow');
  } finally {
    await f.clean();
  }
});

test('actual plugin flow accepts fresh matching verifier, not failed or unrelated shell', async () => {
  const f = await fixture();
  try {
    await f.register();
    await f.start();
    await f.verify(0, 'echo passed');
    await expect(f.accept()).rejects.toThrow('VERIFIER_MISSING_OR_STALE');
    await f.verify(1);
    await expect(f.accept()).rejects.toThrow('BEGIN_REPAIR_BEFORE_ACCEPTANCE');
    await f.verify(0);
    await expect(f.accept()).rejects.toThrow('BEGIN_REPAIR_BEFORE_ACCEPTANCE');
    const ledger = new Ledger(f.ctx.storage);
    expect((await ledger.read('primary')).tasks[0].workflow!.repairRequired).toBe(true);
    expect((await ledger.read('primary')).tasks[0].workflow!.repairs).toBe(0);
    await f.invoke('aorchestra_task', {
      operation: 'repair',
      taskId: 'api',
      reason: 'Investigated the failed test before accepting a rerun',
    });
    await expect(f.accept()).rejects.toThrow('VERIFIER_MISSING_OR_STALE');
    await f.verify(0);
    const result = await f.accept();
    expect(result.content).toContain('"status": "complete"');
    expect((await ledger.read('primary')).tasks[0].workflow!.repairs).toBe(1);
  } finally {
    await f.clean();
  }
});
test('external source mutation after native verifier makes evidence stale', async () => {
  const f = await fixture();
  try {
    await f.register();
    await f.start();
    await f.verify();
    await writeFile(join(f.root, 'api.ts'), 'export const oldApi = false;\n');
    await expect(f.accept()).rejects.toThrow('VERIFIER_MISSING_OR_STALE');
  } finally {
    await f.clean();
  }
});
test('a passing verifier cannot attest to sources changed during its execution', async () => {
  const f = await fixture();
  try {
    await f.register();
    await f.start();
    await f.verify();
    const event = {
      tool: 'shell',
      agent: 'aorchestra',
      sessionID: 'primary',
      id: 'in-flight',
      input: { command: 'bun test api.test.ts' },
      status: 'completed',
      result: { metadata: { exitCode: 0 } },
    };
    await f.hooks.get('tool:execute.before')!(event);
    await writeFile(join(f.root, 'api.ts'), 'export const brokenApi = true;\n');
    await f.hooks.get('tool:execute.after')!(event);
    const task = (await new Ledger(f.ctx.storage).read('primary')).tasks[0];
    expect(task.receipts.tests).toBeUndefined();
    expect(task.verification!.observations.tests.passed).toBe(false);
    expect(task.workflow!.repairRequired).toBe(true);
    await expect(f.accept()).rejects.toThrow('BEGIN_REPAIR_BEFORE_ACCEPTANCE');
    await f.invoke('aorchestra_task', {
      operation: 'repair',
      taskId: 'api',
      reason: 'Source changed while the previous test was running; rerun current sources',
    });
    await f.verify();
    await f.accept();
  } finally {
    await f.clean();
  }
});
test('overlapping verifier calls keep separate source snapshots', async () => {
  const f = await fixture();
  try {
    await f.register();
    await f.start();
    const first = {
      tool: 'shell',
      agent: 'aorchestra',
      sessionID: 'primary',
      id: 'first',
      input: { command: 'bun test api.test.ts' },
      status: 'completed',
      result: { metadata: { exitCode: 0 } },
    };
    const second = { ...first, id: 'second' };
    await f.hooks.get('tool:execute.before')!(first);
    await writeFile(join(f.root, 'api.ts'), 'export const oldApi = false;\n');
    await f.hooks.get('tool:execute.before')!(second);
    await f.hooks.get('tool:execute.after')!(first);
    await f.hooks.get('tool:execute.after')!(second);
    const task = (await new Ledger(f.ctx.storage).read('primary')).tasks[0];
    expect(task.receipts.tests.event).toBe('primary:second');
    expect(task.verification!.observations.tests.passed).toBe(true);
    // A later stable check cannot discard the earlier repair obligation.
    await expect(f.accept()).rejects.toThrow('BEGIN_REPAIR_BEFORE_ACCEPTANCE');
  } finally {
    await f.clean();
  }
});
test('missing before evidence, including after plugin restart, cannot grant a receipt', async () => {
  for (const restart of [false, true]) {
    const f = await fixture();
    let cleanup: (() => void) | void = undefined;
    try {
      await f.register();
      await f.start();
      const event = {
        tool: 'shell',
        agent: 'aorchestra',
        sessionID: 'primary',
        id: 'unpaired',
        input: { command: 'bun test api.test.ts' },
        status: 'completed',
        result: { metadata: { exitCode: 0 } },
      };
      if (restart) {
        await f.hooks.get('tool:execute.before')!(event);
        cleanup = await plugin.setup(f.ctx);
      }
      await f.hooks.get('tool:execute.after')!(event);
      const task = (await new Ledger(f.ctx.storage).read('primary')).tasks[0];
      expect(task.receipts.tests).toBeUndefined();
      expect(task.verification!.observations.tests).toBeUndefined();
      expect(task.workflow!.repairRequired).toBeUndefined();
      await expect(f.accept()).rejects.toThrow('VERIFIER_MISSING_OR_STALE');
      await f.verify();
      await f.accept();
    } finally {
      if (cleanup) await cleanup();
      await f.clean();
    }
  }
});
test('callbacks without current before ownership cannot revoke fresh acceptance', async () => {
  for (const mode of ['pending', 'unpaired', 'restart'])
    for (const exitCode of [0, 1]) {
      const f = await fixture();
      let cleanup: void | (() => void) = undefined;
      try {
        await f.register();
        const event = {
          tool: 'shell',
          agent: 'aorchestra',
          sessionID: 'primary',
          id: 'late-check',
          input: { command: 'bun test api.test.ts' },
          status: 'completed',
          result: { metadata: { exitCode } },
        };
        if (mode === 'pending') await f.hooks.get('tool:execute.before')!(event);
        await f.start();
        if (mode === 'restart') {
          await f.hooks.get('tool:execute.before')!(event);
          cleanup = await plugin.setup(f.ctx);
        }
        await f.verify();
        await f.accept();
        const ledger = new Ledger(f.ctx.storage),
          accepted = (await ledger.read('primary')).tasks[0];
        await f.hooks.get('tool:execute.after')!(event);
        expect((await ledger.read('primary')).tasks[0]).toEqual(accepted);
      } finally {
        if (cleanup) cleanup();
        await f.clean();
      }
    }
});
test('source mutation during an accepted task rerun revokes its acceptance', async () => {
  const f = await fixture();
  try {
    await f.register();
    await f.start();
    await f.verify();
    await f.accept();
    const event = {
      tool: 'shell',
      agent: 'aorchestra',
      sessionID: 'primary',
      id: 'accepted-rerun',
      input: { command: 'bun test api.test.ts' },
      status: 'completed',
      result: { metadata: { exitCode: 0 } },
    };
    await f.hooks.get('tool:execute.before')!(event);
    await writeFile(join(f.root, 'api.ts'), 'export const brokenApi = true;\n');
    await f.hooks.get('tool:execute.after')!(event);
    const task = (await new Ledger(f.ctx.storage).read('primary')).tasks[0];
    expect(task.status).toBe('blocked');
    expect(task.receipts).toEqual({});
    expect(task.compatibilityReview).toBeUndefined();
    expect(task.workflow!.repairRequired).toBe(true);
  } finally {
    await f.clean();
  }
});
test('acceptance rejects observed changes outside exact task scope', async () => {
  const f = await fixture();
  try {
    await f.register();
    await f.start();
    await writeFile(join(f.root, 'unrelated.ts'), 'unauthorized');
    await f.verify();
    await expect(f.accept()).rejects.toThrow('WRITE_SCOPE_VIOLATION');
  } finally {
    await f.clean();
  }
});
test('restarting an active task cannot replace its baseline or hide changes', async () => {
  const f = await fixture();
  try {
    await f.register();
    await f.start();
    await expect(f.start()).rejects.toThrow('TASK_ALREADY_STARTED');
  } finally {
    await f.clean();
  }
});
test('delegate creates native session with permissions and returns unaccepted review', async () => {
  const f = await fixture();
  try {
    await f.register();
    const result = await f.invoke('aorchestra_delegate', {
      taskId: 'api',
      model: 'fast',
      tools: ['read', 'patch'],
      routingEvidence: 'Known path, exact pattern, focused verifier',
    });
    expect(f.creations[0].permissions[0].effect).toBe('deny');
    expect(
      f.creations[0].permissions.some((r: any) => r.action === 'shell' && r.effect === 'allow'),
    ).toBe(false);
    expect(result.metadata.accepted).toBe(false);
    expect(result.metadata.attempt).toBe(1);
    await expect(
      f.hooks.get('tool:execute.before')!({
        agent: 'aorchestra-executor',
        sessionID: 'child-1',
        tool: 'patch',
      }),
    ).rejects.toThrow('WORKER_TOOL_DENIED');
    // The same durable contract remains inactive after setup is re-created.
    const secondCleanup = await plugin.setup(f.ctx);
    await expect(
      f.hooks.get('session:context')!({
        agent: 'aorchestra-executor',
        sessionID: 'child-1',
        tools: {},
      }),
    ).rejects.toThrow('EXECUTOR_CONTRACT_INACTIVE');
    if (secondCleanup) await secondCleanup();
  } finally {
    await f.clean();
  }
});

test.each(archivedDelegation.calls)(
  'archived malformed delegation call identifies field types before state or child creation: %j',
  async (call) => {
    const f = await fixture();
    try {
      await f.invoke('aorchestra_task', archivedDelegation.registration);
      const ledger = new Ledger(f.ctx.storage);
      const before = await ledger.read('primary');
      await expect(f.invoke('aorchestra_delegate', call.input)).rejects.toThrow(
        call.originalError === 'HANDOFF_SOURCES_INVALID'
          ? 'HANDOFF_OBJECT_REQUIRED: handoff must be a JSON object'
          : 'TOOLS_ARRAY_REQUIRED: tools must be a JSON array',
      );
      expect(await ledger.read('primary')).toEqual(before);
      expect(f.creations).toHaveLength(0);
      expect(f.prompts).toHaveLength(0);
    } finally {
      await f.clean();
    }
  },
);

test('corrected archived structured payload reuses task and handoff without spending a failed attempt', async () => {
  const f = await fixture({ maxDelegations: 1, maxAttempts: 1 });
  try {
    await f.invoke('aorchestra_task', archivedDelegation.registration);
    const call = archivedDelegation.calls[0].input;
    await expect(f.invoke('aorchestra_delegate', call)).rejects.toThrow('HANDOFF_OBJECT_REQUIRED');
    const catalog = await f.ctx.tool.list();
    (f.ctx.tool as any).list = async () => [
      ...catalog,
      { id: 'glob', options: { codemode: false } },
    ];
    const corrected = { ...archivedDelegation.calls[1].input, tools: JSON.parse(call.tools) };
    const result = await f.invoke('aorchestra_delegate', corrected);
    expect(result.metadata.accepted).toBe(false);
    expect(f.creations).toHaveLength(1);
    expect(f.prompts[0].text).toContain(
      JSON.stringify(archivedDelegation.registration.task.handoff),
    );
    expect(f.creations[0].permissions).toContainEqual({
      action: '*',
      resource: '*',
      effect: 'deny',
    });
    expect(f.creations[0].permissions).toContainEqual({
      action: 'read',
      resource: '*',
      effect: 'allow',
    });
    const state = await new Ledger(f.ctx.storage).read('primary');
    expect(state.delegations).toBe(1);
    expect(state.tasks[0].attempts).toHaveLength(1);
    expect(state.tasks[0].workflow!.repairs).toBe(0);
    expect(state.tasks[0].status).toBe('review');
  } finally {
    await f.clean();
  }
});

test('delegation required fields and typed optional fields reject malformed inputs without mutation', async () => {
  const f = await fixture();
  try {
    await f.register();
    const valid = {
      taskId: 'api',
      model: 'fast',
      tools: ['read'],
      routingEvidence: 'Bounded lookup',
    };
    const ledger = new Ledger(f.ctx.storage);
    const before = await ledger.read('primary');
    for (const field of ['taskId', 'model', 'tools', 'routingEvidence']) {
      const input: any = { ...valid };
      delete input[field];
      await expect(f.invoke('aorchestra_delegate', input)).rejects.toThrow(field);
      expect(await ledger.read('primary')).toEqual(before);
    }
    for (const input of [
      null,
      [],
      { ...valid, model: 'unknown' },
      { ...valid, delta: 1 },
      { ...valid, routingEvidence: ' ' },
      { ...valid, surprise: true },
      { ...valid, handoff: null },
      { ...valid, tools: ['read', 'read'] },
      {
        ...valid,
        handoff: { ...f.task.handoff, sources: [{ ref: 'api.ts', status: 'candidate' }] },
      },
      { tasks: JSON.stringify([valid, valid]) },
      { tasks: [null, valid] },
      { ...valid, tasks: [] },
    ]) {
      await expect(f.invoke('aorchestra_delegate', input)).rejects.toThrow();
      expect(await ledger.read('primary')).toEqual(before);
    }
    expect(f.creations).toHaveLength(0);
  } finally {
    await f.clean();
  }
});

test('malformed group handoff rejects every member atomically with unchanged provenance and budgets', async () => {
  const f = await fixture({ maxConcurrentAnalyses: 2, maxDelegations: 2, maxAttempts: 1 });
  try {
    const analysis = { ...f.task, kind: 'analysis', analysisMode: 'lookup', writePaths: [] };
    for (const id of ['first', 'second'])
      await f.invoke('aorchestra_task', { operation: 'register', task: { ...analysis, id } });
    const before = await new Ledger(f.ctx.storage).read('primary');
    await expect(
      f.invoke('aorchestra_delegate', {
        tasks: ['first', 'second'].map((taskId) => ({
          taskId,
          model: 'fast',
          tools: ['read'],
          routingEvidence: 'Independent lookup',
          ...(taskId === 'second' ? { handoff: JSON.stringify(f.task.handoff) } : {}),
        })),
      }),
    ).rejects.toThrow('HANDOFF_OBJECT_REQUIRED');
    expect(await new Ledger(f.ctx.storage).read('primary')).toEqual(before);
    expect(f.creations).toHaveLength(0);
  } finally {
    await f.clean();
  }
});

test('registration rejects an explicitly malformed handoff without saving a task', async () => {
  const f = await fixture();
  try {
    for (const handoff of [null, false, JSON.stringify(f.task.handoff)]) {
      await expect(
        f.invoke('aorchestra_task', {
          operation: 'register',
          task: { ...f.task, handoff },
        }),
      ).rejects.toThrow('HANDOFF_OBJECT_REQUIRED');
      expect((await new Ledger(f.ctx.storage).read('primary')).tasks).toHaveLength(0);
    }
  } finally {
    await f.clean();
  }
});

test('delegation schema communicates structured arguments and executable example', async () => {
  const f = await fixture();
  try {
    const tool = f.tools.get('aorchestra_delegate');
    const schema = tool.input.oneOf[0];
    expect(schema.properties.tools.type).toBe('array');
    expect(schema.properties.tools.description).toContain('JSON array');
    expect(schema.properties.handoff.type).toBe('object');
    expect(schema.properties.handoff.description).toContain('JSON object');
    expect(schema.properties.tools.uniqueItems).toBe(true);
    expect(schema.required).toEqual(['taskId', 'model', 'tools', 'routingEvidence']);
    expect(tool.description).toContain('"tools":["read"]');
    expect(tool.description).toContain(
      'reuse its instruction, context, scope, verifiers and handoff',
    );
    expect(tool.description).toContain('Results remain unaccepted');
  } finally {
    await f.clean();
  }
});

test('legacy tasks require a handoff before spending budget; supplying it sends provenance to the child', async () => {
  const f = await fixture();
  try {
    await f.register();
    const ledger = new Ledger(f.ctx.storage);
    await ledger.mutate('primary', (state) => {
      delete state.tasks[0].handoff;
    });
    const call = {
      taskId: 'api',
      model: 'fast',
      tools: ['read'],
      routingEvidence: 'Bounded known-file extraction',
    };
    await expect(f.invoke('aorchestra_delegate', call)).rejects.toThrow('HANDOFF_REQUIRED');
    expect(f.creations).toHaveLength(0);
    expect((await ledger.read('primary')).delegations).toBe(0);
    const handoff: Handoff = {
      sources: [{ ref: 'api.ts', status: 'observed', revision: 'unknown' }],
      facts: ['oldApi is exported'],
      unknowns: ['Consumer behavior not inspected'],
      checks: ['Regression check not run'],
    };
    await f.invoke('aorchestra_delegate', { ...call, handoff });
    expect(f.prompts[0].text).toContain(JSON.stringify(handoff));
    expect(f.prompts[0].text).toContain('SOURCE SNAPSHOT AT DELEGATION (not a Git revision)');
    expect((await ledger.read('primary')).tasks[0].handoff).toEqual(handoff);
  } finally {
    await f.clean();
  }
});

test('fast-to-strong retry respects an explicit two-child budget', async () => {
  const f = await fixture({ maxAttempts: 2 });
  try {
    await f.register();
    const call = { taskId: 'api', tools: ['read'], routingEvidence: 'Known consumer and pattern' };
    await f.invoke('aorchestra_delegate', { ...call, model: 'fast' });
    await f.invoke('aorchestra_task', {
      operation: 'repair',
      taskId: 'api',
      reason: 'Discovered another public consumer',
    });
    await expect(
      f.invoke('aorchestra_delegate', {
        ...call,
        model: 'strong',
        delta: 'Discovered another consumer',
      }),
    ).rejects.toThrow('ESCALATION_REASON_REQUIRED');
    expect(f.creations).toHaveLength(1);
    await f.invoke('aorchestra_delegate', {
      ...call,
      model: 'strong',
      delta: 'Discovered another public consumer',
      escalationReason: 'compatibility-risk',
    });
    expect(f.creations).toHaveLength(2);
    expect(f.prompts[1].text).toContain('ESCALATION REASON\ncompatibility-risk');
    await f.invoke('aorchestra_task', {
      operation: 'repair',
      taskId: 'api',
      reason: 'Another finding requires a retry',
    });
    await expect(
      f.invoke('aorchestra_delegate', { ...call, model: 'strong', delta: 'Another finding' }),
    ).rejects.toThrow('BUDGET_EXCEEDED');
    expect(f.creations).toHaveLength(2);
  } finally {
    await f.clean();
  }
});

test('DIRECT without ledger is recorded on a native terminal event, without semantic success claims', async () => {
  const f = await fixture();
  try {
    await f.hooks.get('session:context')!({
      agent: 'aorchestra',
      sessionID: 'primary',
      model: { providerID: 'test', id: 'fast' },
      tools: { read: {} },
      options: {},
    });
    await f.hooks.get('tool:execute.after')!({
      agent: 'aorchestra',
      sessionID: 'primary',
      tool: 'read',
      input: { filePath: 'api.ts' },
      status: 'completed',
      id: 'read-1',
      result: { content: 'observed' },
    });
    f.emit({
      type: 'session.execution.succeeded',
      id: 'terminal',
      created: Date.now(),
      location: { directory: f.root },
      data: { sessionID: 'primary' },
    });
    let rows: any[] = [];
    for (let attempt = 0; attempt < 50; attempt++) {
      rows = (await f.rpc.get('aorchestra.metrics').list({})).runs.filter(
        (r: any) => r.endedAt !== null,
      );
      if (rows.length) break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(rows.length).toBe(1);
    expect(rows[0].children).toEqual([]);
    expect(rows[0].tasks).toEqual([]);
    expect(rows[0].tools.read).toBe(1);
    expect(rows[0].runtimeOutcome).toBe('succeeded');
  } finally {
    await f.clean();
  }
});
test('cancelled parent does not reserve budget or create a child', async () => {
  const f = await fixture();
  try {
    await f.register();
    const controller = new AbortController();
    controller.abort();
    await expect(
      f.tools.get('aorchestra_delegate').execute(
        { taskId: 'api', model: 'fast', tools: ['read'], routingEvidence: 'Known path' },
        {
          sessionID: 'primary',
          agent: 'aorchestra',
          signal: controller.signal,
          progress: async () => {},
        },
      ),
    ).rejects.toThrow();
    expect(f.creations.length).toBe(0);
  } finally {
    await f.clean();
  }
});

test('switching to Build hides harness tools and leaves compaction, retry and permissions alone', async () => {
  const f = await fixture();
  try {
    await f.register();
    await f.hooks.get('session:context')!({
      agent: 'aorchestra',
      sessionID: 'primary',
      model: { providerID: 'test', id: 'main' },
      tools: { read: {} },
      options: {},
    });
    f.switchAgent('build');
    const tools = { read: {}, aorchestra_task: {}, aorchestra_delegate: {}, external_tool: {} };
    const options = { maxTokens: 321 };
    await f.hooks.get('session:context')!({ agent: 'build', sessionID: 'primary', tools, options });
    expect(Object.keys(tools)).toEqual(['read', 'external_tool']);
    expect(options.maxTokens).toBe(321);
    const system: unknown[] = [];
    await f.hooks.get('session:compaction')!({ agent: 'build', sessionID: 'primary', system });
    expect(system).toEqual([]);
    const decision = { retry: true, delay: 10 };
    await f.hooks.get('session:retry')!({
      agent: 'build',
      sessionID: 'primary',
      decision,
      error: 'example',
    });
    expect(decision).toEqual({ retry: true, delay: 10 });
    const permission = {
      agent: 'build',
      sessionID: 'primary',
      action: 'edit',
      resources: ['other.ts'],
      effect: 'allow',
    };
    await f.hooks.get('permission:evaluate')!(permission);
    expect(permission.effect).toBe('allow');
    const rows = (await f.rpc.get('aorchestra.metrics').list({})).runs;
    expect(rows).toHaveLength(1);
    expect(rows[0].observationIssue).toBe('agent-switched');
    expect(rows[0].endedAt).toBe(null);
    expect(rows[0].providerRetries).toBe(0);
  } finally {
    await f.clean();
  }
});

test('an active child loses tool access when its owner switches away from AOrchestra', async () => {
  const f = await fixture();
  try {
    await f.register();
    f.ctx.session.wait = async () => {
      f.switchAgent('build');
      await f.hooks.get('tool:execute.before')!({
        agent: 'aorchestra-executor',
        sessionID: 'child-1',
        tool: 'patch',
      });
    };
    await expect(
      f.invoke('aorchestra_delegate', {
        taskId: 'api',
        model: 'fast',
        tools: ['read', 'patch'],
        routingEvidence: 'Known source',
      }),
    ).rejects.toThrow('AORCHESTRA_OWNER_INACTIVE');
    expect(await readFile(join(f.root, 'api.ts'), 'utf8')).toBe('export const oldApi = true;\n');
  } finally {
    await f.clean();
  }
});

test('Build context interrupts outstanding children and blocks stale primary work', async () => {
  const f = await fixture();
  try {
    await f.register();
    const interrupted: string[] = [];
    f.ctx.session.interrupt = async (input) => {
      interrupted.push(input.sessionID);
      return { interrupted: true };
    };
    f.ctx.session.wait = async () => {
      f.switchAgent('build');
      await f.hooks.get('session:context')!({
        agent: 'build',
        sessionID: 'primary',
        tools: { read: {} },
        options: {},
      });
      await expect(
        f.hooks.get('tool:execute.before')!({
          agent: 'aorchestra',
          sessionID: 'primary',
          tool: 'read',
        }),
      ).rejects.toThrow('AORCHESTRA_OWNER_INACTIVE');
    };
    await expect(
      f.invoke('aorchestra_delegate', {
        taskId: 'api',
        model: 'fast',
        tools: ['read'],
        routingEvidence: 'Known source',
      }),
    ).rejects.toThrow('AORCHESTRA_OWNER_INACTIVE');
    expect(interrupted).toContain('child-1');
    expect((await new Ledger(f.ctx.storage).read('primary')).tasks[0].status).toBe('blocked');
  } finally {
    await f.clean();
  }
});

test('all unrelated agents lose harness capabilities, not just Build', async () => {
  const f = await fixture();
  try {
    for (const agent of ['build', 'plan', 'research', 'custom-agent']) {
      const tools = { read: {}, aorchestra_task: {}, aorchestra_delegate: {} };
      await f.hooks.get('session:context')!({ agent, sessionID: 'other', tools, options: {} });
      expect(Object.keys(tools)).toEqual(['read']);
      await expect(
        f.hooks.get('tool:execute.before')!({ agent, sessionID: 'other', tool: 'aorchestra_task' }),
      ).rejects.toThrow('AORCHESTRA_INACTIVE_FOR_AGENT');
      const permission = {
        agent,
        sessionID: 'other',
        action: 'skill',
        resources: ['aorchestra-repo-context'],
        effect: 'allow',
      };
      await f.hooks.get('permission:evaluate')!(permission);
      expect(permission.effect).toBe('deny');
    }
    expect((await f.rpc.get('aorchestra.metrics').list({})).runs).toHaveLength(0);
  } finally {
    await f.clean();
  }
});

test('project-aware acceptance requires discovered checks and records native outcomes', async () => {
  const f = await fixture();
  try {
    await writeFile(
      join(f.root, 'package.json'),
      JSON.stringify({ scripts: { test: 'node --test' } }),
    );
    await f.register();
    await f.start();
    await f.verify();
    await expect(f.accept()).rejects.toThrow('VERIFIER_MISSING_OR_STALE');
    await f.verify(0, 'npm run test');
    const completed = JSON.parse((await f.accept()).content).tasks[0];
    expect(completed.workflow.phase).toBe('complete');
    expect(completed.workflow.events.map((e: any) => e.phase)).toEqual([
      'plan',
      'execute',
      'verify',
      'complete',
    ]);
    expect(completed.verification.observations[completed.verification.verifiers[0].id].passed).toBe(
      true,
    );
  } finally {
    await f.clean();
  }
});

test('failed native rerun revokes a previous successful receipt on the same source snapshot', async () => {
  const f = await fixture();
  try {
    await f.register();
    await f.start();
    await f.verify();
    await f.verify(1);
    await expect(f.accept()).rejects.toThrow('BEGIN_REPAIR_BEFORE_ACCEPTANCE');
    const state = (await new Ledger(f.ctx.storage).read('primary')).tasks[0];
    expect(state.receipts.tests).toBeUndefined();
    expect(state.verification!.observations.tests.passed).toBe(false);
  } finally {
    await f.clean();
  }
});

test('a matching root package command in another package cannot accept or revoke root evidence', async () => {
  const f = await fixture();
  try {
    await writeFile(
      join(f.root, 'package.json'),
      JSON.stringify({ scripts: { test: 'node --test' } }),
    );
    await mkdir(join(f.root, 'other'));
    await writeFile(
      join(f.root, 'other/package.json'),
      JSON.stringify({ scripts: { test: 'node --test' } }),
    );
    await f.register();
    await f.start();
    await f.verify();
    const ledger = new Ledger(f.ctx.storage);
    const generated = (await ledger.read('primary')).tasks[0].verification!.verifiers[0];
    expect(generated.input.workdir).toBe(f.root);
    const outcome = (exitCode: number, workdir: string) =>
      f.runTool({
        tool: 'shell',
        agent: 'aorchestra',
        sessionID: 'primary',
        id: `workdir-${exitCode}`,
        input: { command: 'npm run test', workdir },
        status: 'completed',
        result: { metadata: { exitCode } },
      });
    await outcome(0, join(f.root, 'other'));
    await expect(f.accept()).rejects.toThrow('VERIFIER_MISSING_OR_STALE');
    expect((await ledger.read('primary')).tasks[0].receipts[generated.id]).toBeUndefined();
    await outcome(0, f.root);
    await f.accept();
    await outcome(1, join(f.root, 'other'));
    expect((await ledger.read('primary')).tasks[0].status).toBe('complete');
    await outcome(1, f.root);
    expect((await ledger.read('primary')).tasks[0].status).toBe('blocked');
  } finally {
    await f.clean();
  }
});

test('failed DIRECT verification cannot recover, restart or invalidate around bounded repairs', async () => {
  const f = await fixture({ maxRepairs: 2 });
  try {
    await f.register();
    await f.start();
    const ledger = new Ledger(f.ctx.storage);
    for (let cycle = 0; cycle < 2; cycle++) {
      await f.verify(1);
      await f.invoke('aorchestra_task', { operation: 'recover' });
      const before = await ledger.read('primary');
      expect(before.tasks[0].workflow!.repairRequired).toBe(true);
      expect(before.tasks[0].workflow!.repairs).toBe(cycle);
      const cleanup = await plugin.setup(f.ctx);
      try {
        await f.invoke('aorchestra_task', { operation: 'resume', taskId: 'api' });
        expect(await ledger.read('primary')).toEqual(before);
        await expect(f.start()).rejects.toThrow('BEGIN_REPAIR_BEFORE_RESTART');
        await expect(
          f.invoke('aorchestra_task', { operation: 'plan', taskId: 'api' }),
        ).rejects.toThrow('BEGIN_REPAIR_BEFORE_RESTART');
        await expect(
          f.invoke('aorchestra_delegate', {
            taskId: 'api',
            model: 'fast',
            tools: ['read'],
            routingEvidence: 'Retry known-file inspection',
            delta: 'Observed failing verifier',
          }),
        ).rejects.toThrow('BEGIN_REPAIR_BEFORE_RESTART');
        await f.invoke('aorchestra_task', {
          operation: 'repair',
          taskId: 'api',
          reason: `Observed failure ${cycle + 1}`,
        });
        const task = (await ledger.read('primary')).tasks[0];
        expect(task.workflow!.repairs).toBe(cycle + 1);
        expect(task.workflow!.repairRequired).toBeUndefined();
      } finally {
        if (cleanup) await cleanup();
      }
    }
    await f.verify(1);
    await f.invoke('aorchestra_task', { operation: 'recover' });
    await expect(f.start()).rejects.toThrow('REPAIR_BUDGET_EXCEEDED');
    const exhausted = JSON.parse(
      (
        await f.invoke('aorchestra_task', {
          operation: 'repair',
          taskId: 'api',
          reason: 'Third failure',
        })
      ).content,
    ).tasks[0];
    expect(exhausted.status).toBe('blocked');
    expect(exhausted.workflow.repairs).toBe(2);
    await f.invoke('aorchestra_task', {
      operation: 'invalidate',
      taskId: 'api',
      reason: 'Reinspect assumptions',
    });
    expect((await ledger.read('primary')).tasks[0].workflow!.repairRequired).toBe(true);
    await expect(f.start()).rejects.toThrow('REPAIR_BUDGET_EXCEEDED');
    expect(f.creations).toHaveLength(0);
  } finally {
    await f.clean();
  }
});

test('invalidation cannot discard a pending repair obligation before the budget is exhausted', async () => {
  const f = await fixture();
  try {
    await f.register();
    await f.start();
    await f.verify(1);
    await f.invoke('aorchestra_task', {
      operation: 'invalidate',
      taskId: 'api',
      reason: 'Refresh the plan after failure',
    });
    await expect(f.start()).rejects.toThrow('BEGIN_REPAIR_BEFORE_RESTART');
    await expect(
      f.invoke('aorchestra_delegate', {
        taskId: 'api',
        model: 'fast',
        tools: ['read'],
        routingEvidence: 'Retry lookup',
      }),
    ).rejects.toThrow('BEGIN_REPAIR_BEFORE_RESTART');
    await f.invoke('aorchestra_task', {
      operation: 'repair',
      taskId: 'api',
      reason: 'Reinspect failed contract with a new baseline',
    });
    await f.verify();
    await f.accept();
    const repaired = (await new Ledger(f.ctx.storage).read('primary')).tasks[0];
    expect(repaired.workflow!.repairs).toBe(1);
    expect(repaired.status).toBe('complete');
  } finally {
    await f.clean();
  }
});

test('bounded direct repairs protect edit permissions and cannot restart or invalidate away exhaustion', async () => {
  const f = await fixture({ maxRepairs: 2 });
  try {
    await f.register();
    await f.start();
    await f.verify(1);
    const edit = {
      agent: 'aorchestra',
      sessionID: 'primary',
      action: 'edit',
      resources: ['api.ts'],
      effect: 'allow',
    };
    await f.hooks.get('permission:evaluate')!(edit);
    expect(edit.effect).toBe('deny');
    for (let cycle = 0; cycle < 2; cycle++) {
      await f.invoke('aorchestra_task', {
        operation: 'repair',
        taskId: 'api',
        reason: `Observed failure ${cycle + 1}`,
      });
      const allowed = { ...edit, effect: 'allow' };
      await f.hooks.get('permission:evaluate')!(allowed);
      expect(allowed.effect).toBe('allow');
      await f.verify(1);
    }
    const blocked = JSON.parse(
      (
        await f.invoke('aorchestra_task', {
          operation: 'repair',
          taskId: 'api',
          reason: 'Third failure',
        })
      ).content,
    ).tasks[0];
    expect(blocked.status).toBe('blocked');
    expect(blocked.workflow.repairs).toBe(2);
    await expect(f.start()).rejects.toThrow('REPAIR_BUDGET_EXCEEDED');
    await f.invoke('aorchestra_task', {
      operation: 'invalidate',
      taskId: 'api',
      reason: 'Reinspect assumptions',
    });
    await expect(f.start()).rejects.toThrow('REPAIR_BUDGET_EXCEEDED');
  } finally {
    await f.clean();
  }
});

test('resume after plugin restart preserves baseline, events, budgets and pending configured native checks', async () => {
  const check = {
    id: 'configured',
    tool: 'shell',
    input: { command: 'node integration.test.js' },
    expect: { exitCode: 0 },
  };
  const f = await fixture({ verification: [{ paths: ['api.ts'], verifiers: [check] }] });
  try {
    await f.register();
    await f.start();
    await f.invoke('aorchestra_task', { operation: 'verify', taskId: 'api' });
    const before = await new Ledger(f.ctx.storage).read('primary');
    const cleanup = await plugin.setup(f.ctx);
    try {
      const resumed = JSON.parse(
        (await f.invoke('aorchestra_task', { operation: 'resume', taskId: 'api' })).content,
      );
      expect(resumed.tasks[0].pendingVerifiers.map((v: any) => v.input.command)).toEqual([
        'bun test api.test.ts',
        'node integration.test.js',
      ]);
      expect(await new Ledger(f.ctx.storage).read('primary')).toEqual(before);
      expect(f.creations).toHaveLength(0);
      const system: any[] = [];
      await f.hooks.get('session:context')!({
        agent: 'aorchestra',
        sessionID: 'primary',
        model: { providerID: 'test', id: 'main' },
        tools: { shell: {} },
        options: {},
        system,
      });
      expect(system[0].text).toContain('node integration.test.js');
      expect((await new Ledger(f.ctx.storage).read('primary')).delegations).toBe(0);
    } finally {
      if (cleanup) await cleanup();
    }
  } finally {
    await f.clean();
  }
});

test('failed or unverifiable reruns revoke accepted work and survive restart without restoring evidence', async () => {
  for (const missingExit of [false, true]) {
    const f = await fixture();
    try {
      await f.register();
      await f.start();
      await f.verify();
      await f.accept();
      const ledger = new Ledger(f.ctx.storage);
      const before = (await ledger.read('primary')).tasks[0];
      await f.verify(1, 'unrelated command');
      expect((await ledger.read('primary')).tasks[0].status).toBe('complete');
      await f.verify();
      expect((await ledger.read('primary')).tasks[0].receipts).toEqual(before.receipts);
      if (missingExit)
        await f.runTool({
          tool: 'shell',
          agent: 'aorchestra',
          sessionID: 'primary',
          id: 'missing-exit',
          input: { command: 'bun test api.test.ts' },
          status: 'completed',
          result: { metadata: {} },
        });
      else await f.verify(1);
      const revoked = (await ledger.read('primary')).tasks[0];
      expect(revoked.status).toBe('blocked');
      expect(revoked.workflow!.phase).toBe('blocked');
      expect(revoked.receipts).toEqual({});
      expect(revoked.compatibilityReview).toBeUndefined();
      expect(revoked.baseline).toBe(before.baseline!);
      expect(revoked.attempts).toEqual(before.attempts);
      expect(revoked.verification!.observations.tests.passed).toBe(false);
      const system: any[] = [];
      await f.hooks.get('session:context')!({
        agent: 'aorchestra',
        sessionID: 'primary',
        model: { providerID: 'test', id: 'main' },
        tools: { shell: {} },
        options: {},
        system,
      });
      expect(system[0].text).toContain('"phase":"blocked"');
      expect(system[0].text).toContain('Accepted evidence revoked');
      const cleanup = await plugin.setup(f.ctx);
      try {
        await f.invoke('aorchestra_task', { operation: 'resume', taskId: 'api' });
        await f.verify();
        expect((await ledger.read('primary')).tasks[0]).toEqual(revoked);
        await expect(f.start()).rejects.toThrow('BEGIN_REPAIR_BEFORE_RESTART');
        await f.invoke('aorchestra_task', {
          operation: 'repair',
          taskId: 'api',
          reason: 'Accepted verifier failed; recheck before acceptance',
        });
        await expect(f.accept()).rejects.toThrow('VERIFIER_MISSING_OR_STALE');
        await f.verify();
        await f.accept();
        expect((await ledger.read('primary')).tasks[0].status).toBe('complete');
      } finally {
        if (cleanup) await cleanup();
      }
    } finally {
      await f.clean();
    }
  }
});

test('accepted evidence revocation blocks transitive dependents and stops active native children', async () => {
  const f = await fixture();
  try {
    await f.register();
    await f.start();
    await f.verify();
    await f.accept();
    for (const [id, dependsOn] of [
      ['consumer', ['api']],
      ['downstream', ['consumer']],
    ] as const) {
      await f.invoke('aorchestra_task', {
        operation: 'register',
        task: {
          id,
          kind: 'analysis',
          instruction: 'Inspect consumers',
          context: '',
          dependsOn: [...dependsOn],
          writePaths: [],
          preserve: [],
          verifiers: [
            {
              id: 'read',
              tool: 'read',
              input: { filePath: 'api.ts' },
              expect: { contains: 'oldApi' },
            },
          ],
        },
      });
    }
    const ledger = new Ledger(f.ctx.storage);
    await ledger.mutate('primary', (state) => {
      state.delegations = 2;
      const consumer = state.tasks[1];
      consumer.status = 'complete';
      consumer.workflow!.phase = 'complete';
      consumer.compatibilityReview = 'Reviewed';
      consumer.baseline = state.tasks[0].baseline;
      consumer.workflow!.repairs = 1;
      consumer.receipts = { read: state.tasks[0].receipts.tests };
      const downstream = state.tasks[2];
      downstream.status = 'running';
      downstream.workflow!.phase = 'execute';
      downstream.baseline = state.tasks[0].baseline;
      downstream.workflow!.repairs = 2;
      downstream.attempts.push({
        tier: 'balanced',
        reason: 'Independent check',
        delta: '',
        child: 'active-child',
        status: 'running',
        startedAt: 1,
      });
    });
    await f.ctx.storage.set('child/active-child', {
      owner: 'primary',
      taskId: 'downstream',
      root: f.root,
      tools: ['read'],
      writePaths: [],
      kind: 'analysis',
      active: true,
    });
    await f.verify(1);
    const state = await ledger.read('primary');
    expect(state.tasks.map((t) => t.status)).toEqual(['blocked', 'blocked', 'blocked']);
    expect(state.tasks.map((t) => t.receipts)).toEqual([{}, {}, {}]);
    expect(state.tasks.map((t) => t.compatibilityReview)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(state.tasks.map((t) => t.workflow!.repairs)).toEqual([0, 1, 2]);
    expect(state.delegations).toBe(2);
    expect(state.tasks[2].attempts[0].status).toBe('error');
    expect(state.tasks[2].baseline).toBe(state.tasks[0].baseline!);
    expect(f.interruptions).toEqual([{ sessionID: 'active-child', resume: false }]);
    expect(((await f.ctx.storage.get('child/active-child')) as any).active).toBe(false);
    await expect(
      f.invoke('aorchestra_task', { operation: 'start', taskId: 'consumer' }),
    ).rejects.toThrow('DEPENDENCY_UNMET');
    await expect(
      f.hooks.get('tool:execute.before')!({
        agent: 'aorchestra-executor',
        sessionID: 'active-child',
        tool: 'read',
      }),
    ).rejects.toThrow('WORKER_TOOL_DENIED');
  } finally {
    await f.clean();
  }
});

test('a late native child result cannot restore review after dependency evidence was revoked', async () => {
  const f = await fixture();
  let release = () => {};
  try {
    await f.register();
    await f.start();
    await f.verify();
    await f.accept();
    await f.invoke('aorchestra_task', {
      operation: 'register',
      task: {
        id: 'consumer',
        kind: 'analysis',
        instruction: 'Inspect consumers',
        context: '',
        handoff: {
          sources: [{ ref: 'api.ts', status: 'observed', revision: 'unknown' }],
          facts: [],
          unknowns: [],
          checks: [],
        },
        dependsOn: ['api'],
        writePaths: [],
        preserve: [],
        verifiers: [
          {
            id: 'read',
            tool: 'read',
            input: { filePath: 'api.ts' },
            expect: { contains: 'oldApi' },
          },
        ],
      },
    });
    let waiting = () => {};
    const entered = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.ctx.session.wait = async () => {
      waiting();
      await gate;
    };
    const delegated = f
      .invoke('aorchestra_delegate', {
        taskId: 'consumer',
        model: 'balanced',
        tools: ['read'],
        routingEvidence: 'Bounded consumer analysis',
      })
      .catch((error: Error) => error);
    await entered;
    await f.verify(1);
    const before = await new Ledger(f.ctx.storage).read('primary');
    release();
    const result = await delegated;
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('DELEGATION_REVOKED');
    const after = await new Ledger(f.ctx.storage).read('primary');
    expect(after.tasks).toEqual(before.tasks);
    expect(after.delegations).toBe(before.delegations);
    expect(((await f.ctx.storage.get('child/child-1')) as any).active).toBe(false);
  } finally {
    release();
    await f.clean();
  }
});

test('bundled improvement skill is explicit-only and unrelated agents cannot invoke it', async () => {
  const f = await fixture();
  try {
    const skill = f.skills.find((s) => s.id === 'aorchestra-improve');
    expect(skill.autoinvoke).toBe(false);
    expect(skill.path).toContain('improve');
    expect(skill.content.startsWith('---')).toBe(false);
    for (const agent of ['build', 'plan', 'research', 'custom-agent']) {
      const permission = {
        agent,
        sessionID: 'other',
        action: 'skill',
        resources: ['aorchestra-improve'],
        effect: 'allow',
      };
      await f.hooks.get('permission:evaluate')!(permission);
      expect(permission.effect).toBe('deny');
    }
    const permission = {
      agent: 'aorchestra',
      sessionID: 'primary',
      action: 'skill',
      resources: ['aorchestra-improve'],
      effect: 'allow',
    };
    await f.hooks.get('permission:evaluate')!(permission);
    expect(permission.effect).toBe('allow');
  } finally {
    await f.clean();
  }
});

const analysisTask = (
  f: Awaited<ReturnType<typeof fixture>>,
  id: string,
  dependsOn: string[] = [],
) => ({ ...f.task, id, kind: 'analysis', writePaths: [], analysisMode: 'lookup', dependsOn });
const delegateItem = (taskId: string) => ({
  taskId,
  model: 'balanced',
  tools: ['read'],
  routingEvidence: 'Independent bounded investigation',
});
async function registerAnalyses(
  f: Awaited<ReturnType<typeof fixture>>,
  ids = ['a', 'b', 'c', 'd'],
) {
  for (const id of ids)
    await f.invoke('aorchestra_task', { operation: 'register', task: analysisTask(f, id) });
}

test('group analyses overlap at capacity, retain individual review and accept while peers run', async () => {
  const f = await fixture({ maxConcurrentAnalyses: 3 });
  const gates = new Map<string, () => void>();
  let allEntered = () => {};
  try {
    await registerAnalyses(f);
    const entered = new Promise<void>((resolve) => {
      allEntered = resolve;
    });
    f.ctx.session.wait = async ({ sessionID }) =>
      new Promise<void>((resolve) => {
        gates.set(sessionID, resolve);
        if (gates.size === 3) allEntered();
      });
    const group = f.invoke('aorchestra_delegate', { tasks: ['a', 'b', 'c'].map(delegateItem) });
    await entered;
    expect(f.prompts).toHaveLength(3);
    const sourceSnapshot = fingerprint(await snapshot(f.root));
    for (const prompt of f.prompts) {
      expect(prompt.text).toContain(
        `SOURCE SNAPSHOT AT DELEGATION (not a Git revision)\n${sourceSnapshot}`,
      );
      expect(prompt.text).toContain(JSON.stringify(f.task.handoff));
      expect(prompt.text).toContain(
        'Return STATUS, RESULT, EVIDENCE, CHANGED, OPEN exactly once as FIELD: value lines.',
      );
      expect(prompt.text).toContain('STATUS: COMPLETE, PARTIAL or BLOCKED');
      expect(prompt.text).toContain(
        'COMPLETE requires evidence for the entire supplied outcome and OPEN: none',
      );
      expect(prompt.text).toContain(
        'unavailable primary validation remains OPEN and means PARTIAL',
      );
      expect(prompt.text).toContain('Your report does not accept the task');
    }
    const ledger = new Ledger(f.ctx.storage);
    expect((await ledger.read('primary')).tasks.map((t) => t.status)).toEqual([
      'running',
      'running',
      'running',
      'pending',
    ]);
    await expect(f.invoke('aorchestra_delegate', delegateItem('d'))).rejects.toThrow(
      'ANALYSIS_CONCURRENCY_EXCEEDED',
    );
    await expect(f.invoke('aorchestra_task', { operation: 'start', taskId: 'd' })).rejects.toThrow(
      'ANALYSIS_CONCURRENCY_EXCEEDED',
    );
    await f.invoke('aorchestra_task', { operation: 'plan', taskId: 'd' });
    const permission = {
      agent: 'aorchestra',
      sessionID: 'primary',
      action: 'edit',
      resources: ['api.ts'],
      effect: 'allow',
    };
    await f.hooks.get('permission:evaluate')!(permission);
    expect(permission.effect).toBe('deny');
    await expect(f.invoke('aorchestra_delegate', delegateItem('a'))).rejects.toThrow(
      'ATTEMPT_RUNNING',
    );
    await f.verify();
    gates.get('child-1')!();
    // Wait for the first child's lifecycle to finish without finishing siblings.
    for (let i = 0; i < 100 && (await ledger.read('primary')).tasks[0].status === 'running'; i++)
      await new Promise((resolve) => setTimeout(resolve, 1));
    await f.invoke('aorchestra_task', {
      operation: 'accept',
      taskId: 'a',
      compatibilityReview: 'Reviewed independent analysis',
    });
    expect((await ledger.read('primary')).tasks.map((t) => t.status)).toEqual([
      'complete',
      'running',
      'running',
      'pending',
    ]);
    await f.invoke('aorchestra_task', { operation: 'start', taskId: 'd' });
    gates.get('child-2')!();
    gates.get('child-3')!();
    const results = JSON.parse((await group).content).results;
    expect(results.map((r: any) => r.metadata.taskId)).toEqual(['a', 'b', 'c']);
    expect(results.every((r: any) => r.metadata.accepted === false)).toBe(true);
    expect((await ledger.read('primary')).delegations).toBe(3);
  } finally {
    for (const release of gates.values()) release();
    await f.clean();
  }
});

test('group admission rejects every invalid member atomically without children or budget', async () => {
  for (const scenario of [
    'duplicate',
    'kind',
    'tools',
    'handoff',
    'retry',
    'budget',
    'capacity',
    'dependency',
    'mixed',
    'attempts',
    'downgrade',
  ]) {
    const f = await fixture(
      scenario === 'budget'
        ? { maxDelegations: 1, maxConcurrentAnalyses: 3 }
        : scenario === 'capacity'
          ? { maxConcurrentAnalyses: 1 }
          : { maxConcurrentAnalyses: 3, maxAttempts: 2 },
    );
    try {
      await registerAnalyses(f, ['a', 'b']);
      const ledger = new Ledger(f.ctx.storage);
      const inputs: any[] = ['a', 'b'].map(delegateItem);
      if (scenario === 'duplicate') inputs[1].taskId = 'a';
      if (scenario === 'kind')
        await ledger.mutate('primary', (s) => {
          s.tasks[1].kind = 'verification';
        });
      if (scenario === 'tools') inputs[1].tools = ['missing'];
      if (scenario === 'handoff')
        inputs[1].handoff = { sources: [], facts: [], unknowns: [], checks: [] };
      if (scenario === 'dependency')
        await ledger.mutate('primary', (s) => {
          s.tasks[1].dependsOn = ['a'];
        });
      if (scenario === 'retry')
        await ledger.mutate('primary', (s) => {
          s.tasks[1].attempts.push({
            tier: 'balanced',
            reason: 'first',
            delta: '',
            status: 'error',
            startedAt: 1,
          });
        });
      if (scenario === 'attempts')
        await ledger.mutate('primary', (s) => {
          s.tasks[1].attempts = Array.from({ length: 2 }, () => ({
            tier: 'balanced' as const,
            reason: 'prior',
            delta: 'observed',
            status: 'error' as const,
            startedAt: 1,
          }));
          inputs[1].delta = 'New evidence';
        });
      if (scenario === 'downgrade')
        await ledger.mutate('primary', (s) => {
          s.tasks[1].attempts.push({
            tier: 'strong',
            reason: 'prior',
            delta: '',
            status: 'error',
            startedAt: 1,
          });
          inputs[1].delta = 'New evidence';
        });
      const before = await ledger.read('primary');
      await expect(
        f.invoke('aorchestra_delegate', {
          tasks: inputs,
          ...(scenario === 'mixed' ? delegateItem('a') : {}),
        }),
      ).rejects.toThrow();
      expect(await ledger.read('primary')).toEqual(before);
      expect(f.creations).toHaveLength(0);
    } finally {
      await f.clean();
    }
  }
});

test('exclusive tasks block analyses in both directions through review regardless of write scope', async () => {
  for (const kind of ['change', 'verification'])
    for (const active of ['analysis', 'exclusive'])
      for (const status of ['running', 'review']) {
        const f = await fixture({ maxConcurrentAnalyses: 3 });
        try {
          await registerAnalyses(f, ['a']);
          await f.invoke('aorchestra_task', {
            operation: 'register',
            task: {
              ...f.task,
              id: 'exclusive',
              kind,
              writePaths: kind === 'change' ? ['elsewhere.ts'] : [],
            },
          });
          const first = active === 'analysis' ? 'a' : 'exclusive',
            next = active === 'analysis' ? 'exclusive' : 'a';
          await f.invoke('aorchestra_task', { operation: 'start', taskId: first });
          if (status === 'review')
            await new Ledger(f.ctx.storage).mutate('primary', (s) => {
              s.tasks.find((t) => t.id === first)!.status = 'review';
            });
          await expect(
            f.invoke('aorchestra_task', { operation: 'start', taskId: next }),
          ).rejects.toThrow('ACTIVE_TASK_EXISTS');
          await expect(f.invoke('aorchestra_delegate', delegateItem(next))).rejects.toThrow(
            'ACTIVE_TASK_EXISTS',
          );
        } finally {
          await f.clean();
        }
      }
});

test('review releases analysis slots and repair consumes one without resetting its budget on rejection', async () => {
  const f = await fixture({ maxConcurrentAnalyses: 1 });
  try {
    await registerAnalyses(f, ['a', 'b']);
    await f.invoke('aorchestra_delegate', delegateItem('a'));
    await f.invoke('aorchestra_task', { operation: 'start', taskId: 'b' });
    await f.verify(1);
    const ledger = new Ledger(f.ctx.storage),
      before = await ledger.read('primary');
    await expect(
      f.invoke('aorchestra_task', { operation: 'repair', taskId: 'a', reason: 'Observed failure' }),
    ).rejects.toThrow('ANALYSIS_CONCURRENCY_EXCEEDED');
    expect(await ledger.read('primary')).toEqual(before);
    await f.invoke('aorchestra_task', {
      operation: 'invalidate',
      taskId: 'b',
      reason: 'Release DIRECT execution',
    });
    await f.invoke('aorchestra_task', {
      operation: 'repair',
      taskId: 'a',
      reason: 'Observed failure',
    });
    expect((await ledger.read('primary')).tasks[0].workflow!.repairs).toBe(1);
  } finally {
    await f.clean();
  }
});

test('group child failure preserves sibling results and releases slots', async () => {
  const f = await fixture({ maxConcurrentAnalyses: 3 });
  try {
    await registerAnalyses(f, ['a', 'b', 'c']);
    await f.hooks.get('session:context')!({
      agent: 'aorchestra',
      sessionID: 'primary',
      model: { providerID: 'test', id: 'main' },
      tools: {},
      options: {},
      system: [],
    });
    f.ctx.session.wait = async ({ sessionID }) => {
      if (sessionID === 'child-1') throw new Error('controlled child failure');
    };
    const results = JSON.parse(
      (await f.invoke('aorchestra_delegate', { tasks: ['a', 'b'].map(delegateItem) })).content,
    ).results;
    expect(results[0].error).toBe('controlled child failure');
    expect(results[0].metadata.childSessionID).toBe('child-1');
    expect(results[1].metadata.workerStatus).toBe('PARTIAL');
    const rows = (await f.rpc.get('aorchestra.metrics').list({})).runs;
    expect(rows[0].children.map((child: any) => child.taskID).sort()).toEqual(['a', 'b']);
    expect(rows[0].children.every((child: any) => child.usage.cost === 0.01)).toBe(true);
    const state = await new Ledger(f.ctx.storage).read('primary');
    expect(state.tasks.map((t) => t.status)).toEqual(['blocked', 'review', 'pending']);
    await f.invoke('aorchestra_task', { operation: 'start', taskId: 'c' });
    expect(((await f.ctx.storage.get('child/child-1')) as any).active).toBe(false);
    expect(((await f.ctx.storage.get('child/child-2')) as any).active).toBe(false);
  } finally {
    await f.clean();
  }
});

test('oversized worker report blocks only its task while a normalized sibling awaits verification', async () => {
  const f = await fixture({ maxConcurrentAnalyses: 2 });
  try {
    await registerAnalyses(f, ['a', 'b']);
    const context = f.ctx.session.context;
    f.ctx.session.context = async (input, request) => {
      const messages = await context(input, request);
      for (const message of messages)
        if (message.type === 'assistant')
          message.content = [
            {
              type: 'text',
              text:
                input.sessionID === 'child-1'
                  ? `STATUS: PARTIAL\nRESULT: ${'x'.repeat(16000)}\nEVIDENCE: api.ts\nCHANGED: none\nOPEN: primary validation`
                  : 'debug trace\nOPEN: primary validation\nSTATUS: PARTIAL\nRESULT: investigated\nEVIDENCE: api.ts\nCHANGED: none\nextra text',
            },
          ];
      return messages;
    };
    const results = JSON.parse(
      (await f.invoke('aorchestra_delegate', { tasks: ['a', 'b'].map(delegateItem) })).content,
    ).results;
    expect(results[0].error).toBe('WORKER_REPORT_TOO_LARGE');
    expect(results[0].content).toBe('');
    expect(results[1].content).toBe(
      'STATUS: PARTIAL\nRESULT: investigated\nEVIDENCE: api.ts\nCHANGED: none\nOPEN: primary validation',
    );
    expect(results[1].metadata).toMatchObject({
      childSessionID: 'child-2',
      workerStatus: 'PARTIAL',
      accepted: false,
    });
    const state = await new Ledger(f.ctx.storage).read('primary');
    expect(state.tasks.map((t) => t.status)).toEqual(['blocked', 'review']);
    expect(f.creations).toHaveLength(2);
    await expect(
      f.invoke('aorchestra_task', {
        operation: 'accept',
        taskId: 'b',
        compatibilityReview: 'Still requires native checks',
      }),
    ).rejects.toThrow('VERIFIER_MISSING_OR_STALE');
  } finally {
    await f.clean();
  }
});

test('group parent cancellation and child timeouts interrupt every outstanding child', async () => {
  for (const timeout of [false, true]) {
    const f = await fixture({ maxConcurrentAnalyses: 3, ...(timeout ? { timeoutMs: 20 } : {}) });
    const abort = new AbortController();
    let entered = () => {};
    try {
      await registerAnalyses(f, ['a', 'b']);
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let count = 0;
      f.ctx.session.wait = async () => {
        if (++count === 2) entered();
        await new Promise(() => {});
      };
      const group = f.tools.get('aorchestra_delegate').execute(
        { tasks: ['a', 'b'].map(delegateItem) },
        {
          sessionID: 'primary',
          agent: 'aorchestra',
          signal: abort.signal,
          progress: async () => {},
        },
      );
      await waiting;
      if (!timeout) abort.abort(new Error('parent cancelled'));
      const results = JSON.parse((await group).content).results;
      expect(
        results.every(
          (r: any) => r.error === (timeout ? 'DELEGATION_TIMEOUT' : 'parent cancelled'),
        ),
      ).toBe(true);
      expect(f.interruptions.map((i) => i.sessionID).sort()).toEqual(['child-1', 'child-2']);
      expect((await new Ledger(f.ctx.storage).read('primary')).tasks.map((t) => t.status)).toEqual([
        'blocked',
        'blocked',
      ]);
    } finally {
      await f.clean();
    }
  }
});

test('analysis concurrency option requires a positive integer', async () => {
  for (const value of [0, -1, 1.5, '3', false])
    await expect(fixture({ maxConcurrentAnalyses: value })).rejects.toThrow(
      'INVALID_OPTION: maxConcurrentAnalyses',
    );
});

test('concurrent child evidence stays scoped and shared primary evidence respects each epoch', async () => {
  const f = await fixture({ maxConcurrentAnalyses: 3 });
  try {
    for (const id of ['a', 'b'])
      await f.invoke('aorchestra_task', {
        operation: 'register',
        task: {
          ...analysisTask(f, id),
          verifiers: [
            {
              id: 'read',
              tool: 'read',
              input: { filePath: 'api.ts' },
              expect: { contains: 'oldApi' },
            },
          ],
        },
      });
    await f.invoke('aorchestra_delegate', { tasks: ['a', 'b'].map(delegateItem) });
    const ledger = new Ledger(f.ctx.storage);
    // Reactivate a controlled child to exercise the native hooks for its contract.
    await f.ctx.storage.set('child/child-1', {
      ...((await f.ctx.storage.get('child/child-1')) as object),
      active: true,
    });
    const event = {
      tool: 'read',
      agent: 'aorchestra-executor',
      sessionID: 'child-1',
      id: 'child-evidence',
      input: { filePath: 'api.ts' },
      status: 'completed',
      result: { output: 'oldApi' },
    };
    await f.runTool(event);
    const scoped = await ledger.read('primary');
    expect(Object.keys(scoped.tasks[0].receipts)).toEqual(['read']);
    expect(scoped.tasks[1].receipts).toEqual({});
    const primary = { ...event, agent: 'aorchestra', sessionID: 'primary', id: 'primary-evidence' };
    await f.hooks.get('tool:execute.before')!(primary);
    await f.invoke('aorchestra_task', {
      operation: 'repair',
      taskId: 'b',
      reason: 'Refresh evidence in this task only',
    });
    await f.hooks.get('tool:execute.after')!(primary);
    expect((await ledger.read('primary')).tasks[1].receipts).toEqual({});
    await f.runTool({ ...primary, id: 'fresh-primary' });
    for (const id of ['a', 'b'])
      await f.invoke('aorchestra_task', {
        operation: 'accept',
        taskId: id,
        compatibilityReview: 'Independent read-only contract reviewed',
      });
    await writeFile(join(f.root, 'api.ts'), 'external mutation');
    await f.runTool({ ...primary, id: 'external-mutation', result: { output: 'oldApi' } });
    expect((await ledger.read('primary')).tasks.map((t) => t.status)).toEqual([
      'complete',
      'complete',
    ]);
    // Existing acceptance is revoked on failed rerun; source changes block fresh acceptance.
    await f.runTool({ ...primary, id: 'failed-rerun', result: { output: 'missing' } });
    expect((await ledger.read('primary')).tasks.map((t) => t.status)).toEqual([
      'blocked',
      'blocked',
    ]);
  } finally {
    await f.clean();
  }
});

test('owner recovery interrupts concurrent attempts and late callbacks preserve ledger and telemetry', async () => {
  for (const mode of ['recover', 'switch', 'restart']) {
    const f = await fixture({ maxConcurrentAnalyses: 3 });
    let release = () => {};
    let entered = () => {};
    let cleanup: void | (() => void) = undefined;
    try {
      await registerAnalyses(f, ['a', 'b']);
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let count = 0;
      f.ctx.session.wait = async () => {
        if (++count === 2) entered();
        await gate;
      };
      const group = f.invoke('aorchestra_delegate', { tasks: ['a', 'b'].map(delegateItem) });
      await waiting;
      if (mode === 'restart') cleanup = await plugin.setup(f.ctx);
      if (mode === 'switch') {
        f.switchAgent('build');
        await f.hooks.get('session:context')!({ agent: 'build', sessionID: 'primary', tools: {} });
      } else await f.invoke('aorchestra_task', { operation: 'recover' });
      const ledger = new Ledger(f.ctx.storage),
        before = await ledger.read('primary');
      expect(before.tasks.map((t) => t.status)).toEqual(['blocked', 'blocked']);
      expect(f.interruptions.map((i) => i.sessionID).sort()).toEqual(['child-1', 'child-2']);
      release();
      const results = JSON.parse((await group).content).results;
      expect(results.every((r: any) => Boolean(r.error))).toBe(true);
      expect((await ledger.read('primary')).tasks).toEqual(before.tasks);
      expect((await ledger.read('primary')).delegations).toBe(2);
      for (const id of ['child-1', 'child-2'])
        expect(((await f.ctx.storage.get(`child/${id}`)) as any).active).toBe(false);
    } finally {
      release();
      if (cleanup) cleanup();
      await f.clean();
    }
  }
});

test('recovery settles every child and blocks late results despite native or storage failures', async () => {
  for (const failure of ['interrupt', 'contract']) {
    const f = await fixture({ maxConcurrentAnalyses: 3 });
    let release = () => {};
    let entered = () => {};
    try {
      await registerAnalyses(f, ['a', 'b']);
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let count = 0;
      f.ctx.session.wait = async () => {
        if (++count === 2) entered();
        await gate;
      };
      const group = f.invoke('aorchestra_delegate', { tasks: ['a', 'b'].map(delegateItem) });
      await waiting;
      const ledger = new Ledger(f.ctx.storage);
      const storage = f.ctx.storage as { set(key: string, value: unknown): Promise<void> };
      const originalSet = storage.set.bind(storage);
      if (failure === 'contract')
        storage.set = async (key, value) => {
          if (key === 'child/child-1') throw new Error('Controlled contract storage failure');
          return originalSet(key, value);
        };
      const originalInterrupt = f.ctx.session.interrupt.bind(f.ctx.session);
      f.ctx.session.interrupt = async (input) => {
        const result = await originalInterrupt(input);
        // Ownership must already be revoked before a native interruption can
        // wake the delegation's completion callback.
        expect((await ledger.read('primary')).tasks.map((task) => task.status)).toEqual([
          'blocked',
          'blocked',
        ]);
        if (failure === 'interrupt' && input.sessionID === 'child-1')
          throw new Error('Controlled interruption failure');
        return result;
      };
      await expect(f.invoke('aorchestra_task', { operation: 'recover' })).rejects.toThrow(
        'RECOVERY_INCOMPLETE',
      );
      expect(f.interruptions.map((input) => input.sessionID).sort()).toEqual([
        'child-1',
        'child-2',
      ]);
      const recovered = await ledger.read('primary');
      expect(recovered.tasks.every((task) => task.attempts[0].status === 'error')).toBe(true);
      expect(((await f.ctx.storage.get('child/child-2')) as any).active).toBe(false);
      if (failure === 'interrupt') {
        expect(((await f.ctx.storage.get('child/child-1')) as any).active).toBe(false);
        await expect(
          f.hooks.get('tool:execute.before')!({
            agent: 'aorchestra-executor',
            sessionID: 'child-1',
            tool: 'read',
            id: 'late-read',
            input: { filePath: 'api.ts' },
          }),
        ).rejects.toThrow('WORKER_TOOL_DENIED');
      }
      storage.set = originalSet;
      release();
      const results = JSON.parse((await group).content).results;
      expect(results.every((result: any) => Boolean(result.error))).toBe(true);
      expect((await ledger.read('primary')).tasks).toEqual(recovered.tasks);
      for (const child of ['child-1', 'child-2'])
        expect(((await f.ctx.storage.get(`child/${child}`)) as any).active).toBe(false);
    } finally {
      release();
      await f.clean();
    }
  }
});

test('external source mutation prevents each concurrent analysis acceptance even with fresh checks', async () => {
  const f = await fixture({ maxConcurrentAnalyses: 3 });
  try {
    await registerAnalyses(f, ['a', 'b']);
    await f.invoke('aorchestra_delegate', { tasks: ['a', 'b'].map(delegateItem) });
    await writeFile(join(f.root, 'api.ts'), 'external mutation');
    for (const id of ['a', 'b'])
      await expect(
        f.invoke('aorchestra_task', {
          operation: 'accept',
          taskId: id,
          compatibilityReview: 'Reviewed',
        }),
      ).rejects.toThrow('VERIFIER_MISSING_OR_STALE');
    await f.verify();
    for (const id of ['a', 'b'])
      await expect(
        f.invoke('aorchestra_task', {
          operation: 'accept',
          taskId: id,
          compatibilityReview: 'Reviewed',
        }),
      ).rejects.toThrow('WRITE_SCOPE_VIOLATION');
    expect((await new Ledger(f.ctx.storage).read('primary')).tasks.map((t) => t.status)).toEqual([
      'review',
      'review',
    ]);
  } finally {
    await f.clean();
  }
});

test('serial default rejects a group atomically and guides the next analysis to wait', async () => {
  const f = await fixture();
  try {
    await registerAnalyses(f, ['a', 'b']);
    const before = await new Ledger(f.ctx.storage).read('primary');
    await expect(
      f.invoke('aorchestra_delegate', { tasks: ['a', 'b'].map(delegateItem) }),
    ).rejects.toThrow('ANALYSIS_CONCURRENCY_EXCEEDED');
    expect(await new Ledger(f.ctx.storage).read('primary')).toEqual(before);
    expect(f.creations).toHaveLength(0);
    await f.invoke('aorchestra_task', { operation: 'start', taskId: 'a' });
    const state = JSON.parse(
      (await f.invoke('aorchestra_task', { operation: 'status', taskId: 'b' })).content,
    );
    expect(state.maxConcurrentAnalyses).toBe(1);
    expect(state.tasks[0].nextAction.reason).toContain('release a slot');
    expect(state.tasks[0].nextAction.command).toBeNull();
  } finally {
    await f.clean();
  }
});

test('failure guidance names the task and repair operation without spending repair budget', async () => {
  const f = await fixture();
  try {
    await f.register();
    await f.start();
    await f.verify(1);
    await expect(f.accept()).rejects.toThrow('taskId=api');
    await expect(f.accept()).rejects.toThrow('"operation":"repair"');
    const state = JSON.parse(
      (await f.invoke('aorchestra_task', { operation: 'resume', taskId: 'api' })).content,
    );
    expect(state.tasks[0].nextAction.command.input.operation).toBe('repair');
    expect(state.tasks[0].workflow.repairs).toBe(0);
    await f.invoke('aorchestra_task', {
      operation: 'repair',
      taskId: 'api',
      reason: 'Investigated failed assertion',
    });
    await f.verify();
    await f.accept();
    expect(
      JSON.parse((await f.invoke('aorchestra_task', { operation: 'status' })).content).tasks[0]
        .nextAction.command,
    ).toBeNull();
  } finally {
    await f.clean();
  }
});

test('status exposes measured and unknown budgets; primary and executor receive near-limit guidance', async () => {
  const f = await fixture({ maxSessionTokens: 100 });
  try {
    await f.register();
    await f.invoke('aorchestra_delegate', {
      taskId: 'api',
      model: 'fast',
      tools: ['read'],
      routingEvidence: 'Bounded lookup',
    });
    const saved = (await f.ctx.storage.get('child/child-1')) as Record<string, unknown>;
    await f.ctx.storage.set('child/child-1', { ...saved, active: true });
    const get = f.ctx.session.get;
    f.ctx.session.get = async (input) => ({
      ...(await get(input)),
      tokens: { input: 10, output: 5, reasoning: 20, cache: { read: 40, write: 5 } },
    });
    for (const agent of ['aorchestra', 'aorchestra-executor']) {
      const context = {
        agent,
        sessionID: agent === 'aorchestra' ? 'primary' : 'child-1',
        tools: { read: {} },
        options: {},
        system: [] as any[],
        model: { providerID: 'test', id: 'model' },
      };
      await f.hooks.get('session:context')!(context);
      expect(context.system.some((item) => item.text.includes('"remaining":20'))).toBe(true);
    }
    const measured = JSON.parse(
      (await f.invoke('aorchestra_task', { operation: 'status' })).content,
    ).tokenBudget;
    expect(measured).toEqual({
      limit: 100,
      consumed: 80,
      remaining: 20,
      nearLimit: true,
      warningTokens: 80,
    });
    f.ctx.session.get = async (input) => ({ ...(await get(input)), tokens: {} as any });
    expect(
      JSON.parse((await f.invoke('aorchestra_task', { operation: 'status' })).content).tokenBudget,
    ).toEqual({ limit: 100, consumed: null, remaining: null, nearLimit: null, warningTokens: 80 });
    f.ctx.session.get = async (input) => ({
      ...(await get(input)),
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    });
    expect(
      JSON.parse((await f.invoke('aorchestra_task', { operation: 'status' })).content).tokenBudget
        .consumed,
    ).toBe(0);
  } finally {
    await f.clean();
  }
});

test('snapshot diagnostics measure scans without caching freshness', async () => {
  const f = await fixture();
  try {
    await f.register();
    await f.start();
    await f.verify();
    const before = JSON.parse((await f.invoke('aorchestra_task', { operation: 'status' })).content);
    expect(before.tasks[0].pendingVerifiers).toHaveLength(0);
    await writeFile(join(f.root, 'api.ts'), 'external mutation');
    const after = JSON.parse((await f.invoke('aorchestra_task', { operation: 'resume' })).content);
    expect(after.tasks[0].pendingVerifiers).toHaveLength(1);
    expect(after.snapshotDiagnostics.scans).toBeGreaterThan(before.snapshotDiagnostics.scans);
    expect(after.snapshotDiagnostics.totalDurationMs).toBeGreaterThanOrEqual(
      before.snapshotDiagnostics.totalDurationMs,
    );
    expect(after.snapshotDiagnostics.lastFileCount).toBe(1);
    expect(after.snapshotDiagnostics.failures).toBe(0);
    expect(after.tasks[0].nextAction.command.input.operation).toBe('verify');
  } finally {
    await f.clean();
  }
});

test('guidance preserves dependency and exhausted-repair blocks across restart', async () => {
  const f = await fixture({ maxRepairs: 1 });
  let cleanup: void | (() => void);
  try {
    await f.register();
    await f.invoke('aorchestra_task', {
      operation: 'register',
      task: { ...f.task, id: 'dependent', dependsOn: ['api'] },
    });
    const dependent = JSON.parse(
      (await f.invoke('aorchestra_task', { operation: 'status', taskId: 'dependent' })).content,
    ).tasks[0];
    expect(dependent.nextAction.reason).toContain('Complete dependencies first: api');
    expect(dependent.nextAction.command).toBeNull();
    await f.start();
    await f.verify(1);
    await f.invoke('aorchestra_task', {
      operation: 'repair',
      taskId: 'api',
      reason: 'Investigated failing assertion',
    });
    await f.verify(1);
    const before = await new Ledger(f.ctx.storage).read('primary');
    cleanup = await plugin.setup(f.ctx);
    const resumed = JSON.parse(
      (await f.invoke('aorchestra_task', { operation: 'resume', taskId: 'api' })).content,
    );
    expect(resumed.tasks[0].nextAction.reason).toContain('Repair budget exhausted');
    expect(resumed.tasks[0].nextAction.command).toBeNull();
    expect(await new Ledger(f.ctx.storage).read('primary')).toEqual(before);
  } finally {
    if (cleanup!) await cleanup();
    await f.clean();
  }
});

test('historical usage never blocks dispatch by default or with a null limit', async () => {
  for (const options of [{}, { maxSessionTokens: null }]) {
    const f = await fixture(options);
    try {
      const get = f.ctx.session.get;
      for (const inputTokens of [290_000, 347_000, 10]) {
        f.ctx.session.get = async (input) => ({
          ...(await get(input)),
          tokens: { input: inputTokens, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        });
        const context = {
          agent: 'aorchestra',
          sessionID: 'primary',
          tools: { read: {} },
          options: {},
          system: [] as any[],
          model: { providerID: 'test', id: 'model' },
        };
        await f.hooks.get('session:context')!(context);
        const budget = JSON.parse(
          (await f.invoke('aorchestra_task', { operation: 'status' })).content,
        ).tokenBudget;
        expect(budget).toEqual({
          limit: null,
          consumed: inputTokens,
          remaining: null,
          nearLimit: inputTokens >= 300_000,
          warningTokens: 300_000,
        });
        expect(context.system.some((item) => item.text.includes('session usage is high'))).toBe(
          inputTokens >= 300_000,
        );
      }
      f.ctx.session.get = async (input) => ({ ...(await get(input)), tokens: {} as any });
      expect(
        JSON.parse((await f.invoke('aorchestra_task', { operation: 'status' })).content).tokenBudget
          .consumed,
      ).toBeNull();
    } finally {
      await f.clean();
    }
  }
});

test('usage options validate explicit limits and independent warning thresholds', async () => {
  for (const name of ['maxSessionTokens', 'sessionUsageWarningTokens']) {
    for (const value of [0, -1, 1.5, '300000', false]) {
      await expect(fixture({ [name]: value })).rejects.toThrow(`INVALID_OPTION: ${name}`);
    }
  }
  const f = await fixture({ sessionUsageWarningTokens: 10 });
  try {
    const context = {
      agent: 'aorchestra',
      sessionID: 'primary',
      tools: {},
      options: {},
      system: [] as any[],
      model: { providerID: 'test', id: 'model' },
    };
    await f.hooks.get('session:context')!(context);
    expect(context.system.some((item) => item.text.includes('session usage is high'))).toBe(true);
  } finally {
    await f.clean();
  }
});

test('two analysis slots overlap, deny writes and preserve a running sibling after failure', async () => {
  const f = await fixture({ maxConcurrentAnalyses: 2 });
  const gates = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  let entered = () => {};
  let failed = () => {};
  const bothEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const failureRecorded = new Promise<void>((resolve) => {
    failed = resolve;
  });
  try {
    await registerAnalyses(f, ['a', 'b', 'c']);
    await f.register();
    const storage = f.ctx.storage as { set(key: string, value: unknown): Promise<void> };
    const set = storage.set.bind(storage);
    storage.set = async (key, value) => {
      await set(key, value);
      if (key === 'child/child-1' && !(value as any).active) failed();
    };
    f.ctx.session.wait = async ({ sessionID }) =>
      new Promise<void>((resolve, reject) => {
        gates.set(sessionID, { resolve, reject });
        if (gates.size === 2) entered();
      });
    const group = f.invoke('aorchestra_delegate', { tasks: ['a', 'b'].map(delegateItem) });
    await bothEntered;
    expect(f.prompts).toHaveLength(2);
    await expect(f.invoke('aorchestra_delegate', delegateItem('c'))).rejects.toThrow(
      'ANALYSIS_CONCURRENCY_EXCEEDED',
    );
    await expect(f.start()).rejects.toThrow('ACTIVE_TASK_EXISTS');
    for (const sessionID of gates.keys()) {
      const permission = {
        agent: 'aorchestra-executor',
        sessionID,
        action: 'edit',
        resources: ['api.ts'],
        effect: 'allow',
      };
      await f.hooks.get('permission:evaluate')!(permission);
      expect(permission.effect).toBe('deny');
      await expect(
        f.hooks.get('tool:execute.before')!({
          agent: 'aorchestra-executor',
          sessionID,
          tool: 'patch',
          id: 'denied-write',
          input: {},
        }),
      ).rejects.toThrow('WORKER_TOOL_DENIED');
    }
    gates.get('child-1')!.reject(new Error('controlled child failure'));
    await failureRecorded;
    expect(
      (await new Ledger(f.ctx.storage).read('primary')).tasks
        .slice(0, 2)
        .map((task) => task.status),
    ).toEqual(['blocked', 'running']);
    expect(((await f.ctx.storage.get('child/child-2')) as any).active).toBe(true);
    gates.get('child-2')!.resolve();
    const results = JSON.parse((await group).content).results;
    expect(results[0].error).toBe('controlled child failure');
    expect(results[1].error).toBeUndefined();
    expect(
      (await new Ledger(f.ctx.storage).read('primary')).tasks
        .slice(0, 2)
        .map((task) => task.status),
    ).toEqual(['blocked', 'review']);
  } finally {
    for (const gate of gates.values()) gate.resolve();
    await f.clean();
  }
});

test('large JSON tool evidence leaves native truncation and cumulative dispatch budgets independent', async () => {
  const payload = JSON.stringify(
    Array.from({ length: 20000 }, (_, id) => ({ id, text: 'x'.repeat(64) })),
  );
  expect(Buffer.byteLength(payload)).toBeGreaterThan(1_000_000);
  for (const options of [{}, { maxSessionTokens: null }, { maxSessionTokens: 300000 }]) {
    const f = await fixture(options);
    try {
      const get = f.ctx.session.get;
      f.ctx.session.get = async (input) => ({
        ...(await get(input)),
        tokens: { input: 347000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      });
      const result = { output: payload, metadata: { truncated: false } };
      await f.runTool({
        sessionID: 'primary',
        id: 'large-json',
        tool: 'read',
        input: { filePath: 'data.json' },
        result,
      });
      expect(result.output).toBe(payload);
      const context = {
        agent: 'aorchestra',
        sessionID: 'primary',
        tools: { read: {} },
        options: {},
        system: [],
        model: { providerID: 'test', id: 'model' },
      };
      await f.hooks.get('session:context')!(context);
      f.ctx.session.get = async (input) => ({ ...(await get(input)), tokens: {} as any });
      expect(
        JSON.parse((await f.invoke('aorchestra_task', { operation: 'status' })).content).tokenBudget
          .consumed,
      ).toBeNull();
    } finally {
      await f.clean();
    }
  }
});

test('default and null operation budgets continue past old thresholds without losing compaction state', async () => {
  for (const options of [{}, { maxDelegations: null, maxAttempts: null, maxRepairs: null }]) {
    const f = await fixture(options);
    try {
      await f.register();
      for (let attempt = 0; attempt < 10; attempt++) {
        await f.invoke('aorchestra_delegate', {
          taskId: 'api',
          model: 'balanced',
          tools: ['read'],
          routingEvidence: 'Inspect the observed regression',
          delta: attempt ? 'Previous verification failed; inspect retained evidence' : '',
        });
        await f.verify(1);
        await f.invoke('aorchestra_task', {
          operation: 'repair',
          taskId: 'api',
          reason: 'Address the observed failing regression',
        });
      }
      const ledger = new Ledger(f.ctx.storage);
      const before = await ledger.read('primary');
      expect(before.delegations).toBe(10);
      expect(before.tasks[0].attempts).toHaveLength(10);
      expect(before.tasks[0].workflow!.repairs).toBe(10);
      const system: any[] = [];
      await f.hooks.get('session:compaction')!({
        agent: 'aorchestra',
        sessionID: 'primary',
        system,
      });
      const summary = JSON.parse(system[0].text.split('\n')[1]);
      expect(summary.tasks[0]).toMatchObject({ id: 'api', repairs: 10, phase: 'repair' });
      expect(summary.tasks[0].workflow).toBeUndefined();
      expect(summary.tasks[0].verification).toBeUndefined();
      expect(await ledger.read('primary')).toEqual(before);
      await f.verify();
      await f.accept();
    } finally {
      await f.clean();
    }
  }
});

test('explicit operation limits reject invalid values and preserve attempt exhaustion', async () => {
  for (const name of ['maxDelegations', 'maxAttempts', 'maxRepairs']) {
    for (const value of [0, -1, 1.5, '2', false]) {
      await expect(fixture({ [name]: value })).rejects.toThrow(`INVALID_OPTION: ${name}`);
    }
  }
  const f = await fixture({ maxAttempts: 1 });
  try {
    await f.register();
    const input = {
      taskId: 'api',
      model: 'balanced',
      tools: ['read'],
      routingEvidence: 'Inspect API',
    };
    await f.invoke('aorchestra_delegate', input);
    await f.verify(1);
    await f.invoke('aorchestra_task', {
      operation: 'repair',
      taskId: 'api',
      reason: 'Observed failure',
    });
    await expect(
      f.invoke('aorchestra_delegate', { ...input, delta: 'New failure evidence' }),
    ).rejects.toThrow('BUDGET_EXCEEDED');
    expect((await new Ledger(f.ctx.storage).read('primary')).delegations).toBe(1);
  } finally {
    await f.clean();
  }
});

test('legacy 300k token setting allows 402965 tokens after restart for primary and executor', async () => {
  const f = await fixture({ maxSessionTokens: 300000 });
  let restarted: Awaited<ReturnType<typeof plugin.setup>> = undefined;
  try {
    await f.register();
    await f.invoke('aorchestra_delegate', {
      taskId: 'api',
      model: 'balanced',
      tools: ['read'],
      routingEvidence: 'Inspect API',
    });
    const saved = (await f.ctx.storage.get('child/child-1')) as Record<string, unknown>;
    await f.ctx.storage.set('child/child-1', { ...saved, active: true });
    const get = f.ctx.session.get;
    f.ctx.session.get = async (input) => ({
      ...(await get(input)),
      tokens: { input: 402965, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    });
    restarted = await plugin.setup(f.ctx);
    for (const [agent, sessionID] of [
      ['aorchestra', 'primary'],
      ['aorchestra-executor', 'child-1'],
    ]) {
      const system: any[] = [];
      await f.hooks.get('session:compaction')!({ agent, sessionID, system });
      await f.hooks.get('session:context')!({
        agent,
        sessionID,
        tools: { read: {} },
        options: {},
        system,
        model: { providerID: 'test', id: 'model' },
      });
      expect(system.some((item) => item.text.includes('does not block dispatch'))).toBe(true);
    }
    const status = JSON.parse((await f.invoke('aorchestra_task', { operation: 'status' })).content);
    expect(status.tokenBudget).toMatchObject({
      limit: 300000,
      consumed: 402965,
      remaining: 0,
      nearLimit: true,
    });
  } finally {
    if (restarted) await restarted();
    await f.clean();
  }
});

test('unavailable models and variants fail before atomic reservation or child creation', async () => {
  for (const model of ['missing/model', 'github-copilot/gpt-5.6-luna#missing']) {
    const f = await fixture({ models: { fast: model } });
    try {
      await f.register();
      await expect(
        f.invoke('aorchestra_delegate', {
          taskId: 'api',
          model: 'fast',
          tools: ['read'],
          routingEvidence: 'Inspect API',
        }),
      ).rejects.toThrow(/MODEL_(UNAVAILABLE|VARIANT_UNAVAILABLE)/);
      expect(f.creations).toHaveLength(0);
      expect((await new Ledger(f.ctx.storage).read('primary')).delegations).toBe(0);
    } finally {
      await f.clean();
    }
  }
});

test('native grep cannot deliver sensitive matches or search an explicit sensitive path', async () => {
  const f = await fixture();
  try {
    await f.register();
    let release!: () => void;
    f.ctx.session.wait = async () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const running = f.invoke('aorchestra_delegate', {
      taskId: 'api',
      model: 'fast',
      tools: ['grep'],
      routingEvidence: 'Locate API consumers',
    });
    while (!release) await Bun.sleep(1);
    const event = {
      agent: 'aorchestra-executor',
      sessionID: 'child-1',
      id: 'sensitive-search',
      tool: 'grep',
      input: { pattern: 'AUDIT_MARKER', path: '.' },
      status: 'completed',
      result: {
        output: [{ entry: { path: '.env' }, line: 1, text: 'AUDIT_MARKER' }],
        content: 'AUDIT_MARKER',
      },
    };
    try {
      await expect(
        f.hooks.get('tool:execute.before')!({
          ...event,
          input: { pattern: 'AUDIT_MARKER', path: '.env' },
        }),
      ).rejects.toThrow('PATH_OUTSIDE_SCOPE_OR_SENSITIVE');
      f.searchMatches.push(...event.result.output);
      await expect(
        f.tools.get('grep').execute(event.input, { agent: event.agent }),
      ).rejects.toThrow('WORKER_SEARCH_RESULT_DENIED');
    } finally {
      release();
      await running;
    }
  } finally {
    await f.clean();
  }
});

test('worker tools only callable through Code Mode are rejected before reservation', async () => {
  const f = await fixture();
  try {
    (f.ctx.tool as any).list = async () => [{ id: 'custom_lookup', options: { codemode: true } }];
    await f.register();
    await expect(
      f.invoke('aorchestra_delegate', {
        taskId: 'api',
        model: 'fast',
        tools: ['custom_lookup'],
        routingEvidence: 'Bounded lookup',
      }),
    ).rejects.toThrow('WORKER_CODEMODE_TOOL_DENIED');
    expect(f.creations).toHaveLength(0);
    expect((await new Ledger(f.ctx.storage).read('primary')).delegations).toBe(0);
  } finally {
    await f.clean();
  }
});

test('unknown runtime outcome and cancellation after wait cannot produce a worker review', async () => {
  for (const mode of ['unknown', 'cancelled']) {
    const f = await fixture();
    const controller = new AbortController();
    try {
      await f.register();
      const get = f.ctx.session.get;
      f.ctx.session.get = async (input) => ({
        ...(await get(input)),
        ...(input.sessionID !== 'primary' && mode === 'unknown' ? { outcome: undefined } : {}),
      });
      const context = f.ctx.session.context;
      f.ctx.session.context = async (input, request) => {
        if (mode === 'cancelled') controller.abort(new Error('AUDIT_CANCELLED'));
        return context(input, request);
      };
      await expect(
        f.tools.get('aorchestra_delegate').execute(
          {
            taskId: 'api',
            model: 'fast',
            tools: ['read'],
            routingEvidence: 'Inspect API',
          },
          {
            sessionID: 'primary',
            agent: 'aorchestra',
            signal: controller.signal,
            progress: async () => {},
          },
        ),
      ).rejects.toThrow(mode === 'unknown' ? 'RUNTIME_UNVERIFIED_OUTCOME' : 'AUDIT_CANCELLED');
      expect((await new Ledger(f.ctx.storage).read('primary')).tasks[0].status).toBe('blocked');
      expect(f.data.get('child/child-1')).toMatchObject({ active: false });
    } finally {
      await f.clean();
    }
  }
});

test('a registered tool removed from native child context fails explicitly before generation', async () => {
  const f = await fixture();
  try {
    await f.register();
    let release!: () => void;
    f.ctx.session.wait = async () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const running = f.invoke('aorchestra_delegate', {
      taskId: 'api',
      model: 'fast',
      tools: ['read'],
      routingEvidence: 'Inspect API',
    });
    while (!release) await Bun.sleep(1);
    try {
      await expect(
        f.hooks.get('session:context')!({
          agent: 'aorchestra-executor',
          sessionID: 'child-1',
          tools: {},
          options: {},
          system: [],
          model: { providerID: 'github-copilot', id: 'gpt-5.6-luna' },
        }),
      ).rejects.toThrow('WORKER_TOOLS_INEFFECTIVE');
    } finally {
      release();
      await running;
    }
  } finally {
    await f.clean();
  }
});

test('oversized composed instructions fail before child creation rather than truncating constraints', async () => {
  const f = await fixture();
  try {
    await f.invoke('aorchestra_task', {
      operation: 'register',
      task: { ...f.task, preserve: ['x'.repeat(50000)] },
    });
    await expect(
      f.invoke('aorchestra_delegate', {
        taskId: 'api',
        model: 'fast',
        tools: ['read'],
        routingEvidence: 'Inspect API',
      }),
    ).rejects.toThrow('DELEGATION_PROMPT_TOO_LARGE');
    expect(f.creations).toHaveLength(0);
    expect((await new Ledger(f.ctx.storage).read('primary')).delegations).toBe(0);
  } finally {
    await f.clean();
  }
});

test('model configuration is explicit and native variant and tool capability constraints are preserved', async () => {
  for (const models of [
    null,
    [],
    'provider/model',
    { fast: null },
    { unknown: 'provider/model' },
    { fast: 'invalid' },
  ])
    await expect(fixture({ models })).rejects.toThrow();
  const f = await fixture({ models: { fast: 'github-copilot/gpt-5.6-luna#careful' } });
  try {
    (f.ctx.model as any).list = async () => ({
      data: [
        {
          providerID: 'github-copilot',
          id: 'gpt-5.6-luna',
          capabilities: { tools: false },
          variants: [{ id: 'careful' }],
        },
      ],
    });
    await f.register();
    const call = {
      taskId: 'api',
      model: 'fast',
      tools: ['read'],
      routingEvidence: 'Known-file extraction',
    };
    await expect(f.invoke('aorchestra_delegate', call)).rejects.toThrow('MODEL_TOOLS_UNSUPPORTED');
    expect(f.creations).toHaveLength(0);
    (f.ctx.model as any).list = async () => ({
      data: [
        {
          providerID: 'github-copilot',
          id: 'gpt-5.6-luna',
          capabilities: { tools: true },
          variants: [{ id: 'careful' }],
        },
      ],
    });
    await f.invoke('aorchestra_delegate', call);
    expect(f.creations[0].model).toEqual({
      providerID: 'github-copilot',
      id: 'gpt-5.6-luna',
      variant: 'careful',
    });
  } finally {
    await f.clean();
  }
});

test('brownfield context handoffs preserve consumers, project constraints, unknowns and retry provenance', async () => {
  const cases = [
    {
      id: 'localized',
      refs: ['api.ts', 'api.test.ts'],
      fact: 'Nearby regression characterizes the null input.',
      unknown: 'Test not run.',
    },
    {
      id: 'cross-module',
      refs: ['api.ts', 'consumer.ts'],
      fact: 'Consumer requires the existing exported signature.',
      unknown: 'Other callers not inspected.',
    },
    {
      id: 'legacy',
      refs: ['api.ts'],
      fact: 'Observed implementation retains the legacy export.',
      unknown: 'Undocumented conventions need investigation.',
    },
    {
      id: 'monorepo',
      refs: ['packages/api/index.ts', 'packages/client/index.ts'],
      fact: 'Client imports the public API across package boundaries.',
      unknown: 'Downstream build not run.',
    },
    {
      id: 'project-instructions',
      refs: ['AGENTS.md', 'api.ts'],
      fact: 'Project requires preserving public exports.',
      unknown: 'Nested instruction file may apply.',
    },
    {
      id: 'large-context',
      refs: ['api.ts'],
      fact: 'Line pagination is required for full source inspection.',
      unknown: 'Only the first source page was observed.',
    },
    {
      id: 'missing-stale',
      refs: ['deleted.ts'],
      fact: 'Reference describes an earlier revision.',
      unknown: 'Current file is missing; rediscover it.',
    },
    {
      id: 'conflicting',
      refs: ['api.ts', 'consumer.ts'],
      fact: 'Two supplied references disagree on the input contract.',
      unknown: 'Resolve the contradiction in current code.',
    },
    {
      id: 'read-only',
      refs: ['api.ts'],
      fact: 'Investigation only; source edits are excluded.',
      unknown: 'Need references for all callers.',
    },
  ];
  for (const scenario of cases) {
    const f = await fixture();
    try {
      const context =
        scenario.id === 'large-context'
          ? 'x'.repeat(18000)
          : 'Inspect only the named sources and consumers.';
      const handoff: Handoff = {
        sources: scenario.refs.map((ref) => ({ ref, status: 'candidate', revision: 'unknown' })),
        facts: [scenario.fact],
        unknowns: [scenario.unknown],
        checks: ['Primary regression has not run.'],
      };
      await f.invoke('aorchestra_task', {
        operation: 'register',
        task: {
          ...f.task,
          kind: 'analysis',
          writePaths: [],
          analysisMode: 'synthesis',
          context,
          handoff,
        },
      });
      await f.invoke('aorchestra_delegate', {
        taskId: 'api',
        model: 'balanced',
        tools: ['read'],
        routingEvidence: 'Independent bounded investigation',
      });
      const prompt = f.prompts[0].text;
      expect(prompt).toContain(context);
      expect(prompt).toContain(JSON.stringify(handoff));
      expect(prompt).toContain(f.task.instruction);
      expect(prompt).toContain(f.task.preserve[0]);
      expect(prompt).toContain('WRITE PATHS\nnone');
      expect(prompt).toContain('primary runs any shell checks');
      if (scenario.id === 'missing-stale' || scenario.id === 'conflicting')
        expect(prompt).toContain(scenario.unknown);
      await f.invoke('aorchestra_task', {
        operation: 'repair',
        taskId: 'api',
        reason: 'Inspect previously missing consumer',
      });
      const refreshed = {
        ...handoff,
        facts: ['Earlier child result remains unverified; current source was re-read.'],
      };
      await f.invoke('aorchestra_delegate', {
        taskId: 'api',
        model: 'balanced',
        tools: ['read'],
        routingEvidence: 'Resolve an observed gap',
        delta: 'Added current consumer reference',
        handoff: refreshed,
      });
      expect(f.prompts[1].text).toContain(JSON.stringify(refreshed));
      expect(f.prompts[1].text).toContain('RETRY DELTA\nAdded current consumer reference');
    } finally {
      await f.clean();
    }
  }
});

test('routing scenario matrix keeps DIRECT optional and enforces bounded delegation admission', async () => {
  const scenarios = [
    { id: 'trivial', expected: 'DIRECT', delegate: true },
    { id: 'single-file-bug', expected: 'DIRECT', delegate: true },
    { id: 'repository-investigation', expected: 'DELEGATE', analysis: true, delegate: true },
    { id: 'independent-investigation', expected: 'DELEGATE', analysis: true, delegate: true },
    { id: 'coupled-edits', expected: 'DIRECT', delegate: true },
    {
      id: 'missing-context',
      expected: 'DIRECT or BLOCKED',
      delegate: false,
      error: 'HANDOFF_REQUIRED',
    },
    { id: 'ordered-dependencies', expected: 'WAIT', delegate: false, error: 'DEPENDENCY_UNMET' },
    {
      id: 'unavailable-model',
      expected: 'DIRECT or BLOCKED',
      delegate: false,
      error: 'MODEL_UNAVAILABLE',
    },
    { id: 'failed-worker', expected: 'REPAIR', delegate: false, error: 'RUNTIME_FAILED' },
    { id: 'complex-description-local-change', expected: 'DIRECT', delegate: true },
  ];
  for (const scenario of scenarios) {
    const f = await fixture(
      scenario.id === 'unavailable-model' ? { models: { fast: 'missing/model' } } : {},
    );
    try {
      const task = {
        ...f.task,
        instruction: `${scenario.id}: preserve the public api export.`,
        ...(scenario.analysis ? { kind: 'analysis', writePaths: [], analysisMode: 'lookup' } : {}),
      };
      if (scenario.id === 'missing-context') delete (task as any).handoff;
      if (scenario.id === 'ordered-dependencies') {
        await f.invoke('aorchestra_task', {
          operation: 'register',
          task: { ...f.task, id: 'dependency' },
        });
        task.dependsOn = ['dependency'];
      }
      if (scenario.id === 'failed-worker') {
        const get = f.ctx.session.get;
        f.ctx.session.get = async (input) => ({
          ...(await get(input)),
          outcome: input.sessionID === 'primary' ? 'succeeded' : 'failed',
        });
      }
      await f.invoke('aorchestra_task', { operation: 'register', task });
      const call = {
        taskId: 'api',
        model: 'fast',
        tools: ['read'],
        routingEvidence: `Caller supplied ${scenario.expected}; checking admission only`,
      };
      if (scenario.delegate) {
        const result = await f.invoke('aorchestra_delegate', call);
        expect(result.metadata.accepted).toBe(false);
      } else {
        await expect(f.invoke('aorchestra_delegate', call)).rejects.toThrow(scenario.error);
        expect(f.creations).toHaveLength(scenario.id === 'failed-worker' ? 1 : 0);
      }
      // Expected recommendations are input annotations; this test does not ask
      // a model to choose DIRECT/DELEGATE or claim that allowed means useful.
    } finally {
      await f.clean();
    }
  }
});

test('diagnostic counts rejected delegate invocations before admission and stops continuation', async () => {
  const f = await fixture({}, true);
  try {
    await f.invoke('aorchestra_task', archivedDelegation.registration);
    await expect(
      f.invoke('aorchestra_delegate', archivedDelegation.calls[0].input),
    ).rejects.toThrow('HANDOFF_OBJECT_REQUIRED');
    const state = await new Ledger(f.ctx.storage).read('primary');
    await expect(
      f.invoke('aorchestra_delegate', archivedDelegation.calls[1].input),
    ).rejects.toThrow('DIAGNOSTIC_INVOCATION_LIMIT');
    expect(await new Ledger(f.ctx.storage).read('primary')).toEqual(state);
    expect(state.delegations).toBe(0);
    expect(f.creations).toHaveLength(0);
    await expect(
      f.hooks.get('session:context')!({
        agent: 'aorchestra',
        sessionID: 'primary',
        tools: { read: {} },
        options: {},
        system: [],
      }),
    ).rejects.toThrow('DIAGNOSTIC_HALTED');
  } finally {
    await f.clean();
  }
});

test('diagnostic successful child allows parent continuation but blocks a second execution after reload', async () => {
  const f = await fixture({}, true);
  let reloaded: Awaited<ReturnType<typeof plugin.setup>>;
  try {
    await f.invoke('aorchestra_task', archivedDelegation.registration);
    const input = {
      taskId: archivedDelegation.registration.task.id,
      model: 'fast',
      tools: ['read'],
      routingEvidence: 'Bounded lookup',
    };
    const result = await f.invoke('aorchestra_delegate', input);
    expect(result.metadata).toMatchObject({
      childSessionID: 'child-1',
      accepted: false,
      workerStatus: 'PARTIAL',
    });
    expect(f.creations).toHaveLength(1);
    expect(f.prompts[0].text).toContain('UNTRUSTED SOURCE HANDOFF');
    expect(f.prompts[0].text).toContain('TOOLS\nread');
    await f.hooks.get('session:context')!({
      agent: 'aorchestra',
      sessionID: 'primary',
      model: { providerID: 'github-copilot', id: 'gpt-5.6-terra' },
      tools: { read: {} },
      options: {},
      system: [],
    });
    reloaded = await plugin.setup(proofContext(f.ctx));
    await expect(f.invoke('aorchestra_delegate', input)).rejects.toThrow(
      'DIAGNOSTIC_INVOCATION_LIMIT',
    );
    expect(f.creations).toHaveLength(1);
    const retry = {
      agent: 'aorchestra',
      sessionID: 'primary',
      decision: { retry: true },
      error: 'provider failed',
    };
    await expect(f.hooks.get('session:retry')!(retry)).rejects.toThrow('DIAGNOSTIC_HALTED');
  } finally {
    if (reloaded!) await reloaded();
    await f.clean();
  }
});

test('diagnostic simultaneous invalid calls admit only one callback and prohibit groups and repairs', async () => {
  const f = await fixture({}, true);
  try {
    await f.invoke('aorchestra_task', archivedDelegation.registration);
    const outcomes = await Promise.allSettled([
      f.invoke('aorchestra_delegate', archivedDelegation.calls[0].input),
      f.invoke('aorchestra_delegate', archivedDelegation.calls[1].input),
    ]);
    const errors = outcomes.map((result) =>
      result.status === 'rejected' ? String(result.reason) : 'unexpected-success',
    );
    expect(errors.filter((error) => error.includes('HANDOFF_OBJECT_REQUIRED'))).toHaveLength(1);
    expect(errors.filter((error) => error.includes('DIAGNOSTIC_INVOCATION_LIMIT'))).toHaveLength(1);
    expect(f.creations).toHaveLength(0);
    await expect(
      f.invoke('aorchestra_task', {
        operation: 'repair',
        taskId: 'config-zero-lookup',
        repairReason: 'try again',
      }),
    ).rejects.toThrow('DIAGNOSTIC_REPAIR_FORBIDDEN');
  } finally {
    await f.clean();
  }
  const group = await fixture({}, true);
  try {
    await expect(group.invoke('aorchestra_delegate', { tasks: [{}, {}] })).rejects.toThrow(
      'DIAGNOSTIC_SINGLE_TASK_REQUIRED',
    );
    expect(group.creations).toHaveLength(0);
  } finally {
    await group.clean();
  }
});

test('diagnostic disables native provider retries and replacement lookups', async () => {
  const f = await fixture({}, true);
  try {
    await f.invoke('aorchestra_task', archivedDelegation.registration);
    await expect(
      f.invoke('aorchestra_task', {
        ...archivedDelegation.registration,
        task: { ...archivedDelegation.registration.task, id: 'replacement' },
      }),
    ).rejects.toThrow('DIAGNOSTIC_LOOKUP_REQUIRED');
  } finally {
    await f.clean();
  }
  const retry = await fixture({}, true);
  try {
    const event = {
      agent: 'aorchestra',
      sessionID: 'primary',
      decision: { retry: true },
      error: 'provider failed',
    };
    await retry.hooks.get('session:retry')!(event);
    expect(event.decision.retry).toBe(false);
    await expect(
      retry.hooks.get('session:context')!({
        agent: 'aorchestra',
        sessionID: 'primary',
        tools: { read: {} },
        options: {},
        system: [],
      }),
    ).rejects.toThrow('DIAGNOSTIC_HALTED');
  } finally {
    await retry.clean();
  }
});

test('diagnostic HTTP budget counts sends independently and rejects auxiliary inference', async () => {
  const f = await fixture({}, true);
  try {
    const budget = requestBudget(f.ctx);
    for (let step = 0; step < 20; step++)
      await budget({ agent: 'aorchestra', kind: 'primary', sessionID: 'primary' });
    await expect(
      budget({ agent: 'aorchestra', kind: 'primary', sessionID: 'primary' }),
    ).rejects.toThrow('DIAGNOSTIC_PROVIDER_REQUEST_LIMIT');
    const restarted = requestBudget(f.ctx);
    await expect(
      restarted({ agent: 'aorchestra', kind: 'primary', sessionID: 'primary' }),
    ).rejects.toThrow('DIAGNOSTIC_PROVIDER_REQUEST_LIMIT');
    for (let step = 0; step < 8; step++)
      await budget({ agent: 'aorchestra-executor', kind: 'primary', sessionID: 'child' });
    await expect(
      budget({ agent: 'aorchestra-executor', kind: 'primary', sessionID: 'child' }),
    ).rejects.toThrow('DIAGNOSTIC_PROVIDER_REQUEST_LIMIT');
    await expect(budget({ agent: 'title', kind: 'title', sessionID: 'primary' })).rejects.toThrow(
      'DIAGNOSTIC_PROVIDER_REQUEST_LIMIT',
    );
  } finally {
    await f.clean();
  }
});

test('diagnostic preflight rejects discovered step limits or missing native wrapper', () => {
  const valid = {
    available: true,
    tools: true,
    behavior: false,
    regression: true,
    agents: [
      { id: 'aorchestra', steps: 20 },
      { id: 'aorchestra-executor', steps: 8 },
    ],
    wrapperActive: true,
  };
  expect(readyForProof(valid)).toBe(true);
  expect(
    readyForProof({
      ...valid,
      agents: [
        { id: 'aorchestra', steps: 30 },
        { id: 'aorchestra-executor', steps: 24 },
      ],
    }),
  ).toBe(false);
  expect(readyForProof({ ...valid, wrapperActive: false })).toBe(false);
});
