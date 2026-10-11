import { Plugin, Model, Skill } from '@opencode/plugin';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Ledger, parseResult, permissionRules, ready, registerTask, reserve, taskById, validateTools, verifierPassed, type Contract, type Task, type Tier } from '../lib/core';
import { canonicalTarget, changedPaths, fingerprint, snapshot } from '../lib/files';
import { Telemetry, counters, metricsRpc } from '../lib/telemetry';

const idSchema = { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,79}$' };
const strings = { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1 }, uniqueItems: true };
const verifierSchema = { type: 'object', additionalProperties: false, properties: {
  id: idSchema, tool: { type: 'string', minLength: 1 },
  input: { type: 'object', minProperties: 1, additionalProperties: { type: 'string' } },
  expect: { type: 'object', additionalProperties: false, properties: { exitCode: { type: 'integer' }, contains: { type: 'string', minLength: 1 } }, minProperties: 1 },
}, required: ['id', 'tool', 'input', 'expect'] };
const taskSchema = { type: 'object', additionalProperties: false, properties: {
  id: idSchema, kind: { enum: ['analysis', 'change', 'verification'] },
  instruction: { type: 'string', minLength: 1, maxLength: 6000 }, context: { type: 'string', maxLength: 18000 },
  dependsOn: strings, writePaths: strings, preserve: strings,
  verifiers: { type: 'array', minItems: 1, maxItems: 10, items: verifierSchema },
}, required: ['id', 'kind', 'instruction', 'context', 'dependsOn', 'writePaths', 'preserve', 'verifiers'] };

type TaskInput = { operation: 'register' | 'start' | 'status' | 'accept' | 'invalidate' | 'recover'; task?: Task; taskId?: string; compatibilityReview?: string; reason?: string };
type DelegateInput = { taskId: string; model: Tier; tools: string[]; routingEvidence: string; delta?: string };
type SavedContract = Contract & { active: boolean };

