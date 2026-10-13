import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { Plugin } from '@opencode/plugin';
import plugin from '../plugins/aorchestra';
import { Ledger, type Handoff } from '../lib/core';

async function fixture(options: Record<string,unknown> = {}) {
  const scratch = resolve(import.meta.dir, '../work/aorchestra-v2-tests');
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'run-'));
  await writeFile(join(root, 'api.ts'), 'export const oldApi = true;\n');
  const data = new Map<string, unknown>();
  const hooks = new Map<string, (event: any) => Promise<void>>();
  const tools = new Map<string, any>();
  const creations: any[] = [];
  const interruptions: any[] = [];
  const prompts: any[] = [];
  let currentAgent='aorchestra';
  const skills: any[] = [];
  const rpc = new Map<string, any>();
  const events:any[]=[];
  let wake:(()=>void)|undefined;
  const ctx = {
    location: { directory: root }, options:{updateCheck:false,...options},
    storage: { get: async (key: string) => data.get(key), set: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); }, scan: async ({prefix,after,limit=100}:any) => { const keys=[...data.keys()].filter(k=>k.startsWith(prefix)&&(!after||k>after)).sort(); const selected=keys.slice(0,limit);return {entries:selected.map(key=>({key,value:data.get(key)})),next:keys.length>limit?selected.at(-1):undefined}; } },
    rpc: { register: async (definition:any,handlers:any) => {rpc.set(definition.id,handlers);} },
    event: {subscribe: async function*({signal}:any) {while(!signal.aborted){if(!events.length)await new Promise<void>(resolve=>{wake=resolve;signal.addEventListener('abort',resolve,{once:true});});if(signal.aborted)return;const event=events.shift();if(event)yield event;} }},
    session: {
      hook: async (name: string, callback: any) => { hooks.set(`session:${name}`, callback); },
      get: async ({sessionID}:any) => ({ id:sessionID,agent:sessionID==='primary'?currentAgent:'aorchestra-executor', location:{directory:root}, cost: 0.01, tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } }, outcome: 'succeeded' }),
      create: async (input: any) => { creations.push(input); return { id: `child-${creations.length}` }; },
      prompt: async (input:any) => {prompts.push(input);}, wait: async () => {}, interrupt: async (input:any) => {interruptions.push(input);},
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
    const task = { id: 'api', kind: 'change', instruction: 'Preserve API', context: '', handoff:{sources:[{ref:'api.ts',status:'observed',revision:'unknown'}],facts:['Existing oldApi export'],unknowns:[],checks:['Regression test not run']}, dependsOn: [], writePaths: ['api.ts'], preserve: ['oldApi export remains'], verifiers: [{ id: 'tests', tool: 'shell', input: { command: 'bun test api.test.ts' }, expect: { exitCode: 0 } }] };
  const register = () => invoke('aorchestra_task', { operation: 'register', task });
  const start = () => invoke('aorchestra_task', { operation: 'start', taskId: 'api' });
  const verify = (exitCode = 0, command = 'bun test api.test.ts') => hooks.get('tool:execute.after')!({ tool: 'shell', agent: 'aorchestra', sessionID: 'primary', id: 'verifier-1', input: { command }, status: 'completed', result: { metadata: { exitCode } } });
  const accept = () => invoke('aorchestra_task', { operation: 'accept', taskId: 'api', compatibilityReview: 'oldApi export preserved and focused test passed' });
  const clean = async () => { if(cleanup)await cleanup();if (!root.startsWith(`${scratch}\\`) && !root.startsWith(`${scratch}/`)) throw new Error('TEST_CLEANUP_ESCAPE'); await rm(root, { recursive: true }); };
  const emit=(event:any)=>{events.push(event);wake?.();};
  return { root, ctx, hooks, tools, data, creations, interruptions, prompts, skills, rpc,emit, invoke, register, start, verify, accept, clean, switchAgent:(agent:string)=>{currentAgent=agent;} };
}

