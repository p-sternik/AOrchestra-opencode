import { expect,test } from 'bun:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Telemetry,counters,delta,type Counters } from '../lib/telemetry';
import {aggregate,markdown,workflowEstimate} from '../lib/report';
const count=(cost=0,input=0):Counters=>({cost,input,output:0,reasoning:0,cacheRead:0,cacheWrite:0});
function fixture(){const data=new Map<string,unknown>();const storage={get:async(key:string)=>data.get(key),set:async(key:string,value:unknown)=>{data.set(key,structuredClone(value));},scan:async({prefix,after,limit=100}:{prefix:string;after?:string;limit?:number})=>{const keys=[...data.keys()].filter(k=>k.startsWith(prefix)&&(!after||k>after)).sort();const selected=keys.slice(0,limit);return {entries:selected.map(key=>({key,value:data.get(key)})),next:keys.length>limit?selected.at(-1):undefined};}};return {data,storage,metrics:new Telemetry(storage)};}
test('native missing and reset usage stay unknown, while measured zero stays zero',()=>{
  expect(counters({}).cost).toBe(null);expect(delta(count(5),count(3)).cost).toBe(null);expect(delta(count(0),count(0)).cost).toBe(0);expect(delta(null,count()).input).toBe(null);
});
test('multiple native cycles in one session use deltas, not cumulative costs',async()=>{
  const f=fixture();await f.metrics.begin('primary',1,count(1,10));await f.metrics.finish('primary','succeeded',count(3,30),[],'end-1',2);
  await f.metrics.begin('primary',3,count(3,30));await f.metrics.finish('primary','succeeded',count(4,40),[],'end-2',4);
  const rows=(await f.metrics.page()).runs;expect(rows.map(r=>r.primaryUsage!.cost)).toEqual([2,1]);expect(rows.map(r=>r.primaryUsage!.input)).toEqual([20,10]);
});
test('telemetry aggregates child usage exactly once and keeps failed child usage',async()=>{
  const f=fixture();await f.metrics.begin('primary',1,count());await f.metrics.child('primary','child','fix','fast',1,'parent:delegate');
  await f.metrics.childFinished('child',count(2,20),'failed');await f.metrics.childFinished('child',count(2,20),'failed');
  await f.metrics.finish('primary','failed',count(1,10),[],'end',2);const r=(await f.metrics.page()).runs[0];expect(r.children.length).toBe(1);expect(workflowEstimate(r)).toBe(3);expect(r.children[0].outcome).toBe('failed');
});
test('unknown child cost makes whole-workflow estimate unknown',async()=>{
  const f=fixture();await f.metrics.begin('primary',1,count());await f.metrics.child('primary','child','fix','fast',1,'ref');await f.metrics.finish('primary','failed',count(1),[],'end',2);
  expect(workflowEstimate((await f.metrics.page()).runs[0])).toBe(null);
});
test('duplicate terminal notifications cannot duplicate a run',async()=>{
  const f=fixture();await f.metrics.begin('primary',1,count());await f.metrics.finish('primary','succeeded',count(),[],'end',2);expect(await f.metrics.finish('primary','succeeded',count(),[],'end',2)).toBe(false);expect((await f.metrics.page()).runs.length).toBe(1);
});
test('collector persists observations without copying raw prompts, arguments or errors',async()=>{
  const f=fixture();await f.metrics.begin('primary',1,count());await f.metrics.tool('primary','read',{query:'secret-credential-example'},'error','ref','PERMISSION_DENIED secret-credential-example');
  await f.metrics.finish('primary','failed',count(),[],'end',2);const output=JSON.stringify((await f.metrics.page()).runs);expect(output).not.toContain('secret-credential-example');expect(output).toContain('permission');
});
test('restart preserves active run and late child events cannot contaminate another run',async()=>{
  const f=fixture();await f.metrics.begin('primary',1,count());await f.metrics.child('primary','child','fix','fast',1,'ref');const resumed=new Telemetry(f.storage);
  await resumed.finish('primary','interrupted',count(),[],'end',2);await resumed.begin('primary',3,count());await resumed.tool('child','read',{file:'api.ts'},'completed','late');
  const active=(await resumed.page()).runs.find(r=>r.endedAt===null)!;expect(active.tools).toEqual({});
});
test('DIRECT native success stays semantically unverified; verified acceptance is separate',async()=>{
  const f=fixture();await f.metrics.begin('primary',1,count());await f.metrics.finish('primary','succeeded',count(),[],'end',2);
  const report=aggregate((await f.metrics.page()).runs);expect(report.groups[0].nativeSucceeded).toBe(1);expect(report.groups[0].verifiedTrackedRuns).toBe(0);expect(report.groups[0].untrackedOutcome).toBe(1);
});
test('recurring patterns yield evidence-backed hypotheses without changing source records',async()=>{
  const f=fixture();for(let n=0;n<3;n++){await f.metrics.begin('primary',n*10,count());await f.metrics.tool('primary','read',{file:'api.ts'},'completed','ref');await f.metrics.child('primary',`child-${n}`,'fix','fast',1,'ref');await f.metrics.tool(`child-${n}`,'read',{file:'api.ts'},'completed','ref');await f.metrics.finish('primary','succeeded',count(),[],'end',n*10+1);}
  const rows=(await f.metrics.page()).runs,original=JSON.stringify(rows);const report=aggregate(rows);expect(report.hypotheses.length).toBe(1);expect(report.hypotheses[0].evidence.length).toBe(3);expect(JSON.stringify(rows)).toBe(original);expect(markdown(report)).toContain('No prompt, model policy, permission or skill is modified');
});
test('pagination exports all records and repeated imports are deduplicated',async()=>{
  const f=fixture();for(let n=0;n<3;n++){await f.metrics.begin('primary',n*10,count());await f.metrics.finish('primary','succeeded',count(),[],'end',n*10+1);}
  const first=await f.metrics.page(undefined,2),second=await f.metrics.page(first.next!,2);expect(aggregate([...first.runs,...first.runs,...second.runs]).totalRuns).toBe(3);
});
test('observed failed verifiers are recorded even when the tool itself completed',async()=>{
  const f=fixture();await f.metrics.begin('primary',1,count());await f.metrics.verifier('primary',false,'shell','test-call');await f.metrics.verifier('primary',true,'shell','recovered-call');await f.metrics.finish('primary','succeeded',count(),[],'end',2);
  const report=aggregate((await f.metrics.page()).runs);expect(report.runs[0].verifierFailures).toBe(1);expect(report.runs[0].verifierPasses).toBe(1);expect(report.groups[0].verifierFailures).toBe(1);
});
test('report keeps different harness versions in separate cohorts',async()=>{
  const f=fixture();await f.metrics.begin('primary',1,count());await f.metrics.finish('primary','succeeded',count(),[],'end',2);const first=(await f.metrics.page()).runs[0];const second={...first,id:'other',harnessVersion:'candidate'};
  const report=aggregate([first,second]);expect(report.groups.filter(g=>g.runs===1).length).toBe(2);
});
test('a new observed execution preserves a missing terminal as incomplete, without fabricated usage',async()=>{
  const f=fixture();await f.metrics.begin('primary',1,count(),'start-1');const resumed=new Telemetry(f.storage);await resumed.begin('primary',10,null,'start-2');
  const rows=(await resumed.page()).runs;expect(rows.length).toBe(2);const gap=rows.find(r=>r.observationIssue)!;expect(gap.endedAt).toBe(null);expect(gap.primaryUsage).toBe(null);expect(aggregate(rows).closedRuns).toBe(0);
});

