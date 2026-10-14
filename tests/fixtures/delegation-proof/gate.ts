import type { Plugin } from '@opencode/plugin';
import { appendFile } from 'node:fs/promises';

type Gate = { invocations: number; halted?: string; lookup?: string };
// Evaluation-only wrapper. Production admission, budgets and permissions are unchanged.
export function proofContext(ctx: Plugin.Context): Plugin.Context {
  let tail = Promise.resolve();
  const key = (id: string) => `proof-gate/${id}`;
  const read = async (id: string): Promise<Gate> =>
    ((await ctx.storage.get(key(id))) as Gate | undefined) ?? { invocations: 0 };
  const record = async (type: string, evidence: unknown) => {
    const entry = { type, at: Date.now(), evidence };
    const path = ctx.options.proofEvidencePath;
    if (typeof path === 'string') await appendFile(path, JSON.stringify(entry) + '\n');
  };
  const mutate = async <T>(id: string, action: (state: Gate) => T): Promise<T> => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const state = await read(id);
      const result = action(state);
      await ctx.storage.set(key(id), state);
      return result;
    } finally {
      release();
    }
  };
  const halt = async (id: string, reason: string) => {
    await mutate(id, (state) => {
      state.halted = reason;
    });
    await record('halt', { sessionID: id, reason });
  };
  return {
    ...ctx,
    tool: {
      ...ctx.tool,
      transform: async (callback) =>
        ctx.tool.transform((editor) =>
          callback({
            ...editor,
            add: (tool) => {
              if (!['aorchestra_delegate', 'aorchestra_task'].includes(tool.name))
                return editor.add(tool);
              const execute = tool.execute;
              return editor.add({
                ...tool,
                execute: async (raw, execution) => {
                  const id = execution.sessionID;
                  const input = raw as any;
                  if (tool.name === 'aorchestra_task') {
                    if (['repair', 'recover', 'invalidate', 'resume'].includes(input?.operation)) {
                      await halt(id, 'DIAGNOSTIC_REPAIR_FORBIDDEN');
                      throw new Error('DIAGNOSTIC_REPAIR_FORBIDDEN');
                    }
                    if (input?.operation === 'register' && input.task?.kind === 'analysis') {
                      const allowed = await mutate(id, (state) => {
                        if (state.lookup || state.invocations || state.halted) return false;
                        state.lookup = input.task.id;
                        return true;
                      });
                      if (
                        !allowed ||
                        input.task.analysisMode !== 'lookup' ||
                        input.task.writePaths?.length !== 0
                      ) {
                        await halt(id, 'DIAGNOSTIC_LOOKUP_REQUIRED');
                        throw new Error('DIAGNOSTIC_LOOKUP_REQUIRED');
                      }
                    }
                    const result = await execute(raw, execution);
                    await record('task', { input: raw, result, sessionID: id });
                    return result;
                  }
                  // Count before any shape/model/tool admission, including rejected inputs.
                  const allowed = await mutate(id, (state) => {
                    state.invocations++;
                    return state.invocations === 1 && !state.halted;
                  });
                  await record('delegate-invocation', { input: raw, sessionID: id, allowed });
                  if (!allowed) {
                    await halt(id, 'DIAGNOSTIC_INVOCATION_LIMIT');
                    throw new Error('DIAGNOSTIC_INVOCATION_LIMIT');
                  }
                  try {
                    if (input && typeof input === 'object' && 'tasks' in input)
                      throw new Error('DIAGNOSTIC_SINGLE_TASK_REQUIRED');
                    const result = await execute(raw, execution);
                    await record('delegate-result', { sessionID: id, result });
                    if ((result.metadata as any)?.workerStatus === 'BLOCKED')
                      await halt(id, 'DIAGNOSTIC_CHILD_BLOCKED');
                    return result;
                  } catch (error) {
                    await halt(id, String(error));
                    throw error;
                  }
                },
              });
            },
          }),
        ),
    },
    session: {
      ...ctx.session,
      // Record the actual inputs/outputs without taking ownership of native execution.
      get: async (...args) => {
        const result = await ctx.session.get(...args);
        await record('native-session', result);
        return result;
      },
      context: async (...args) => {
        const result = await ctx.session.context(...args);
        await record('native-child-context', { input: args[0], result });
        return result;
      },
      create: async (...args) => {
        await record('child-create-input', args[0]);
        const child = await ctx.session.create(...args);
        await record('child-created', child);
        return child;
      },
      prompt: async (...args) => {
        await record('child-prompt', args[0]);
        return ctx.session.prompt(...args);
      },
      wait: async (...args) => {
        const result = await ctx.session.wait(...args);
        await record('child-wait', { input: args[0], result });
        return result;
      },
      hook: async (name, callback) => {
        if (name !== 'context' && name !== 'retry') return ctx.session.hook(name, callback);
        return ctx.session.hook(name, async (event: any) => {
          const owner =
            event.agent === 'aorchestra-executor'
              ? ((await ctx.storage.get(`child/${event.sessionID}`)) as any)?.owner
              : event.sessionID;
          if (owner && (await read(owner)).halted) throw new Error('DIAGNOSTIC_HALTED');
          await (callback as any)(event);
          if (
            name === 'context' &&
            event.agent === 'aorchestra' &&
            (await read(event.sessionID)).invocations > 0
          )
            delete event.tools.aorchestra_delegate;
          if (name === 'retry') {
            event.decision = { retry: false };
            await halt(owner ?? event.sessionID, 'DIAGNOSTIC_PROVIDER_RETRY_FORBIDDEN');
          } else {
            await record('effective-context', {
              sessionID: event.sessionID,
              agent: event.agent,
              model: event.model,
              tools: Object.keys(event.tools),
              system: event.system,
              messages: event.messages,
            });
          }
        });
      },
    },
  };
}

// HTTP-budget guard is independent of model step counts and counts attempted sends.
export function requestBudget(ctx: Plugin.Context) {
  let tail = Promise.resolve();
  return async (event: { agent: string; kind: string; sessionID: string }) => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const counts =
        ((await ctx.storage.get('proof-provider-budget')) as Record<string, number> | undefined) ??
        {};
      const role =
        event.kind === 'primary' && event.agent === 'aorchestra'
          ? 'primary'
          : event.kind === 'primary' && event.agent === 'aorchestra-executor'
            ? 'child'
            : 'unsupported';
      counts[role] = (counts[role] ?? 0) + 1;
      await ctx.storage.set('proof-provider-budget', counts);
      const limit = role === 'primary' ? 20 : role === 'child' ? 8 : 0;
      if (counts[role] > limit) throw new Error(`DIAGNOSTIC_PROVIDER_REQUEST_LIMIT: ${role}`);
      const state = (await ctx.storage.get(`proof-gate/${event.sessionID}`)) as Gate | undefined;
      if (state?.halted) throw new Error('DIAGNOSTIC_HALTED');
    } finally {
      release();
    }
  };
}

export function readyForProof(input: {
  available: boolean;
  tools: boolean;
  behavior: boolean;
  regression: boolean;
  agents: { id: string; steps?: number }[];
  wrapperActive: boolean;
}) {
  return (
    input.available &&
    input.tools &&
    !input.behavior &&
    input.regression &&
    input.wrapperActive &&
    input.agents.find((agent) => agent.id === 'aorchestra')?.steps === 20 &&
    input.agents.find((agent) => agent.id === 'aorchestra-executor')?.steps === 8
  );
}