test('bundled repo-context is available by explicit ID without automatic invocation', async () => {
  const f = await fixture(); try {
    expect(f.skills[0].id).toBe('aorchestra-repo-context');
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

test('legacy tasks require a handoff before spending budget; supplying it sends provenance to the child',async()=>{
  const f=await fixture();try{
    await f.register();
    const ledger=new Ledger(f.ctx.storage);
    await ledger.mutate('primary',state=>{delete state.tasks[0].handoff;});
    const call={taskId:'api',model:'fast',tools:['read'],routingEvidence:'Bounded known-file extraction'};
    await expect(f.invoke('aorchestra_delegate',call)).rejects.toThrow('HANDOFF_REQUIRED');
    expect(f.creations).toHaveLength(0);expect((await ledger.read('primary')).delegations).toBe(0);
    const handoff:Handoff={sources:[{ref:'api.ts',status:'observed',revision:'unknown'}],facts:['oldApi is exported'],unknowns:['Consumer behavior not inspected'],checks:['Regression check not run']};
    await f.invoke('aorchestra_delegate',{...call,handoff});
    expect(f.prompts[0].text).toContain(JSON.stringify(handoff));
    expect(f.prompts[0].text).toContain('SOURCE SNAPSHOT AT DELEGATION (not a Git revision)');
    expect((await ledger.read('primary')).tasks[0].handoff).toEqual(handoff);
  }finally{await f.clean();}
});

test('fast-to-strong retry propagates the reason and remains capped at two native children',async()=>{
  const f=await fixture();try{
    await f.register();const call={taskId:'api',tools:['read'],routingEvidence:'Known consumer and pattern'};
    await f.invoke('aorchestra_delegate',{...call,model:'fast'});
    await f.invoke('aorchestra_task',{operation:'repair',taskId:'api',reason:'Discovered another public consumer'});
    await expect(f.invoke('aorchestra_delegate',{...call,model:'strong',delta:'Discovered another consumer'})).rejects.toThrow('ESCALATION_REASON_REQUIRED');
    expect(f.creations).toHaveLength(1);
    await f.invoke('aorchestra_delegate',{...call,model:'strong',delta:'Discovered another public consumer',escalationReason:'compatibility-risk'});
    expect(f.creations).toHaveLength(2);expect(f.prompts[1].text).toContain('ESCALATION REASON\ncompatibility-risk');
    await f.invoke('aorchestra_task',{operation:'repair',taskId:'api',reason:'Another finding requires a retry'});
    await expect(f.invoke('aorchestra_delegate',{...call,model:'strong',delta:'Another finding'})).rejects.toThrow('BUDGET_EXCEEDED');
    expect(f.creations).toHaveLength(2);
  }finally{await f.clean();}
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

test('switching to Build hides harness tools and leaves compaction, retry and permissions alone',async()=>{
  const f=await fixture();try{
    await f.register();
    await f.hooks.get('session:context')!({agent:'aorchestra',sessionID:'primary',model:{providerID:'test',id:'main'},tools:{read:{}},options:{}});
    f.switchAgent('build');
    const tools={read:{},aorchestra_task:{},aorchestra_delegate:{},external_tool:{}};
    const options={maxTokens:321};
    await f.hooks.get('session:context')!({agent:'build',sessionID:'primary',tools,options});
    expect(Object.keys(tools)).toEqual(['read','external_tool']);expect(options.maxTokens).toBe(321);
    const system:unknown[]=[];
    await f.hooks.get('session:compaction')!({agent:'build',sessionID:'primary',system});expect(system).toEqual([]);
    const decision={retry:true,delay:10};await f.hooks.get('session:retry')!({agent:'build',sessionID:'primary',decision,error:'example'});expect(decision).toEqual({retry:true,delay:10});
    const permission={agent:'build',sessionID:'primary',action:'edit',resources:['other.ts'],effect:'allow'};
    await f.hooks.get('permission:evaluate')!(permission);expect(permission.effect).toBe('allow');
    const rows=(await f.rpc.get('aorchestra.metrics').list({})).runs;
    expect(rows).toHaveLength(1);expect(rows[0].observationIssue).toBe('agent-switched');expect(rows[0].endedAt).toBe(null);expect(rows[0].providerRetries).toBe(0);
  }finally{await f.clean();}
});

test('an active child loses tool access when its owner switches away from AOrchestra',async()=>{
  const f=await fixture();try{
    await f.register();
    f.ctx.session.wait=async()=>{
      f.switchAgent('build');
      await f.hooks.get('tool:execute.before')!({agent:'aorchestra-executor',sessionID:'child-1',tool:'patch'});
    };
    await expect(f.invoke('aorchestra_delegate',{taskId:'api',model:'fast',tools:['read','patch'],routingEvidence:'Known source'})).rejects.toThrow('AORCHESTRA_OWNER_INACTIVE');
    expect(await readFile(join(f.root,'api.ts'),'utf8')).toBe('export const oldApi = true;\n');
  }finally{await f.clean();}
});

test('Build context interrupts outstanding children and blocks stale primary work',async()=>{
  const f=await fixture();try{
    await f.register();const interrupted:string[]=[];
    f.ctx.session.interrupt=async input=>{interrupted.push(input.sessionID);return {interrupted:true};};
    f.ctx.session.wait=async()=>{
      f.switchAgent('build');
      await f.hooks.get('session:context')!({agent:'build',sessionID:'primary',tools:{},options:{}});
      await expect(f.hooks.get('tool:execute.before')!({agent:'aorchestra',sessionID:'primary',tool:'read'})).rejects.toThrow('AORCHESTRA_OWNER_INACTIVE');
    };
    await expect(f.invoke('aorchestra_delegate',{taskId:'api',model:'fast',tools:['read'],routingEvidence:'Known source'})).rejects.toThrow('AORCHESTRA_OWNER_INACTIVE');
    expect(interrupted).toContain('child-1');
    expect((await new Ledger(f.ctx.storage).read('primary')).tasks[0].status).toBe('blocked');
  }finally{await f.clean();}
});

test('all unrelated agents lose harness capabilities, not just Build',async()=>{
  const f=await fixture();try{
    for(const agent of ['build','plan','research','custom-agent']) {
      const tools={read:{},aorchestra_task:{},aorchestra_delegate:{}};
      await f.hooks.get('session:context')!({agent,sessionID:'other',tools,options:{}});
      expect(Object.keys(tools)).toEqual(['read']);
      await expect(f.hooks.get('tool:execute.before')!({agent,sessionID:'other',tool:'aorchestra_task'})).rejects.toThrow('AORCHESTRA_INACTIVE_FOR_AGENT');
      const permission={agent,sessionID:'other',action:'skill',resources:['aorchestra-repo-context'],effect:'allow'};
      await f.hooks.get('permission:evaluate')!(permission);expect(permission.effect).toBe('deny');
    }
    expect((await f.rpc.get('aorchestra.metrics').list({})).runs).toHaveLength(0);
  }finally{await f.clean();}
});


test('project-aware acceptance requires discovered checks and records native outcomes',async()=>{
  const f=await fixture();try{
    await writeFile(join(f.root,'package.json'),JSON.stringify({scripts:{test:'node --test'}}));
    await f.register();await f.start();
    await f.verify();await expect(f.accept()).rejects.toThrow('VERIFIER_MISSING_OR_STALE');
    await f.verify(0,'npm run test');
    const completed=JSON.parse((await f.accept()).content).tasks[0];
    expect(completed.workflow.phase).toBe('complete');
    expect(completed.workflow.events.map((e:any)=>e.phase)).toEqual(['plan','execute','verify','complete']);
    expect(completed.verification.observations[completed.verification.verifiers[0].id].passed).toBe(true);
  }finally{await f.clean();}
});

test('failed native rerun revokes a previous successful receipt on the same source snapshot',async()=>{
  const f=await fixture();try{
    await f.register();await f.start();await f.verify();await f.verify(1);
    await expect(f.accept()).rejects.toThrow('VERIFIER_MISSING_OR_STALE');
    const state=(await new Ledger(f.ctx.storage).read('primary')).tasks[0];
    expect(state.receipts.tests).toBeUndefined();expect(state.verification!.observations.tests.passed).toBe(false);
  }finally{await f.clean();}
});

test('a matching root package command in another package cannot accept or revoke root evidence',async()=>{
  const f=await fixture();try {
    await writeFile(join(f.root,'package.json'),JSON.stringify({scripts:{test:'node --test'}}));
    await mkdir(join(f.root,'other'));
    await writeFile(join(f.root,'other/package.json'),JSON.stringify({scripts:{test:'node --test'}}));
    await f.register();await f.start();await f.verify();
    const ledger=new Ledger(f.ctx.storage);
    const generated=(await ledger.read('primary')).tasks[0].verification!.verifiers[0];
    expect(generated.input.workdir).toBe(f.root);
    const outcome=(exitCode:number,workdir:string)=>f.hooks.get('tool:execute.after')!({tool:'shell',agent:'aorchestra',sessionID:'primary',id:`workdir-${exitCode}`,input:{command:'npm run test',workdir},status:'completed',result:{metadata:{exitCode}}});
    await outcome(0,join(f.root,'other'));
    await expect(f.accept()).rejects.toThrow('VERIFIER_MISSING_OR_STALE');
    expect((await ledger.read('primary')).tasks[0].receipts[generated.id]).toBeUndefined();
    await outcome(0,f.root);await f.accept();
    await outcome(1,join(f.root,'other'));
    expect((await ledger.read('primary')).tasks[0].status).toBe('complete');
    await outcome(1,f.root);
    expect((await ledger.read('primary')).tasks[0].status).toBe('blocked');
  }finally{await f.clean();}
});

test('failed DIRECT verification cannot recover, restart or invalidate around bounded repairs',async()=>{
  const f=await fixture({maxRepairs:2});try {
    await f.register();await f.start();
    const ledger=new Ledger(f.ctx.storage);
    for(let cycle=0;cycle<2;cycle++) {
      await f.verify(1);
      await f.invoke('aorchestra_task',{operation:'recover'});
      const before=await ledger.read('primary');
      expect(before.tasks[0].workflow!.repairRequired).toBe(true);
      expect(before.tasks[0].workflow!.repairs).toBe(cycle);
      const cleanup=await plugin.setup(f.ctx);
      try {
        await f.invoke('aorchestra_task',{operation:'resume',taskId:'api'});
        expect(await ledger.read('primary')).toEqual(before);
        await expect(f.start()).rejects.toThrow('BEGIN_REPAIR_BEFORE_RESTART');
        await expect(f.invoke('aorchestra_task',{operation:'plan',taskId:'api'})).rejects.toThrow('BEGIN_REPAIR_BEFORE_RESTART');
        await expect(f.invoke('aorchestra_delegate',{taskId:'api',model:'fast',tools:['read'],routingEvidence:'Retry known-file inspection',delta:'Observed failing verifier'})).rejects.toThrow('BEGIN_REPAIR_BEFORE_RESTART');
        await f.invoke('aorchestra_task',{operation:'repair',taskId:'api',reason:`Observed failure ${cycle+1}`});
        const task=(await ledger.read('primary')).tasks[0];
        expect(task.workflow!.repairs).toBe(cycle+1);
        expect(task.workflow!.repairRequired).toBeUndefined();
      }finally{if(cleanup)await cleanup();}
    }
    await f.verify(1);await f.invoke('aorchestra_task',{operation:'recover'});
    await expect(f.start()).rejects.toThrow('REPAIR_BUDGET_EXCEEDED');
    const exhausted=JSON.parse((await f.invoke('aorchestra_task',{operation:'repair',taskId:'api',reason:'Third failure'})).content).tasks[0];
    expect(exhausted.status).toBe('blocked');expect(exhausted.workflow.repairs).toBe(2);
    await f.invoke('aorchestra_task',{operation:'invalidate',taskId:'api',reason:'Reinspect assumptions'});
    expect((await ledger.read('primary')).tasks[0].workflow!.repairRequired).toBe(true);
    await expect(f.start()).rejects.toThrow('REPAIR_BUDGET_EXCEEDED');
    expect(f.creations).toHaveLength(0);
  }finally{await f.clean();}
});

test('invalidation cannot discard a pending repair obligation before the budget is exhausted',async()=>{
  const f=await fixture();try {
    await f.register();await f.start();await f.verify(1);
    await f.invoke('aorchestra_task',{operation:'invalidate',taskId:'api',reason:'Refresh the plan after failure'});
    await expect(f.start()).rejects.toThrow('BEGIN_REPAIR_BEFORE_RESTART');
    await expect(f.invoke('aorchestra_delegate',{taskId:'api',model:'fast',tools:['read'],routingEvidence:'Retry lookup'})).rejects.toThrow('BEGIN_REPAIR_BEFORE_RESTART');
    await f.invoke('aorchestra_task',{operation:'repair',taskId:'api',reason:'Reinspect failed contract with a new baseline'});
    await f.verify();await f.accept();
    const repaired=(await new Ledger(f.ctx.storage).read('primary')).tasks[0];
    expect(repaired.workflow!.repairs).toBe(1);expect(repaired.status).toBe('complete');
  }finally{await f.clean();}
});

test('bounded direct repairs protect edit permissions and cannot restart or invalidate away exhaustion',async()=>{
  const f=await fixture({maxRepairs:2});try{
    await f.register();await f.start();await f.verify(1);
    const edit={agent:'aorchestra',sessionID:'primary',action:'edit',resources:['api.ts'],effect:'allow'};
    await f.hooks.get('permission:evaluate')!(edit);expect(edit.effect).toBe('deny');
    for(let cycle=0;cycle<2;cycle++){
      await f.invoke('aorchestra_task',{operation:'repair',taskId:'api',reason:`Observed failure ${cycle+1}`});
      const allowed={...edit,effect:'allow'};await f.hooks.get('permission:evaluate')!(allowed);expect(allowed.effect).toBe('allow');
      await f.verify(1);
    }
    const blocked=JSON.parse((await f.invoke('aorchestra_task',{operation:'repair',taskId:'api',reason:'Third failure'})).content).tasks[0];
    expect(blocked.status).toBe('blocked');expect(blocked.workflow.repairs).toBe(2);
    await expect(f.start()).rejects.toThrow('REPAIR_BUDGET_EXCEEDED');
    await f.invoke('aorchestra_task',{operation:'invalidate',taskId:'api',reason:'Reinspect assumptions'});
    await expect(f.start()).rejects.toThrow('REPAIR_BUDGET_EXCEEDED');
  }finally{await f.clean();}
});

test('resume after plugin restart preserves baseline, events, budgets and pending configured native checks',async()=>{
  const check={id:'configured',tool:'shell',input:{command:'node integration.test.js'},expect:{exitCode:0}};
  const f=await fixture({verification:[{paths:['api.ts'],verifiers:[check]}]});try{
    await f.register();await f.start();
    await f.invoke('aorchestra_task',{operation:'verify',taskId:'api'});
    const before=await new Ledger(f.ctx.storage).read('primary');
    const cleanup=await plugin.setup(f.ctx);
    try{
      const resumed=JSON.parse((await f.invoke('aorchestra_task',{operation:'resume',taskId:'api'})).content);
      expect(resumed.tasks[0].pendingVerifiers.map((v:any)=>v.input.command)).toEqual(['bun test api.test.ts','node integration.test.js']);
      expect(await new Ledger(f.ctx.storage).read('primary')).toEqual(before);
      expect(f.creations).toHaveLength(0);
      const system:any[]=[];
      await f.hooks.get('session:context')!({agent:'aorchestra',sessionID:'primary',model:{providerID:'test',id:'main'},tools:{shell:{}},options:{},system});
      expect(system[0].text).toContain('node integration.test.js');
      expect((await new Ledger(f.ctx.storage).read('primary')).delegations).toBe(0);
    }finally{if(cleanup)await cleanup();}
  }finally{await f.clean();}
});

test('failed or unverifiable reruns revoke accepted work and survive restart without restoring evidence',async()=>{
  for(const missingExit of [false,true]) {
    const f=await fixture();try {
      await f.register();await f.start();await f.verify();await f.accept();
      const ledger=new Ledger(f.ctx.storage);
      const before=(await ledger.read('primary')).tasks[0];
      await f.verify(1,'unrelated command');
      expect((await ledger.read('primary')).tasks[0].status).toBe('complete');
      await f.verify();expect((await ledger.read('primary')).tasks[0].receipts).toEqual(before.receipts);
      if(missingExit)await f.hooks.get('tool:execute.after')!({tool:'shell',agent:'aorchestra',sessionID:'primary',id:'missing-exit',input:{command:'bun test api.test.ts'},status:'completed',result:{metadata:{}}});
      else await f.verify(1);
      const revoked=(await ledger.read('primary')).tasks[0];
      expect(revoked.status).toBe('blocked');expect(revoked.workflow!.phase).toBe('blocked');
      expect(revoked.receipts).toEqual({});expect(revoked.compatibilityReview).toBeUndefined();
      expect(revoked.baseline).toBe(before.baseline!);expect(revoked.attempts).toEqual(before.attempts);
      expect(revoked.verification!.observations.tests.passed).toBe(false);
      const system:any[]=[];
      await f.hooks.get('session:context')!({agent:'aorchestra',sessionID:'primary',model:{providerID:'test',id:'main'},tools:{shell:{}},options:{},system});
      expect(system[0].text).toContain('"phase":"blocked"');expect(system[0].text).toContain('Accepted evidence revoked');
      const cleanup=await plugin.setup(f.ctx);
      try {
        await f.invoke('aorchestra_task',{operation:'resume',taskId:'api'});
        await f.verify();expect((await ledger.read('primary')).tasks[0]).toEqual(revoked);
        await expect(f.start()).rejects.toThrow('BEGIN_REPAIR_BEFORE_RESTART');
        await f.invoke('aorchestra_task',{operation:'repair',taskId:'api',reason:'Accepted verifier failed; recheck before acceptance'});
        await expect(f.accept()).rejects.toThrow('VERIFIER_MISSING_OR_STALE');
        await f.verify();await f.accept();expect((await ledger.read('primary')).tasks[0].status).toBe('complete');
      }finally{if(cleanup)await cleanup();}
    }finally{await f.clean();}
  }
});

test('accepted evidence revocation blocks transitive dependents and stops active native children',async()=>{
  const f=await fixture();try {
    await f.register();await f.start();await f.verify();await f.accept();
    for(const [id,dependsOn] of [['consumer',['api']],['downstream',['consumer']]] as const) {
      await f.invoke('aorchestra_task',{operation:'register',task:{id,kind:'analysis',instruction:'Inspect consumers',context:'',dependsOn:[...dependsOn],writePaths:[],preserve:[],verifiers:[{id:'read',tool:'read',input:{filePath:'api.ts'},expect:{contains:'oldApi'}}]}});
    }
    const ledger=new Ledger(f.ctx.storage);
    await ledger.mutate('primary',state=>{
      state.delegations=2;
      const consumer=state.tasks[1];consumer.status='complete';consumer.workflow!.phase='complete';consumer.compatibilityReview='Reviewed';consumer.baseline=state.tasks[0].baseline;consumer.workflow!.repairs=1;consumer.receipts={read:state.tasks[0].receipts.tests};
      const downstream=state.tasks[2];downstream.status='running';downstream.workflow!.phase='execute';downstream.baseline=state.tasks[0].baseline;downstream.workflow!.repairs=2;
      downstream.attempts.push({tier:'balanced',reason:'Independent check',delta:'',child:'active-child',status:'running',startedAt:1});
    });
    await f.ctx.storage.set('child/active-child',{owner:'primary',taskId:'downstream',root:f.root,tools:['read'],writePaths:[],kind:'analysis',active:true});
    await f.verify(1);
    const state=await ledger.read('primary');
    expect(state.tasks.map(t=>t.status)).toEqual(['blocked','blocked','blocked']);
    expect(state.tasks.map(t=>t.receipts)).toEqual([{},{},{}]);
    expect(state.tasks.map(t=>t.compatibilityReview)).toEqual([undefined,undefined,undefined]);
    expect(state.tasks.map(t=>t.workflow!.repairs)).toEqual([0,1,2]);expect(state.delegations).toBe(2);
    expect(state.tasks[2].attempts[0].status).toBe('error');expect(state.tasks[2].baseline).toBe(state.tasks[0].baseline!);
    expect(f.interruptions).toEqual([{sessionID:'active-child',resume:false}]);
    expect((await f.ctx.storage.get('child/active-child') as any).active).toBe(false);
    await expect(f.invoke('aorchestra_task',{operation:'start',taskId:'consumer'})).rejects.toThrow('DEPENDENCY_UNMET');
    await expect(f.hooks.get('tool:execute.before')!({agent:'aorchestra-executor',sessionID:'active-child',tool:'read'})).rejects.toThrow('WORKER_TOOL_DENIED');
  }finally{await f.clean();}
});

test('a late native child result cannot restore review after dependency evidence was revoked',async()=>{
  const f=await fixture();let release=()=>{};try {
    await f.register();await f.start();await f.verify();await f.accept();
    await f.invoke('aorchestra_task',{operation:'register',task:{id:'consumer',kind:'analysis',instruction:'Inspect consumers',context:'',handoff:{sources:[{ref:'api.ts',status:'observed',revision:'unknown'}],facts:[],unknowns:[],checks:[]},dependsOn:['api'],writePaths:[],preserve:[],verifiers:[{id:'read',tool:'read',input:{filePath:'api.ts'},expect:{contains:'oldApi'}}]}});
    let waiting=()=>{};const entered=new Promise<void>(resolve=>{waiting=resolve;});
    const gate=new Promise<void>(resolve=>{release=resolve;});
    f.ctx.session.wait=async()=>{waiting();await gate;};
    const delegated=f.invoke('aorchestra_delegate',{taskId:'consumer',model:'balanced',tools:['read'],routingEvidence:'Bounded consumer analysis'}).catch((error:Error)=>error);
    await entered;await f.verify(1);
    const before=await new Ledger(f.ctx.storage).read('primary');
    release();const result=await delegated;
    expect(result).toBeInstanceOf(Error);expect(result.message).toBe('DELEGATION_REVOKED');
    const after=await new Ledger(f.ctx.storage).read('primary');
    expect(after.tasks).toEqual(before.tasks);expect(after.delegations).toBe(before.delegations);
    expect((await f.ctx.storage.get('child/child-1') as any).active).toBe(false);
  }finally{release();await f.clean();}
});

test('bundled improvement skill is explicit-only and unrelated agents cannot invoke it',async()=>{
  const f=await fixture();try{
    const skill=f.skills.find(s=>s.id==='aorchestra-improve');
    expect(skill.autoinvoke).toBe(false);expect(skill.path).toContain('improve');
    expect(skill.content.startsWith('---')).toBe(false);
    for(const agent of ['build','plan','research','custom-agent']) {
      const permission={agent,sessionID:'other',action:'skill',resources:['aorchestra-improve'],effect:'allow'};
      await f.hooks.get('permission:evaluate')!(permission);expect(permission.effect).toBe('deny');
    }
    const permission={agent:'aorchestra',sessionID:'primary',action:'skill',resources:['aorchestra-improve'],effect:'allow'};
    await f.hooks.get('permission:evaluate')!(permission);expect(permission.effect).toBe('allow');
  }finally{await f.clean();}
});
