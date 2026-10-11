import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { Plugin } from '@opencode/plugin';
import plugin from '../plugins/aorchestra';

async function fixture() {
  const scratch = resolve(import.meta.dir, '../../../work/aorchestra-v2-tests');
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'run-'));
  await writeFile(join(root, 'api.ts'), 'export const oldApi = true;\n');
  const data = new Map<string, unknown>();
  const hooks = new Map<string, (event: any) => Promise<void>>();
  const tools = new Map<string, any>();
  const creations: any[] = [];
  const skills: any[] = [];
  const rpc = new Map<string, any>();
  const events:any[]=[];
  let wake:(()=>void)|undefined;
  const ctx = {
    location: { directory: root }, options: {},
    storage: { get: async (key: string) => data.get(key), set: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); }, scan: async ({prefix,after,limit=100}:any) => { const keys=[...data.keys()].filter(k=>k.startsWith(prefix)&&(!after||k>after)).sort(); const selected=keys.slice(0,limit);return {entries:selected.map(key=>({key,value:data.get(key)})),next:keys.length>limit?selected.at(-1):undefined}; } },
    rpc: { register: async (definition:any,handlers:any) => {rpc.set(definition.id,handlers);} },
    event: {subscribe: async function*({signal}:any) {while(!signal.aborted){if(!events.length)await new Promise<void>(resolve=>{wake=resolve;signal.addEventListener('abort',resolve,{once:true});});if(signal.aborted)return;const event=events.shift();if(event)yield event;} }},
    session: {
      hook: async (name: string, callback: any) => { hooks.set(`session:${name}`, callback); },
      get: async ({sessionID}:any) => ({ id:sessionID,agent:sessionID==='primary'?'aorchestra':'aorchestra-executor', location:{directory:root}, cost: 0.01, tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } }, outcome: 'succeeded' }),
      create: async (input: any) => { creations.push(input); return { id: 'child-1' }; },
      prompt: async () => {}, wait: async () => {}, interrupt: async () => {},
      context: async () => [{ type: 'assistant', content: [{ type: 'text', text: 'STATUS: PARTIAL\nRESULT: investigated\nEVIDENCE: read api.ts\nCHANGED: none\nOPEN: primary validation' }] }],
    },
    permission: { hook: async (name: string, callback: any) => { hooks.set(`permission:${name}`, callback); } },
    skill: { transform: async (callback: any) => callback({ add: (skill: any) => skills.push(skill) }) },
    tool: { hook: async (name: string, callback: any) => { hooks.set(`tool:${name}`, callback); },
      list: async () => ['read', 'patch', 'shell', 'execute'].map(id => ({ id })),
      transform: async (callback: any) => callback({ add: (tool: any) => tools.set(tool.name, tool) }),
    },
  } as unknown as Plugin.Context;
  const cleanup=await plugin.setup(ctx);
  const execution = { sessionID: 'primary', agent: 'aorchestra', signal: new AbortController().signal, progress: async () => {} };
  const invoke = (name: string, input: unknown) => tools.get(name).execute(input, execution);
  const task = { id: 'api', kind: 'change', instruction: 'Preserve API', context: '', dependsOn: [], writePaths: ['api.ts'], preserve: ['oldApi export remains'], verifiers: [{ id: 'tests', tool: 'shell', input: { command: 'bun test api.test.ts' }, expect: { exitCode: 0 } }] };
  const register = () => invoke('aorchestra_task', { operation: 'register', task });
  const start = () => invoke('aorchestra_task', { operation: 'start', taskId: 'api' });
  const verify = (exitCode = 0, command = 'bun test api.test.ts') => hooks.get('tool:execute.after')!({ tool: 'shell', agent: 'aorchestra', sessionID: 'primary', id: 'verifier-1', input: { command }, status: 'completed', result: { metadata: { exitCode } } });
  const accept = () => invoke('aorchestra_task', { operation: 'accept', taskId: 'api', compatibilityReview: 'oldApi export preserved and focused test passed' });
  const clean = async () => { if(cleanup)await cleanup();if (!root.startsWith(`${scratch}\\`) && !root.startsWith(`${scratch}/`)) throw new Error('TEST_CLEANUP_ESCAPE'); await rm(root, { recursive: true }); };
  const emit=(event:any)=>{events.push(event);wake?.();};
  return { root, ctx, hooks, tools, data, creations, skills, rpc,emit, invoke, register, start, verify, accept, clean };
}

test('bundled repo-context is available by explicit ID without automatic invocation', async () => {
  const f = await fixture(); try {
    expect(f.skills[0].id).toBe('repo-context');
    expect(f.skills[0].autoinvoke).toBe(false);
    expect(f.skills[0].path).toContain('skills');
    expect(f.skills[0].content.startsWith('---')).toBe(false);
  } finally { await f.clean(); }
});
test('native primary edits are denied outside a tracked task before filesystem mutation', async () => {
  const f = await fixture(); try {
    await f.register(); await f.start();
    const forbidden = { agent: 'aorchestra', sessionID: 'primary', action: 'edit', resources: ['unrelated.ts'], effect: 'allow' };
    await f.hooks.get('permission:evaluate')!(forbidden);
    expect(forbidden.effect).toBe('deny');
    const allowed = { ...forbidden, resources: ['api.ts'], effect: 'allow' };
    await f.hooks.get('permission:evaluate')!(allowed);
    expect(allowed.effect).toBe('allow');
  } finally { await f.clean(); }
});

