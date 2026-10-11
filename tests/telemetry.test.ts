import { expect,test } from 'bun:test';
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
