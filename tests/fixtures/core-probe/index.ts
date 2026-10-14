import { Plugin, Model } from '@opencode/plugin';
import harness from '../../../plugins/aorchestra';
import { permissionRules } from '../../../lib/core';
import archivedDelegation from '../delegation-contract.json';

export const rpc = {
  id: 'aorchestra.core-probe',
  methods: {
    run: {
      input: { type: 'object', properties: {} },
      output: { type: 'object', additionalProperties: true },
    },
  },
  events: {},
} as const;

// Test-only RPC: real native leaf tools; captured harness callbacks supply the
// tool boundary normally driven by a model call. No generation is requested.
export default Plugin.define({
  id: 'aorchestra',
  async setup(ctx) {
    const hooks = new Map<string, (event: any) => Promise<void>>();
    let delegatedCreations = 0;
    const cleanup = await harness.setup({
      ...ctx,
      session: {
        ...ctx.session,
        create: async (...args) => {
          delegatedCreations++;
          return ctx.session.create(...args);
        },
      },
      tool: {
        ...ctx.tool,
        hook: async (name, callback) => {
          hooks.set(name, callback as any);
          return ctx.tool.hook(name, callback);
        },
      },
    });
    await ctx.rpc.register(rpc, {
      run: async () => {
        const root = ctx.location.directory;
        const primary = await ctx.session.create({
          agent: 'aorchestra',
          location: { directory: root },
        });
        const catalog = await ctx.tool.list();
        const tools = new Map(catalog.map((tool) => [tool.id, tool]));
        const delegate = tools.get('aorchestra_delegate')!;
        const schema = delegate.input as any;
        if (
          schema.oneOf[0].properties.tools.type !== 'array' ||
          !schema.oneOf[0].properties.tools.uniqueItems ||
          !schema.oneOf[0].properties.tools.description.includes('JSON array') ||
          schema.oneOf[0].properties.handoff.type !== 'object' ||
          !schema.oneOf[0].properties.handoff.description.includes('JSON object') ||
          !delegate.description.includes('"tools":["read"]')
        )
          throw new Error('NATIVE_DELEGATION_SCHEMA_MISMATCH');
        let serial = 0;
        const call = async (sessionID: string, agent: string, tool: string, input: any) => {
          const execution = {
            sessionID,
            agent,
            messageID: 'msg_core_probe',
            id: `call_${++serial}`,
            signal: new AbortController().signal,
            progress: async () => {},
          } as any;
          const event = { ...execution, tool, input };
          await hooks.get('execute.before')!(event);
          const result = await tools.get(tool)!.execute(input, execution);
          await hooks.get('execute.after')!({ ...event, status: 'completed', result });
          return result;
        };
        const mustReject = async (action: () => Promise<unknown>, expected?: string) => {
          try {
            await action();
          } catch (error) {
            if (!expected || String(error).includes(expected)) return;
            throw error;
          }
          throw new Error(`PROBE_EXPECTED_REJECTION: ${expected ?? 'native permission'}`);
        };
        const task = {
          id: 'direct',
          kind: 'change',
          instruction: 'Replace the api marker; preserve the export.',
          context: 'api.ts contains the local fixture.',
          dependsOn: [],
          writePaths: ['api.ts'],
          preserve: ['api remains exported'],
          handoff: {
            sources: [{ ref: 'api.ts', status: 'observed', revision: 'fixture' }],
            facts: [],
            unknowns: [],
            checks: ['Native read predicate pending'],
          },
          verifiers: [
            {
              id: 'read',
              tool: 'read',
              input: { path: 'api.ts' },
              expect: { contains: 'export const api = "after"' },
            },
          ],
        };
        await call(primary.id, 'aorchestra', 'aorchestra_task', { operation: 'register', task });
        await call(primary.id, 'aorchestra', 'aorchestra_task', {
          operation: 'start',
          taskId: task.id,
        });
        await call(primary.id, 'aorchestra', 'edit', {
          path: 'api.ts',
          oldString: 'before',
          newString: 'after',
        });
        await call(primary.id, 'aorchestra', 'read', { path: 'api.ts' });
        const accepted = await call(primary.id, 'aorchestra', 'aorchestra_task', {
          operation: 'accept',
          taskId: task.id,
          compatibilityReview: 'Native read confirms the preserved export and new value.',
        });
        if (!String(accepted.content).includes('"status": "complete"'))
          throw new Error('NATIVE_DIRECT_NOT_ACCEPTED');
        await call(primary.id, 'aorchestra', 'aorchestra_task', {
          operation: 'register',
          task: { ...task, id: 'worker' },
        });
        await mustReject(
          () =>
            call(primary.id, 'aorchestra', 'aorchestra_delegate', {
              taskId: 'worker',
              model: 'fast',
              tools: ['read'],
              routingEvidence: 'Check unavailable model admission',
            }),
          'MODEL_UNAVAILABLE',
        );
        const state = (await ctx.storage.get(`state/${primary.id}`)) as any;
        if (state.delegations !== 0) throw new Error('NATIVE_INVALID_CONTRACT_SPENT_BUDGET');
        await call(primary.id, 'aorchestra', 'aorchestra_task', archivedDelegation.registration);
        const before = JSON.stringify(await ctx.storage.get(`state/${primary.id}`));
        for (const archived of archivedDelegation.calls) {
          await mustReject(
            () => call(primary.id, 'aorchestra', 'aorchestra_delegate', archived.input),
            archived.originalError === 'HANDOFF_SOURCES_INVALID'
              ? 'HANDOFF_OBJECT_REQUIRED'
              : 'TOOLS_ARRAY_REQUIRED',
          );
          if (JSON.stringify(await ctx.storage.get(`state/${primary.id}`)) !== before)
            throw new Error('NATIVE_MALFORMED_CONTRACT_MUTATED_STATE');
        }
        const corrected = {
          ...archivedDelegation.calls[1].input,
          tools: JSON.parse(archivedDelegation.calls[0].input.tools),
        };
        await mustReject(
          () => call(primary.id, 'aorchestra', 'aorchestra_delegate', corrected),
          'MODEL_UNAVAILABLE',
        );
        if (JSON.stringify(await ctx.storage.get(`state/${primary.id}`)) !== before)
          throw new Error('NATIVE_CORRECTED_CONTRACT_SPENT_BUDGET');
        if (delegatedCreations) throw new Error('NATIVE_REJECTED_CONTRACT_CREATED_CHILD');
        const saved = {
          owner: primary.id,
          taskId: 'worker',
          root,
          tools: ['read', 'grep', 'edit'],
          writePaths: ['api.ts'],
          kind: 'change' as const,
          active: true,
        };
        const model = Model.Ref.parse('audit-unavailable/model');
        const child = await ctx.session.create({
          parentID: primary.id,
          agent: 'aorchestra-executor',
          model,
          location: { directory: root },
          permissions: permissionRules(saved),
        });
        await ctx.storage.set(`child/${child.id}`, saved);
        const persisted = await ctx.session.get({ sessionID: child.id });
        if (
          persisted.model?.id !== model.id ||
          persisted.model.providerID !== model.providerID ||
          persisted.parentID !== primary.id
        )
          throw new Error('NATIVE_CHILD_CONFIGURATION_MISMATCH');
        await call(child.id, 'aorchestra-executor', 'read', { path: 'api.ts' });
        await call(child.id, 'aorchestra-executor', 'edit', {
          path: 'api.ts',
          oldString: 'after',
          newString: 'worker',
        });
        await call(child.id, 'aorchestra-executor', 'grep', { pattern: 'worker', include: '*.ts' });
        await mustReject(() =>
          call(child.id, 'aorchestra-executor', 'edit', {
            path: 'other.ts',
            oldString: 'before',
            newString: 'forbidden',
          }),
        );
        await mustReject(() => call(child.id, 'aorchestra-executor', 'read', { path: '.env' }));
        await mustReject(
          () => call(child.id, 'aorchestra-executor', 'grep', { pattern: 'AUDIT_SECRET_MARKER' }),
          'WORKER_SEARCH_RESULT_DENIED',
        );
        await mustReject(
          () => call(child.id, 'aorchestra-executor', 'shell', { command: 'echo forbidden' }),
          'WORKER_TOOL_DENIED',
        );
        await mustReject(
          () => call(child.id, 'aorchestra-executor', 'aorchestra_delegate', {}),
          'AORCHESTRA_INACTIVE_FOR_AGENT',
        );
        await ctx.storage.set(`child/${child.id}`, { ...saved, active: false });
        await mustReject(
          () => call(child.id, 'aorchestra-executor', 'read', { path: 'api.ts' }),
          'WORKER_TOOL_DENIED',
        );
        await ctx.session.remove({ sessionID: primary.id });
        return {
          directNativeEditReadAcceptance: true,
          childNativeConfiguration: true,
          childNativeReadEditSearch: true,
          scopeAndSecretRejections: true,
          unavailableModelAdmission: true,
          delegationSchemaRegistration: true,
          malformedArgumentTypesRejected: true,
          correctedPayloadReachesModelAdmission: true,
          revokedChildRejected: true,
          manuallyDrivenToolHooks: true,
          modelCalls: 0,
        };
      },
    });
    return cleanup;
  },
});