test('mixed cost coverage counts zero, failed workers and unknown records separately',async()=>{
  const f=fixture();
  await f.metrics.begin('zero',1,count());await f.metrics.finish('zero','succeeded',count(),[],'end',2);
  await f.metrics.begin('paid',3,count());await f.metrics.child('paid','worker','fix','fast',1,'ref');
  await f.metrics.childFinished('worker',count(2),'failed');await f.metrics.finish('paid','failed',count(1),[],'end',4);
  await f.metrics.begin('unknown',5,null);await f.metrics.finish('unknown','interrupted',count(),[],'end',6);
  await f.metrics.begin('unfinished',7,count());
  const report=aggregate((await f.metrics.page()).runs,{truncated:true});
  expect(report.coverage).toEqual({terminalRuns:3,unfinishedRuns:1,interruptedRuns:1,knownCostRuns:2,unknownCostRuns:2});
  expect(report.groups.find(g=>g.mode==='direct')!.observedEstimateUSD).toBe(0);
  expect(report.groups.find(g=>g.mode==='delegated')!.observedEstimateUSD).toBe(3);
  expect(report.groups.find(g=>g.mode==='direct')!.unknownCostRuns).toBe(1);
  expect(markdown(report)).toContain('Collection is truncated');
  expect(markdown(report)).toContain('Measured-record sum USD');
});

