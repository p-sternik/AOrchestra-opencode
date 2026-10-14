import { Plugin } from '@opencode/plugin';
import harness from '../../../plugins/aorchestra';
import { proofContext, requestBudget } from './gate';
import { appendFile } from 'node:fs/promises';

export const rpc = {
  id: 'aorchestra.delegation-proof',
  methods: {
    run: {
      input: { type: 'object', properties: {} },
      output: { type: 'object', additionalProperties: true },
    },
  },
  events: {},
} as const;

export default Plugin.define({
  id: 'aorchestra',
  async setup(ctx) {
    const cleanup = await harness.setup(proofContext(ctx));
    // Avoid an auxiliary title request in this bounded capability diagnostic.
    await ctx.session.hook('title', async (event) => {
      event.result = 'Delegation foundation proof';
    });
    const reserveRequest = requestBudget(ctx);
    const path = ctx.options.proofEvidencePath;
    if (typeof path === 'string') {
      const record = (entry: unknown) => appendFile(path, JSON.stringify(entry) + '\n');
      await ctx.session.hook('http.request', async (event) => {
        await reserveRequest(event);
        const url = new URL(event.request.url);
        await record({
          type: 'provider-request',
          at: Date.now(),
          sessionID: event.sessionID,
          agent: event.agent,
          model: event.model,
          kind: event.kind,
          endpoint: url.origin + url.pathname,
          body: await event.request.clone().json(),
        });
      });
      await ctx.session.hook('http.response', async (event) => {
        await record({
          type: 'provider-response',
          at: Date.now(),
          sessionID: event.sessionID,
          agent: event.agent,
          model: event.model,
          kind: event.kind,
          status: event.response.status,
        });
      });
    }
    // Enabled only by the no-inference checker, never by the prepared diagnostic.
    if (ctx.options.noInferenceProbe === true)
      await ctx.rpc.register(rpc, {
        run: async () => {
          const primary = await ctx.session.create({ agent: 'aorchestra', location: ctx.location });
          const tools = new Map((await ctx.tool.list()).map((tool) => [tool.id, tool]));
          const schema = tools.get('aorchestra_delegate')!.input as any;
          if (
            schema.oneOf[0].properties.tools.type !== 'array' ||
            schema.oneOf[0].properties.handoff.type !== 'object'
          )
            throw new Error('PROOF_SCHEMA_INVALID');
          const execution = {
            sessionID: primary.id,
            agent: 'aorchestra',
            id: 'proof-call',
            messageID: 'msg_proof_probe',
            signal: new AbortController().signal,
            progress: async () => {},
          } as any;
          await tools.get('aorchestra_task')!.execute(
            {
              operation: 'register',
              task: {
                id: 'lookup',
                kind: 'analysis',
                analysisMode: 'lookup',
                instruction: 'Read config.js and report exported zero-discarding settings.',
                context: 'Read-only lookup of config.js.',
                dependsOn: [],
                writePaths: [],
                preserve: ['Source files remain unchanged'],
                handoff: {
                  sources: [{ ref: 'config.js', status: 'candidate', revision: 'unknown' }],
                  facts: [],
                  unknowns: ['Which settings discard zero?'],
                  checks: ['Primary read pending'],
                },
                verifiers: [
                  {
                    id: 'read',
                    tool: 'read',
                    input: { path: 'config.js' },
                    expect: { contains: 'export' },
                  },
                ],
              },
            },
            execution,
          );
          const input = {
            taskId: 'lookup',
            model: 'fast',
            tools: ['read'],
            routingEvidence: 'Single source lookup',
          };
          const rejects = async (expected: string) => {
            try {
              await tools.get('aorchestra_delegate')!.execute(input, execution);
            } catch (error) {
              if (String(error).includes(expected)) return;
              throw error;
            }
            throw new Error(`PROOF_EXPECTED_REJECTION: ${expected}`);
          };
          await rejects('MODEL_UNAVAILABLE');
          await rejects('DIAGNOSTIC_INVOCATION_LIMIT');
          const gate = (await ctx.storage.get(`proof-gate/${primary.id}`)) as any;
          if (gate.invocations !== 2 || gate.halted !== 'DIAGNOSTIC_INVOCATION_LIMIT')
            throw new Error('PROOF_GATE_NOT_PERSISTED');
          return {
            nativeSchema: true,
            validTypedInputReachedModelAdmission: true,
            rejectedCallCounted: true,
            secondCallbackBlocked: true,
            modelCalls: 0,
          };
        },
      });
    return cleanup;
  },
});