test('actual plugin flow accepts fresh matching verifier, not failed or unrelated shell', async () => {
  const f = await fixture(); try {
    await f.register(); await f.start();
    await f.verify(1); await expect(f.accept()).rejects.toThrow('VERIFIER_MISSING_OR_STALE');
    await f.verify(0, 'echo passed'); await expect(f.accept()).rejects.toThrow('VERIFIER_MISSING_OR_STALE');
    await f.verify(0); const result = await f.accept(); expect(result.content).toContain('"status": "complete"');
  } finally { await f.clean(); }
});
test('external source mutation after native verifier makes evidence stale', async () => {
  const f = await fixture(); try {
    await f.register(); await f.start(); await f.verify();
    await writeFile(join(f.root, 'api.ts'), 'export const oldApi = false;\n');
    await expect(f.accept()).rejects.toThrow('VERIFIER_MISSING_OR_STALE');
  } finally { await f.clean(); }
});
test('acceptance rejects observed changes outside exact task scope', async () => {
  const f = await fixture(); try {
    await f.register(); await f.start(); await writeFile(join(f.root, 'unrelated.ts'), 'unauthorized'); await f.verify();
    await expect(f.accept()).rejects.toThrow('WRITE_SCOPE_VIOLATION');
  } finally { await f.clean(); }
});
test('restarting an active task cannot replace its baseline or hide changes', async () => {
  const f = await fixture(); try {
    await f.register(); await f.start(); await expect(f.start()).rejects.toThrow('TASK_ALREADY_STARTED');
  } finally { await f.clean(); }
});
test('delegate creates native session with permissions and returns unaccepted review', async () => {
  const f = await fixture(); try {
    await f.register();
    const result = await f.invoke('aorchestra_delegate', { taskId: 'api', model: 'fast', tools: ['read', 'patch'], routingEvidence: 'Known path, exact pattern, focused verifier' });
    expect(f.creations[0].permissions[0].effect).toBe('deny');
    expect(f.creations[0].permissions.some((r: any) => r.action === 'shell' && r.effect === 'allow')).toBe(false);
    expect(result.metadata.accepted).toBe(false); expect(result.metadata.attempt).toBe(1);
    await expect(f.hooks.get('tool:execute.before')!({ agent: 'aorchestra-executor', sessionID: 'child-1', tool: 'patch' })).rejects.toThrow('WORKER_TOOL_DENIED');
    // The same durable contract remains inactive after setup is re-created.
    const secondCleanup=await plugin.setup(f.ctx);
    await expect(f.hooks.get('session:context')!({ agent: 'aorchestra-executor', sessionID: 'child-1', tools: {} })).rejects.toThrow('EXECUTOR_CONTRACT_INACTIVE');
    if(secondCleanup)await secondCleanup();
  } finally { await f.clean(); }
});

test('DIRECT without ledger is recorded on a native terminal event, without semantic success claims', async () => {
  const f=await fixture();try{
    await f.hooks.get('session:context')!({agent:'aorchestra',sessionID:'primary',model:{providerID:'test',id:'fast'},tools:{read:{}},options:{}});
    await f.hooks.get('tool:execute.after')!({agent:'aorchestra',sessionID:'primary',tool:'read',input:{filePath:'api.ts'},status:'completed',id:'read-1',result:{content:'observed'}});
    f.emit({type:'session.execution.succeeded',id:'terminal',created:Date.now(),location:{directory:f.root},data:{sessionID:'primary'}});
    let rows:any[]=[];
    for(let attempt=0;attempt<50;attempt++){rows=(await f.rpc.get('aorchestra.metrics').list({})).runs.filter((r:any)=>r.endedAt!==null);if(rows.length)break;await new Promise(resolve=>setTimeout(resolve,2));}
    expect(rows.length).toBe(1);expect(rows[0].children).toEqual([]);expect(rows[0].tasks).toEqual([]);expect(rows[0].tools.read).toBe(1);
    expect(rows[0].runtimeOutcome).toBe('succeeded');
  }finally{await f.clean();}
});
test('cancelled parent does not reserve budget or create a child', async () => {
  const f = await fixture(); try {
    await f.register(); const controller = new AbortController(); controller.abort();
    await expect(f.tools.get('aorchestra_delegate').execute({ taskId: 'api', model: 'fast', tools: ['read'], routingEvidence: 'Known path' }, { sessionID: 'primary', agent: 'aorchestra', signal: controller.signal, progress: async () => {} })).rejects.toThrow();
    expect(f.creations.length).toBe(0);
  } finally { await f.clean(); }
});