test('worker provider retries and verifier failures retain distinct owner signals',async()=>{
  const f=fixture();await f.metrics.begin('owner',1,count());await f.metrics.begin('other',1,count());
  await f.metrics.child('owner','worker','fix','fast',1,'ref');
  await f.metrics.retry('worker','PROVIDER_RATE_LIMIT');await f.metrics.verifier('worker',false,'shell','check');
  await f.metrics.finish('owner','failed',count(),[],'end',2);
  const rows=(await f.metrics.page()).runs,owner=rows.find(r=>r.sessionID==='owner')!;
  expect(owner.errors.map(e=>e.category)).toEqual(['provider','verification']);
  expect(owner.providerRetries).toBe(1);expect(owner.verifierFailures).toBe(1);
  expect(rows.find(r=>r.sessionID==='other')!.errors).toEqual([]);
});

test('repeated inspections need three runs and do not establish unnecessary work',async()=>{
  const f=fixture();for(let n=0;n<3;n++) {
    await f.metrics.begin('primary',n*10,count());await f.metrics.tool('primary','read',{file:'api.ts'},'completed','ref');
    await f.metrics.child('primary',`worker-${n}`,'fix','fast',1,'ref');
    await f.metrics.tool(`worker-${n}`,'read',{file:'api.ts'},'completed','ref');
    await f.metrics.finish('primary','succeeded',count(),[],'end',n*10+1);
    const report=aggregate((await f.metrics.page()).runs);
    expect(report.hypotheses.length).toBe(n===2?1:0);
    if(n===2)expect(report.hypotheses[0].proposal).toContain('Re-reading after a change may be necessary');
  }
});

test('interruption and agent switch remain distinct from a missing terminal after restart',async()=>{
  const f=fixture();await f.metrics.begin('interrupted',1,count());await f.metrics.finish('interrupted','interrupted',count(),[],'end',2);
  await f.metrics.begin('switched',3,count());await f.metrics.detachPrimary('switched');
  await f.metrics.begin('missing',4,count(),'start');await new Telemetry(f.storage).begin('missing',5,null,'next');
  const report=aggregate((await f.metrics.page()).runs);
  expect(report.closedRuns).toBe(1);expect(report.unfinishedRuns).toBe(3);
  expect(report.runs.filter(r=>r.observationIssue).map(r=>r.observationIssue).sort()).toEqual(['agent-switched','terminal-not-observed']);
  expect(report.groups[0].nativeSucceeded).toBe(0);expect(report.coverage.interruptedRuns).toBe(1);
});