export default Plugin.define({
  id: 'aorchestra',
  async setup(ctx) {
    const root = await realpath(ctx.location.directory);
    // The bundled directory travels with OPENCODE_CONFIG; global skill installation is optional.
    const skillPath = fileURLToPath(new URL('../skills/repo-context/SKILL.md', import.meta.url));
    const skillText = await readFile(skillPath, 'utf8');
    const description = /^description: (.+)$/m.exec(skillText)?.[1];
    const content = skillText.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
    await ctx.skill.transform(editor => editor.add({ id: 'repo-context', name: 'repo-context', path: skillPath, description: description ? JSON.parse(description) : undefined, content, autoinvoke: false } as Skill.Info));
    const options = ctx.options as Record<string, unknown>;
    const models = { fast: 'github-copilot/gpt-5.6-luna', balanced: 'github-copilot/gpt-5.6-terra', strong: 'github-copilot/gpt-5.6-sol', ...(options.models as Partial<Record<Tier, string>> | undefined) };
    const limit = (name: string, fallback: number) => {
      const value = options[name] ?? fallback;
      if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`INVALID_OPTION: ${name}`);
      return Number(value);
    };
    const maxDelegations = limit('maxDelegations', 8), maxAttempts = limit('maxAttempts', 2), timeoutMs = limit('timeoutMs', 600_000), maxSessionTokens = limit('maxSessionTokens', 300_000);
    const ignored = options.snapshotIgnore ?? [];
    if (!Array.isArray(ignored) || ignored.some(item => typeof item !== 'string' || item.includes('/') || item.includes('\\'))) throw new Error('snapshotIgnore must contain directory basenames');
    const takeSnapshot = () => snapshot(root, ignored as string[]);
    const ledger = new Ledger({ get: key => ctx.storage.get(key), set: async (key, value) => ctx.storage.set(key, JSON.parse(JSON.stringify(value))) });
    const contractKey = (child: string) => `child/${child}`;
    const contract = async (child: string) => await ctx.storage.get(contractKey(child)) as unknown as SavedContract | undefined;
    const telemetry = new Telemetry({get:key=>ctx.storage.get(key),set:async(key,value)=>ctx.storage.set(key,JSON.parse(JSON.stringify(value))),scan:input=>ctx.storage.scan(input)});
    if(options.telemetry!==undefined&&typeof options.telemetry!=='boolean')throw new Error('INVALID_OPTION: telemetry must be boolean');
    const metricsEnabled=options.telemetry!==false;
    let metricsWarning=false;
    const observe=async(action:()=>Promise<unknown>)=>{if(!metricsEnabled)return;try{await action();}catch{if(!metricsWarning){metricsWarning=true;console.error('AORCHESTRA_TELEMETRY_INCOMPLETE: collection unavailable; execution continues');}}};
    await ctx.rpc.register(metricsRpc,{list:async raw=>{const input=raw as {after?:string;limit?:number};return telemetry.page(input.after,input.limit);}});
    const eventStop=new AbortController();
    if(metricsEnabled)void(async()=>{
      for await(const event of ctx.event.subscribe({signal:eventStop.signal})){
        if(event.location?.directory&&resolve(event.location.directory)!==root)continue;
        const data=(event.data&&typeof event.data==='object'?event.data:{}) as {sessionID?:string;error?:unknown;reply?:string};
        const eventTime='created' in event?event.created:Date.now();
        if(!data.sessionID||!['session.execution.started','session.execution.succeeded','session.execution.failed','session.execution.interrupted','permission.asked','permission.replied'].includes(event.type))continue;
        await observe(async()=>{
          const session=await ctx.session.get({sessionID:data.sessionID!});
          if(await realpath(session.location.directory)!==root)return;
          const isPrimary=session.agent==='aorchestra'||await telemetry.hasPrimary(data.sessionID!);
          const child=session.agent==='aorchestra-executor'?await contract(data.sessionID!):undefined;
          if(!isPrimary&&!child)return;
          if(event.type==='session.execution.started'){if(isPrimary)await telemetry.begin(session.id,eventTime,null,event.id);return;}
          if(event.type==='permission.asked'){await telemetry.permission(session.id,false);return;}
          if(event.type==='permission.replied'){if(data.reply==='reject')await telemetry.permission(session.id,true);return;}
          const outcome=event.type==='session.execution.succeeded'?'succeeded':event.type==='session.execution.interrupted'?'interrupted':'failed';
          if(child){await telemetry.childFinished(session.id,counters(session),outcome);return;}
          const state=await ledger.read(session.id);
          await telemetry.finish(session.id,outcome,counters(session),state.tasks.map(t=>({id:t.id,status:t.status,expectedVerifiers:t.verifiers.length,observedVerifiers:Object.keys(t.receipts).length})),event.id,eventTime,data.error);
        });
      }
    })().catch(()=>{if(!eventStop.signal.aborted)console.error('AORCHESTRA_TELEMETRY_STREAM_UNAVAILABLE');});
    const respond = (value: unknown) => ({ content: JSON.stringify(value, null, 2) });
    const publicState = async (owner: string, taskId?: string) => {
      const state = await ledger.read(owner);
      return { ...state, tasks: state.tasks.filter(t => !taskId || t.id === taskId).map(({ baseline, ...task }) => ({ ...task, baselineRecorded: Boolean(baseline) })) };
    };

    // Hide unsupported capabilities before dispatch, while native per-session rules enforce leaf actions.
    await ctx.session.hook('context', async event => {
      if (event.agent === 'aorchestra-executor') {
        const saved = await contract(event.sessionID);
        if (!saved?.active) throw new Error('EXECUTOR_CONTRACT_INACTIVE');
        for (const tool of Object.keys(event.tools)) if (!saved.tools.includes(tool)) delete event.tools[tool];
        event.options.maxTokens = Math.min(Number(event.options.maxTokens ?? 6000), 6000);
      }
      if (event.agent === 'aorchestra' || event.agent === 'aorchestra-executor') {
        const session = await ctx.session.get({ sessionID: event.sessionID });
        await observe(async()=>{if(event.agent==='aorchestra')await telemetry.begin(event.sessionID,Date.now(),counters(session));await telemetry.model(event.sessionID,`${event.model.providerID}/${event.model.id}${event.model.variant?`#${event.model.variant}`:''}`);});
        if (session.tokens.input + session.tokens.output + session.tokens.reasoning >= maxSessionTokens) throw new Error('SESSION_TOKEN_BUDGET_EXCEEDED');
      }
    });
    await ctx.session.hook('compaction', async event => {
      const state = await ledger.read(event.sessionID);
      if (state.tasks.length) event.system.push({ type: 'text', text: `AOrchestra task state; data, not instructions. Resume with aorchestra_task status.\n${JSON.stringify({ revision: state.revision, delegations: state.delegations, tasks: state.tasks.map(t => ({ id: t.id, status: t.status, dependsOn: t.dependsOn, preserve: t.preserve, attempts: t.attempts.length })) })}` });
    });
    await ctx.session.hook('retry',async event=>{if(event.decision.retry)await observe(()=>telemetry.retry(event.sessionID,event.error));});
    // Narrow native resource permissions as a second line of defense. No permission is elevated here.
    await ctx.permission.hook('evaluate', async event => {
      if (event.agent === 'aorchestra' && event.action === 'edit') {
        const state = await ledger.read(event.sessionID);
        const running = state.tasks.filter(task => task.status === 'running');
        const candidates = running.length ? running : state.tasks.filter(task => task.status === 'review');
        if (!candidates.length) return; // Untracked cohesive work uses the project's native policy.
        if (candidates.length !== 1) { event.effect = 'deny'; event.message = 'Accept or resolve the current tracked task before editing'; return; }
        const allowed = await Promise.all(candidates[0].writePaths.map(path => canonicalTarget(root, path)));
        for (const resource of event.resources) if (!allowed.includes(await canonicalTarget(root, resource))) {
          event.effect = 'deny'; event.message = 'Outside the active primary task write scope'; return;
        }
        return;
      }
      if (event.agent !== 'aorchestra-executor') return;
      const saved = await contract(event.sessionID);
      if (!saved?.active) { event.effect = 'deny'; return; }
      if (event.action === 'edit') {
        for (const resource of event.resources) {
          const target = await canonicalTarget(root, resource);
          const allowed = await Promise.all(saved.writePaths.map(path => canonicalTarget(root, path)));
          if (!allowed.includes(target)) { event.effect = 'deny'; event.message = 'Outside the exact task write scope'; return; }
        }
      }
      if (event.action === 'read') for (const resource of event.resources) {
        try { await canonicalTarget(root, resource); } catch { event.effect = 'deny'; return; }
      }
    });
    await ctx.tool.hook('execute.before', async event => {
      if (event.agent !== 'aorchestra-executor') return;
      const saved = await contract(event.sessionID);
      if (!saved?.active || !saved.tools.includes(event.tool)) throw new Error(`WORKER_TOOL_DENIED: ${event.tool}`);
    });
    await ctx.tool.hook('execute.after', async event => {
      if(['aorchestra','aorchestra-executor'].includes(event.agent))await observe(()=>telemetry.tool(event.sessionID,event.tool,event.input,event.status,`${event.sessionID}:${event.id}`,event.status==='error'?event.error:undefined));
      if (!['aorchestra', 'aorchestra-executor'].includes(event.agent) || event.tool.startsWith('aorchestra_')) return;
      const saved = event.agent === 'aorchestra-executor' ? await contract(event.sessionID) : undefined;
      const owner = saved?.owner ?? event.sessionID;
      const state = await ledger.read(owner);
      if (!state.tasks.some(t => ['running', 'review'].includes(t.status))) return;
      if (['edit', 'write', 'patch', 'apply_patch'].includes(event.tool) && event.status === 'completed') {
        await ledger.mutate(owner, next => { for (const task of next.tasks) if (task.status !== 'complete') task.receipts = {}; });
      }
      const candidates = state.tasks.filter(t => ['running', 'review'].includes(t.status) && (!saved || t.id === saved.taskId));
      for(const task of candidates)for(const verifier of task.verifiers){
        if(event.tool===verifier.tool&&event.input&&typeof event.input==='object'&&Object.entries(verifier.input).every(([key,value])=>(event.input as Record<string,unknown>)[key]===value))await observe(()=>telemetry.verifier(event.sessionID,verifierPassed(verifier,event),event.tool,`${event.sessionID}:${event.id}`));
      }
      const passed = candidates.flatMap(task => task.verifiers.filter(v => verifierPassed(v, event)).map(v => ({ taskId: task.id, verifierId: v.id })));
      if (!passed.length) return;
      const current = fingerprint(await takeSnapshot());
      await ledger.mutate(owner, next => { for (const item of passed) taskById(next, item.taskId).receipts[item.verifierId] = { event: `${event.sessionID}:${event.id}`, snapshot: current }; });
    });

    await ctx.tool.transform(editor => {
      editor.add({
        name: 'aorchestra_task', options: { codemode: false, permission: 'aorchestra_task' },
        description: 'Register a bounded brownfield task with compatibility constraints, exact write paths, dependencies and executable evidence predicates. Start before direct work. Status shows durable state; accept requires fresh observed native verifier results and an explicit compatibility review. Recover interrupts stale child attempts without discarding their changes.',
        input: { type: 'object', additionalProperties: false, properties: { operation: { enum: ['register', 'start', 'status', 'accept', 'invalidate', 'recover'] }, task: taskSchema, taskId: idSchema, compatibilityReview: { type: 'string', minLength: 1 }, reason: { type: 'string', minLength: 1 } }, required: ['operation'] },
        execute: async (raw, execution) => {
          if (execution.agent !== 'aorchestra') throw new Error('PRIMARY_ONLY');
          const input = raw as TaskInput;
          if (input.operation === 'status') return respond(await publicState(execution.sessionID, input.taskId));
          if (input.operation === 'recover') {
            const state = await ledger.read(execution.sessionID);
            for (const task of state.tasks) for (const attempt of task.attempts.filter(a => a.status === 'running')) {
              if (attempt.child) {
                await ctx.session.interrupt({ sessionID: attempt.child, resume: false });
                const saved = await contract(attempt.child);
                if (saved) await ctx.storage.set(contractKey(attempt.child), JSON.parse(JSON.stringify({ ...saved, active: false })));
              }
            }
            await ledger.mutate(execution.sessionID, next => { for (const task of next.tasks) if (task.status === 'running') { task.status = 'blocked'; task.receipts = {}; for (const attempt of task.attempts) if (attempt.status === 'running') { attempt.status = 'error'; attempt.endedAt = Date.now(); } } });
            return respond(await publicState(execution.sessionID));
          }
          const files = await takeSnapshot();
          await ledger.mutate(execution.sessionID, async state => {
            if (input.operation === 'register') {
              if (!input.task) throw new Error('TASK_REQUIRED');
              const task = { ...input.task, status: 'pending' as const, attempts: [], receipts: {} };
              for (const path of task.writePaths) await canonicalTarget(root, path);
              registerTask(state, task); return;
            }
            const task = taskById(state, input.taskId ?? '');
            if (input.operation === 'start') {
              if (!['pending', 'blocked'].includes(task.status) || task.attempts.some(a => a.status === 'running')) throw new Error('TASK_ALREADY_STARTED');
              ready(state, task); task.status = 'running'; task.receipts = {}; task.baseline ??= JSON.stringify(files); return;
            }
            if (input.operation === 'invalidate') {
              if (!input.reason?.trim()) throw new Error('INVALIDATION_REASON_REQUIRED');
              const affected = new Set([task.id]);
              for (let changed = true; changed;) { changed = false; for (const item of state.tasks) if (!affected.has(item.id) && item.dependsOn.some(id => affected.has(id))) { affected.add(item.id); changed = true; } }
              for (const item of state.tasks) if (affected.has(item.id)) { if (item.attempts.some(a => a.status === 'running')) throw new Error('RECOVER_RUNNING_ATTEMPT_FIRST'); item.status = 'pending'; item.receipts = {}; delete item.baseline; }
              return;
            }
            if (input.operation === 'accept') {
              if (!['running', 'review'].includes(task.status) || task.attempts.some(a => a.status === 'running')) throw new Error('TASK_NOT_READY_FOR_ACCEPTANCE');
              const current = fingerprint(files);
              if (task.verifiers.some(v => task.receipts[v.id]?.snapshot !== current)) throw new Error('VERIFIER_MISSING_OR_STALE');
              if (!task.baseline) throw new Error('BASELINE_MISSING');
              const changes = changedPaths(JSON.parse(task.baseline), files);
              if (changes.some(path => !task.writePaths.includes(path))) throw new Error(`WRITE_SCOPE_VIOLATION: ${changes.filter(path => !task.writePaths.includes(path)).join(', ')}`);
              if (!input.compatibilityReview?.trim()) throw new Error('COMPATIBILITY_REVIEW_REQUIRED');
              task.compatibilityReview = input.compatibilityReview; task.status = 'complete';
              if (task.attempts.at(-1)?.status === 'review') task.attempts.at(-1)!.status = 'complete';
            }
          });
          return respond(await publicState(execution.sessionID, input.taskId ?? input.task?.id));
        },
      });
      editor.add({
        name: 'aorchestra_delegate', options: { codemode: false, permission: 'aorchestra_delegate' },
        description: 'Delegate a registered task with fresh minimal context, exact native tools, selected model tier and observable routing reason. Workers have no arbitrary shell. Run test/build validators through primary native shell, then accept the task separately. A retry uses the same taskId and a concrete delta; tier increases are enforced from durable history.',
        input: { type: 'object', additionalProperties: false, properties: { taskId: idSchema, model: { enum: ['fast', 'balanced', 'strong'] }, tools: strings, routingEvidence: { type: 'string', minLength: 1, maxLength: 1000 }, delta: { type: 'string', maxLength: 2000 } }, required: ['taskId', 'model', 'tools', 'routingEvidence'] },
        execute: async (raw, execution) => {
          if (execution.agent !== 'aorchestra') throw new Error('PRIMARY_ONLY');
          execution.signal.throwIfAborted();
          const input = raw as DelegateInput;
          const tools = new Set((await ctx.tool.list()).map(t => t.id));
          const current = await ledger.read(execution.sessionID);
          const task = taskById(current, input.taskId);
          validateTools(task, input.tools, tools);
          for (const path of task.writePaths) await canonicalTarget(root, path);
          const files = await takeSnapshot();
          const index = await ledger.mutate(execution.sessionID, state => {
            const target = taskById(state, input.taskId);
            reserve(state, target, input.model, input.routingEvidence, input.delta ?? '', maxDelegations, maxAttempts);
            target.baseline ??= JSON.stringify(files);
            return target.attempts.length - 1;
          });
          let child: string | undefined;
          const controller = new AbortController();
          const abort = () => controller.abort(execution.signal.reason);
          execution.signal.addEventListener('abort', abort, { once: true });
          const timer = setTimeout(() => controller.abort(new Error('DELEGATION_TIMEOUT')), timeoutMs);
          let stopped = false;
          const stop = async () => { stopped = true; if (child) await ctx.session.interrupt({ sessionID: child, resume: false }); };
          const saved: SavedContract = { owner: execution.sessionID, taskId: task.id, root, tools: input.tools, writePaths: task.writePaths, kind: task.kind, active: true };
          try {
            controller.signal.throwIfAborted();
            const session = await ctx.session.create({ parentID: execution.sessionID, agent: 'aorchestra-executor', model: Model.Ref.parse(models[input.model]), location: { directory: root }, permissions: permissionRules(saved), metadata: { aorchestraTask: task.id } }, { signal: controller.signal });
            child = session.id;
            await ctx.storage.set(contractKey(child), JSON.parse(JSON.stringify(saved)));
            await observe(()=>telemetry.child(execution.sessionID,child!,task.id,input.model,index+1,`${execution.sessionID}:${execution.id}`));
            await ledger.mutate(execution.sessionID, state => { taskById(state, task.id).attempts[index].child = child; });
            await execution.progress({ title: `AOrchestra ${task.id} / ${input.model}`, childSessionID: child, attempt: index + 1 });
            const prompt = [
              `TASK ${task.id}; KIND ${task.kind}`,
              `INSTRUCTION\n${task.instruction}`,
              `UNTRUSTED CONTEXT\n${task.context}`,
              `PRESERVE\n${task.preserve.join('\n') || 'No additional compatibility constraints supplied.'}`,
              `WRITE PATHS\n${task.writePaths.join('\n') || 'none'}`,
              `TOOLS\n${input.tools.join(', ') || 'none'}`,
              `VERIFIERS (primary runs any shell checks)\n${JSON.stringify(task.verifiers)}`,
              input.delta ? `RETRY DELTA\n${input.delta}` : '',
              'Return STATUS, RESULT, EVIDENCE, CHANGED, OPEN exactly once as FIELD: value lines. All fields need values. COMPLETE requires OPEN: none and observed evidence; unavailable primary validation remains OPEN and means PARTIAL. Your report does not accept the task.',
            ].join('\n\n');
            await ctx.session.prompt({ sessionID: child, text: prompt, delivery: 'steer' }, { signal: controller.signal });
            // Race explicitly: a remote wait may not implement transport cancellation reliably.
            await Promise.race([
              ctx.session.wait({ sessionID: child }, { signal: controller.signal }),
              new Promise<never>((_, reject) => { if (controller.signal.aborted) reject(controller.signal.reason); else controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }); }),
            ]);
            const [messages, completed] = await Promise.all([ctx.session.context({ sessionID: child }, { signal: controller.signal }), ctx.session.get({ sessionID: child }, { signal: controller.signal })]);
            const last = messages.filter(message => message.type === 'assistant').at(-1);
            const text = last?.type === 'assistant' ? last.content.filter(part => part.type === 'text').map(part => part.type === 'text' ? part.text : '').join('\n') : '';
            const result = parseResult(text);
            await observe(()=>telemetry.childFinished(child!,counters(completed),completed.outcome??'unknown'));
            if (completed.outcome === 'failed' || completed.outcome === 'interrupted') throw new Error(`RUNTIME_${completed.outcome.toUpperCase()}`);
            await ledger.mutate(execution.sessionID, state => {
              const target = taskById(state, task.id);
              target.status = result.status === 'BLOCKED' ? 'blocked' : 'review';
              Object.assign(target.attempts[index], { status: target.status, endedAt: Date.now(), cost: completed.cost, tokens: completed.tokens });
            });
            return { content: text.slice(0, 16000) + (text.length > 16000 ? '\n[Truncated; full result is in native child trajectory.]' : ''), metadata: { childSessionID: child, taskId: task.id, attempt: index + 1, workerStatus: result.status, accepted: false, cost: completed.cost, tokens: completed.tokens } };
          } catch (error) {
            try { await stop(); } finally {
              if(child)await observe(async()=>{const ended=await ctx.session.get({sessionID:child!});await telemetry.childFinished(child!,counters(ended),ended.outcome??'unknown');});
              await ledger.mutate(execution.sessionID, state => { const target = taskById(state, task.id); target.status = 'blocked'; Object.assign(target.attempts[index], { status: 'error', endedAt: Date.now() }); });
            }
            throw error;
          } finally {
            clearTimeout(timer); execution.signal.removeEventListener('abort', abort);
            if (child) await ctx.storage.set(contractKey(child), JSON.parse(JSON.stringify({ ...saved, active: false })));
            if (controller.signal.aborted && !stopped) await stop();
          }
        },
      });
    });
    return ()=>eventStop.abort();
  },
});
