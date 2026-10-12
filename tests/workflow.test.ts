import { expect, test } from 'bun:test';
import { Ledger, type Task } from '../lib/core';
import { beginExecution, beginRepair, transition, workflow } from '../lib/workflow';
const task = ():Task => ({id:'fix',kind:'change',instruction:'Fix',context:'',dependsOn:[],writePaths:['api.ts'],preserve:[],verifiers:[],status:'pending',attempts:[],receipts:{}});

test('workflow enforces phase transitions while repeated phase resume is idempotent',()=>{
  const t=task();expect(workflow(t).phase).toBe('discover');
  expect(()=>transition(t,'complete','Unverified report')).toThrow('WORKFLOW_TRANSITION_INVALID');
  beginExecution(t);expect(t.workflow!.events.map(e=>e.phase)).toEqual(['plan','execute']);
  beginExecution(t);expect(t.workflow!.events).toHaveLength(2);
  transition(t,'verify','Observed native result');transition(t,'complete','Fresh checks and compatibility review');
  expect(()=>beginExecution(t)).toThrow('WORKFLOW_TRANSITION_INVALID');
});

test('repair budget and events survive a fresh Ledger instance',async()=>{
  const data=new Map<string,unknown>();const storage={get:async(k:string)=>data.get(k),set:async(k:string,v:unknown)=>{data.set(k,structuredClone(v));}};
  const t=task();beginExecution(t);transition(t,'verify','Failed regression');
  await new Ledger(storage).mutate('owner',s=>{s.tasks.push(t);beginRepair(t,'Fix null dereference',2);});
  await new Ledger(storage).mutate('owner',s=>{transition(s.tasks[0],'verify','Regression still fails');beginRepair(s.tasks[0],'Preserve legacy shape',2);});
  await new Ledger(storage).mutate('owner',s=>{transition(s.tasks[0],'verify','Failed again');beginRepair(s.tasks[0],'Third repair',2);});
  const saved=(await new Ledger(storage).read('owner')).tasks[0];
  expect(saved.status).toBe('blocked');expect(saved.workflow!.repairs).toBe(2);expect(saved.workflow!.phase).toBe('blocked');
});

test('older tasks retain state and repair needs a new evidence delta',()=>{
  const t=task();t.status='review';t.baseline='existing';t.attempts=[];
  expect(workflow(t).phase).toBe('execute');expect(t.baseline).toBe('existing');
  expect(()=>beginRepair(t,'Reason',2)).toThrow('VERIFICATION_REQUIRED');
  transition(t,'verify','Observed failure');expect(()=>beginRepair(t,' ',2)).toThrow('REPAIR_DELTA_REQUIRED');
  beginRepair(t,'New evidence',2);expect(()=>beginRepair(t,'Same cycle',2)).toThrow('VERIFICATION_REQUIRED');
  expect(t.workflow!.repairs).toBe(1);
});