test('offline report and re-export preserve imported truncation and omit raw secrets',async()=>{
  const f=fixture();await f.metrics.begin('primary',1,count());
  await f.metrics.tool('primary','read',{file:'sensitive-sentinel'},'error','ref','PERMISSION_DENIED sensitive-sentinel');
  await f.metrics.finish('primary','failed',count(),[],'end',2);
  const directory=await mkdtemp(join(tmpdir(),'aorchestra-report-'));
  try {
    const input=join(directory,'input.json'),output=join(directory,'report.md'),exported=join(directory,'export.json');
    await writeFile(input,JSON.stringify({version:1,runs:(await f.metrics.page()).runs,truncated:true}));
    for(let n=0;n<2;n++) {
      const child=Bun.spawn([process.execPath,resolve(import.meta.dir,'../scripts/report.ts'),`--input=${n?exported:input}`,`--output=${output}`,`--export=${exported}`],{stdout:'pipe',stderr:'pipe'});
      const [stdout,stderr,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
      expect(stderr).toBe('');expect(exit).toBe(0);expect(JSON.parse(stdout).truncated).toBe(true);
      const data=await readFile(exported,'utf8'),report=await readFile(output,'utf8');
      expect(JSON.parse(data).version).toBe(1);expect(JSON.parse(data).truncated).toBe(true);
      expect(report).toContain('coverage is partial');expect(data+report).not.toContain('sensitive-sentinel');
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('workflow usage sums native token categories and deduplicates child sessions',async()=>{
  const {workflowUsage}=await import('../lib/usage');
  const f=fixture();await f.metrics.begin('primary',1,count());
  await f.metrics.child('primary','child','fix','fast',1,'ref');
  await f.metrics.childFinished('child',{cost:2,input:10,output:20,reasoning:3,cacheRead:4,cacheWrite:5},'failed');
  await f.metrics.finish('primary','failed',{cost:1,input:2,output:3,reasoning:4,cacheRead:5,cacheWrite:6},[],'end',2);
  const run=(await f.metrics.page()).runs[0];run.children.push({...run.children[0]});
  expect(workflowUsage(run)).toEqual({costUSD:3,inputTokens:12,outputTokens:23,reasoningTokens:7,cacheReadTokens:9,cacheWriteTokens:11,totalTokens:62,complete:true,missingSessions:[]});
  run.children[1].usage={...run.children[1].usage!,cost:8};
  expect(workflowUsage(run).costUSD).toBe(null);expect(workflowUsage(run).missingSessions).toEqual(['child']);
});

test('missing tokens remain unknown independently of measured workflow cost',async()=>{
  const {workflowUsage}=await import('../lib/usage');
  const f=fixture();await f.metrics.begin('primary',1,count());
  await f.metrics.finish('primary','succeeded',{...count(),reasoning:null},[],'end',2);
  const usage=workflowUsage((await f.metrics.page()).runs[0]);
  expect(usage.costUSD).toBe(0);expect(usage.inputTokens).toBe(0);expect(usage.reasoningTokens).toBe(null);
  expect(usage.totalTokens).toBe(null);expect(usage.complete).toBe(false);expect(usage.missingSessions).toEqual(['primary']);
});

test('evaluation reconciliation uses exact native identity and excludes concurrent records',async()=>{
  const {reconcileEvaluation}=await import('../lib/eval-report');
  const f=fixture();
  for(const id of ['first','second']) {
    await f.metrics.begin(id,1,count());await f.metrics.child(id,`${id}-child`,'fix','fast',1,'ref');
    await f.metrics.childFinished(`${id}-child`,count(id==='first'?2:100),'failed');
    await f.metrics.finish(id,'succeeded',count(1),[],'end',2);
  }
  const records=(await f.metrics.page()).runs;
  const family=[{id:'first'},{id:'first-child',parentID:'first'}];
  const result=reconcileEvaluation('first',[...records,...records],family);
  expect(result.usage.costUSD).toBe(3);expect(result.complete).toBe(true);
  expect(reconcileEvaluation('first',[...records,...records],family)).toEqual(result);
  expect(reconcileEvaluation('first',records,[{id:'first'},{id:'first-child',parentID:'second'}]).usage.costUSD).toBe(null);
  expect(reconcileEvaluation('first',records,[...family,{id:'untracked',parentID:'first'}]).issues).toContain('unrecorded-native-child:untracked');
  expect(reconcileEvaluation('missing',records,[]).complete).toBe(false);
  expect(reconcileEvaluation('first',[...records,{...records.find(r=>r.sessionID==='first')!,id:'new-cycle'}],family).usage.costUSD).toBe(null);
});

test('evaluation interruptions preserve known usage while preventing complete coverage',async()=>{
  const {reconcileEvaluation}=await import('../lib/eval-report');
  const f=fixture();await f.metrics.begin('primary',1,count());await f.metrics.finish('primary','interrupted',count(2),[],'end',2);
  const result=reconcileEvaluation('primary',(await f.metrics.page()).runs,[{id:'primary'}]);
  expect(result.usage.costUSD).toBe(2);expect(result.complete).toBe(false);expect(result.issues).toContain('execution-interrupted');
});
