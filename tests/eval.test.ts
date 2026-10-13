import {expect,test} from 'bun:test';
import {comparison,evaluationMarkdown,type EvaluationResult} from '../lib/eval-report';
import {trajectorySessionIDs} from '../scripts/eval-usage';
import {fileURLToPath} from 'node:url';
const row=(overrides:Partial<EvaluationResult>={}):EvaluationResult=>({id:'case',strategy:'direct',repeat:1,passed:true,behaviorPassed:true,scopePassed:true,changedPaths:[],delegations:0,durationMs:10,totalWorkflowCost:2,totalWorkflowTokens:0,inputTokens:0,outputTokens:0,reasoningTokens:0,cacheReadTokens:0,cacheWriteTokens:0,usageComplete:true,usageIssues:[],missingSessions:[],sessionID:'primary',runID:'run',runtimeOutcome:'succeeded',error:null,independentCheck:'',workspace:'fixture',...overrides});

test('comparison includes costs of failed assertions and only divides complete cohorts',()=>{
  const rows=[row(),row({repeat:2,passed:false,behaviorPassed:false,totalWorkflowCost:3,durationMs:30}),row({strategy:'selective',totalWorkflowCost:0})];
  const groups=comparison(rows);
  expect(groups[0]).toEqual({strategy:'direct',runs:2,verifiedSuccesses:1,verifiedSuccessRate:0.5,totalObservedCostUSD:5,observedCostRuns:2,completeUsageRuns:2,usageCoverage:1,costPerVerifiedSuccessUSD:5,comparisonComplete:true,medianDurationMs:20,scopeViolations:0,delegationsPerRun:0});
  expect(groups[1].costPerVerifiedSuccessUSD).toBe(0);
  const incomplete=comparison([...rows,row({usageComplete:false,totalWorkflowCost:null,scopePassed:false,passed:false})])[0];
  expect(incomplete.totalObservedCostUSD).toBe(5);expect(incomplete.costPerVerifiedSuccessUSD).toBe(null);expect(incomplete.usageCoverage).toBe(2/3);expect(incomplete.scopeViolations).toBe(1);
  expect(comparison([row({passed:false})])[0].costPerVerifiedSuccessUSD).toBe(null);
  expect(comparison([])[0].totalObservedCostUSD).toBe(null);
  expect(evaluationMarkdown(rows)).toBe(evaluationMarkdown(rows));
});

test('known interrupted cost and absent tokens remain observed but comparison is incomplete',()=>{
  const result=row({usageComplete:false,usageIssues:['execution-interrupted'],passed:false,totalWorkflowCost:4,totalWorkflowTokens:null});
  expect(comparison([result])[0].totalObservedCostUSD).toBe(4);
  expect(comparison([result])[0].comparisonComplete).toBe(false);
  expect(evaluationMarkdown([result])).toContain('execution-interrupted');
});

test('native trajectory identity ignores non-JSON logs and empty failure IDs',()=>{
  expect(trajectorySessionIDs('log\n{"sessionID":""}\n{"sessionID":"a"}\n{"sessionID":"a"}\n{"sessionID":"b"}\n')).toEqual(['a','b']);
});

test('CLI failures preserve streamed partial trajectory for reconciliation',async()=>{
  // Use the existing CLI wrapper with a provider-free recording executable.
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const dir=await mkdtemp(join(tmpdir(),'aorchestra-eval-command-'));
  try {
    const script=join(dir,'fail.ts');await writeFile(script,'console.log(JSON.stringify({sessionID:"native-session"}));process.exit(1);');
    const child=Bun.spawn([process.execPath,'-e',`const {command}=await import(${JSON.stringify(fileURLToPath(new URL('../scripts/runtime.ts',import.meta.url)))});let output='';try{await command([${JSON.stringify(script)}],${JSON.stringify(dir)},10000,process.env,chunk=>output+=chunk);}catch{}console.log(output.trim());`],{env:{...process.env,OPENCODE_BIN:process.execPath},stdout:'pipe',stderr:'pipe'});
    const [output,exit]=await Promise.all([new Response(child.stdout).text(),child.exited]);
    expect(exit).toBe(0);expect(JSON.parse(output).sessionID).toBe('native-session');
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('native reconciliation exhausts boundary cursors and paginated telemetry without inference',async()=>{
  const {readEvaluationUsage}=await import('../scripts/eval-usage');
  const {Telemetry}=await import('../lib/telemetry');
  const data=new Map<string,unknown>();
  const telemetry=new Telemetry({get:async k=>data.get(k),set:async(k,v)=>{data.set(k,v);},scan:async()=>({entries:[]})});
  const zero={cost:0,input:0,output:0,reasoning:0,cacheRead:0,cacheWrite:0};
  await telemetry.begin('primary',1,zero);await telemetry.finish('primary','succeeded',zero,[],'end',2);
  const run=[...data.entries()].find(([key])=>key.startsWith('metrics/run/'))![1];
  const calls:string[]=[];
  const connect:Parameters<typeof readEvaluationUsage>[3]=async()=>({
    client:{session:{
      list:async(input:{parentID?:string|null;cursor?:string})=>{
        calls.push(`session:${input.parentID}:${input.cursor??''}`);
        return input.parentID===null&&!input.cursor?{data:[{id:'primary',agent:'aorchestra',outcome:'succeeded'}],cursor:{next:'last-boundary'}}:{data:[],cursor:{}};
      },
      create:async()=>({id:'bootstrap'}),remove:async()=>{calls.push('remove');}
    },rpc:()=>({list:async(input:{after?:string})=>{
      calls.push(`metrics:${input.after??''}`);
      return input.after?{version:1,runs:[run],next:null}:{version:1,runs:[{...(run as object),sessionID:'unrelated',id:'other'}],next:'next'};
    }})} as unknown as Awaited<ReturnType<NonNullable<Parameters<typeof readEvaluationUsage>[3]>>>['client'],
    close:async()=>{calls.push('close');}
  });
  const measured=await readEvaluationUsage('fixture',{},'{"sessionID":"primary"}',connect);
  expect(measured.sessionID).toBe('primary');expect(measured.complete).toBe(true);expect(measured.usage.costUSD).toBe(0);
  expect(measured.records.length).toBe(1);expect(calls).toContain('session:null:last-boundary');
  expect(calls).toContain('metrics:next');expect(calls.slice(-2)).toEqual(['remove','close']);
  await expect(readEvaluationUsage('fixture',{},'{"sessionID":"different"}',connect)).rejects.toThrow('EVALUATION_TRAJECTORY_SESSION_MISMATCH');
});
