import { randomUUID } from 'node:crypto';
import { digest } from './core';
import packageInfo from '../package.json';
export const HARNESS_VERSION = packageInfo.version;
export type Counters = { cost: number | null; input: number | null; output: number | null; reasoning: number | null; cacheRead: number | null; cacheWrite: number | null };
export type ErrorCategory = 'scope' | 'verification' | 'capability' | 'permission' | 'budget' | 'timeout' | 'protocol' | 'provider' | 'environment' | 'unknown';
export type Run = {
  version: 1; id: string; sessionID: string; harnessVersion: string; startedAt: number; endedAt: number | null;
  runtimeOutcome: 'running' | 'succeeded' | 'failed' | 'interrupted'; baseline: Counters | null; primaryUsage: Counters | null;
  tools: Record<string, number>; toolErrors: number; errors: Array<{category: ErrorCategory; tool: string; ref: string}>;
  inspections: Record<string, {tool: string; count: number; sessions: string[]}>; inspectionCount: number;
  models: Record<string, number>; providerRetries: number; permissionRequests: number; permissionRejections: number;
  verifierPasses: number; verifierFailures: number;
  taskIDs: string[]; tasks: Array<{id: string; status: string; expectedVerifiers: number; observedVerifiers: number}>;
  children: Array<{sessionID: string; taskID: string; tier: string; attempt: number; ref: string; outcome: string; usage: Counters | null}>;
  terminalRef: string | null;
  startedRef: string | null; observationIssue?: 'terminal-not-observed' | 'agent-switched';
};
type SessionState = { active?: Run };
export type MetricsStorage = { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void>; scan(options: {prefix: string; after?: string; limit?: number}): Promise<{entries: readonly {key: string; value: unknown}[]; next?: string}> };
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export function counters(value: unknown): Counters {
  const v = value as {cost?: unknown; tokens?: {input?: unknown; output?: unknown; reasoning?: unknown; cache?: {read?: unknown; write?: unknown}}} | undefined;
  return {cost: finite(v?.cost), input: finite(v?.tokens?.input), output: finite(v?.tokens?.output), reasoning: finite(v?.tokens?.reasoning), cacheRead: finite(v?.tokens?.cache?.read), cacheWrite: finite(v?.tokens?.cache?.write)};
}
export function delta(before: Counters | null, after: Counters): Counters {
  return Object.fromEntries(Object.keys(after).map(key => {
    const k = key as keyof Counters, a = after[k], b = before?.[k];
    return [key, a !== null && b !== undefined && b !== null && a >= b ? a - b : null];
  })) as Counters;
}
export function classify(error: unknown): ErrorCategory {
  const v = error as {message?: unknown; type?: unknown} | undefined;
  const text = (error instanceof Error ? error.message : typeof error === 'string' ? error : `${v?.type ?? ''} ${v?.message ?? ''}`).slice(0, 4000).toUpperCase();
  if (/SCOPE|WORKSPACE_ESCAPE|SYMLINK|PATH_OUTSIDE/.test(text)) return 'scope';
  if (/VERIFIER|EVIDENCE.*STALE|BASELINE_MISSING/.test(text)) return 'verification';
  if (/TOOL_UNAVAILABLE|TOOLS?_DENIED|TOOLS_NOT_ALLOWED|CAPABILITY|EXECUTOR_CONTRACT/.test(text)) return 'capability';
  if (/PERMISSION|DENIED|REJECTED/.test(text)) return 'permission';
  if (/BUDGET|LIMIT_EXCEEDED/.test(text)) return 'budget';
  if (/TIMEOUT|TIMED.?OUT/.test(text)) return 'timeout';
  if (/RESULT_FIELD|INVALID_STATUS|UNSUPPORTED_COMPLETE|INVALID_RESULT/.test(text)) return 'protocol';
  if (/PROVIDER|RATE.?LIMIT|MODEL.*NOT.*FOUND|429/.test(text)) return 'provider';
  if (/ENOENT|NOT_FOUND|NOT FOUND|ENVIRONMENT|COMMAND.*NOT/.test(text)) return 'environment';
  return 'unknown';
}
const inspectionTools = new Set(['read','grep','glob','lsp','fetch','webfetch']);

// Small local aggregates only; full prompts, arguments, outputs and credentials stay in native trajectories.
export class Telemetry {
  private locks = new Map<string, Promise<void>>();
  constructor(private storage: MetricsStorage) {}
  private async mutate<T>(owner: string, action: (state: SessionState) => T | Promise<T>): Promise<T> {
    const prior = this.locks.get(owner) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const tail = prior.then(() => gate); this.locks.set(owner, tail);
    await prior;
    try {
      const state = structuredClone(await this.storage.get(`metrics/session/${owner}`) ?? {}) as SessionState;
      const result = await action(state);
      await this.storage.set(`metrics/session/${owner}`, JSON.parse(JSON.stringify(state)));
      return result;
    } finally {release(); if(this.locks.get(owner)===tail)this.locks.delete(owner);}
  }
  async begin(owner: string, start: number, baseline: Counters | null = null, startedRef: string | null = null): Promise<void> {
    await this.mutate(owner, async state => {
      if(state.active&&startedRef&&state.active.startedRef&&state.active.startedRef!==startedRef){
        state.active.observationIssue='terminal-not-observed';
        await this.storage.set(`metrics/run/${state.active.id}`,JSON.parse(JSON.stringify(state.active)));
        delete state.active;
      }
      if (state.active) { if(!state.active.baseline && baseline) state.active.baseline=baseline;if(startedRef){state.active.startedRef=startedRef;state.active.startedAt=Math.min(state.active.startedAt,start);}return; }
      state.active = {version:1,id:`${start}-${randomUUID()}`,sessionID:owner,harnessVersion:HARNESS_VERSION,startedAt:start,endedAt:null,runtimeOutcome:'running',baseline,primaryUsage:null,tools:{},toolErrors:0,errors:[],inspections:{},inspectionCount:0,models:{},providerRetries:0,permissionRequests:0,permissionRejections:0,verifierPasses:0,verifierFailures:0,taskIDs:[],tasks:[],children:[],terminalRef:null,startedRef};
    });
  }
  async model(actor: string, model: string): Promise<void> {const link=await this.owner(actor);await this.mutate(link.owner, s=>{if(s.active&&(!link.runID||s.active.id===link.runID))s.active.models[model]=(s.active.models[model]??0)+1;});}
  async hasPrimary(owner:string):Promise<boolean>{return Boolean((await this.storage.get(`metrics/session/${owner}`) as SessionState|undefined)?.active);}
  async detachPrimary(owner:string):Promise<void>{
    if(!await this.hasPrimary(owner))return;
    await this.mutate(owner,async state=>{
      if(!state.active)return;
      state.active.observationIssue='agent-switched';
      await this.storage.set(`metrics/run/${state.active.id}`,JSON.parse(JSON.stringify(state.active)));
      delete state.active;
    });
  }
  async child(owner: string, sessionID: string, taskID: string, tier: string, attempt: number, ref: string): Promise<void> {
    await this.mutate(owner, async s=>{
      if(!s.active)return;
      if(!s.active.children.some(c=>c.sessionID===sessionID))s.active.children.push({sessionID,taskID,tier,attempt,ref,outcome:'running',usage:null});
      if(!s.active.taskIDs.includes(taskID))s.active.taskIDs.push(taskID);
      await this.storage.set(`metrics/child/${sessionID}`,{owner,runID:s.active.id});
    });
  }
  private async owner(actor: string): Promise<{owner:string;runID?:string}> {
    return await this.storage.get(`metrics/child/${actor}`) as {owner:string;runID:string} | undefined ?? {owner:actor};
  }
  async tool(actor: string, tool: string, input: unknown, status: string, ref: string, error?: unknown): Promise<void> {
    const link=await this.owner(actor);
    await this.mutate(link.owner,s=>{
      const r=s.active;if(!r||link.runID&&r.id!==link.runID)return;
      r.tools[tool]=(r.tools[tool]??0)+1;
      if(status==='error'){r.toolErrors++;if(r.errors.length<128)r.errors.push({category:classify(error),tool,ref});}
      if(inspectionTools.has(tool)){
        r.inspectionCount++;
        const signature=digest({tool,input});
        if(r.inspections[signature]){r.inspections[signature].count++;if(!r.inspections[signature].sessions.includes(actor))r.inspections[signature].sessions.push(actor);}
        else if(Object.keys(r.inspections).length<128)r.inspections[signature]={tool,count:1,sessions:[actor]};
      }
      if(tool==='aorchestra_task'&&status==='completed'&&input&&typeof input==='object'){
        const v=input as {operation?:string;taskId?:string;task?:{id?:string}};
        const id=v.taskId??v.task?.id;
        if(id&&v.operation!=='status'&&!r.taskIDs.includes(id))r.taskIDs.push(id);
      }
    });
  }
  async retry(actor:string,error:unknown):Promise<void>{const link=await this.owner(actor);await this.mutate(link.owner,s=>{if(s.active&&(!link.runID||link.runID===s.active.id)){s.active.providerRetries++;if(s.active.errors.length<128)s.active.errors.push({category:classify(error),tool:'provider-retry',ref:`session:${actor}`});}});}
  async verifier(actor:string,passed:boolean,tool:string,ref:string):Promise<void>{const link=await this.owner(actor);await this.mutate(link.owner,s=>{const r=s.active;if(!r||link.runID&&r.id!==link.runID)return;if(passed)r.verifierPasses++;else{r.verifierFailures++;if(r.errors.length<128)r.errors.push({category:'verification',tool,ref});}});}
  async permission(actor:string,rejected:boolean):Promise<void>{const link=await this.owner(actor);await this.mutate(link.owner,s=>{if(s.active&&(!link.runID||link.runID===s.active.id)){if(rejected)s.active.permissionRejections++;else s.active.permissionRequests++;}});}
  async childFinished(actor:string,usage:Counters,outcome:string):Promise<void>{const link=await this.owner(actor);if(!link.runID)return;await this.mutate(link.owner,s=>{const r=s.active;if(!r||r.id!==link.runID)return;const child=r.children.find(c=>c.sessionID===actor);if(child){child.usage=usage;child.outcome=outcome;}});}
  async finish(owner:string,outcome:Run['runtimeOutcome'],usage:Counters,tasks:Run['tasks'],ref:string,end=Date.now(),error?:unknown):Promise<boolean>{
    return this.mutate(owner,async s=>{
      const r=s.active;if(!r)return false;
      r.endedAt=end;r.runtimeOutcome=outcome;r.primaryUsage=delta(r.baseline,usage);r.terminalRef=ref;r.tasks=tasks.filter(t=>r.taskIDs.includes(t.id));
      if(error&&r.errors.length<128)r.errors.push({category:classify(error),tool:'runtime',ref});
      await this.storage.set(`metrics/run/${r.id}`,JSON.parse(JSON.stringify(r)));
      delete s.active;return true;
    });
  }
  async page(after?:string,limit=100):Promise<{version:1;runs:Run[];next:string|null}>{
    const page=await this.storage.scan({prefix:'metrics/run/',after,limit:Math.max(1,Math.min(500,limit))});
    const runs=page.entries.map(e=>e.value as Run).filter(r=>r.version===1);
    // Show unfinished observations on the first page; the reporter deduplicates by run ID.
    if(!after){let cursor:string|undefined;do{const active=await this.storage.scan({prefix:'metrics/session/',after:cursor,limit:500});for(const item of active.entries){const r=(item.value as SessionState).active;if(r)runs.push(r);}cursor=active.next;}while(cursor);}
    return {version:1,runs,next:page.next??null};
  }
}

// Read-only API, not a new tool advertised to the model.
export const metricsRpc = {id:'aorchestra.metrics',methods:{list:{input:{type:'object',additionalProperties:false,properties:{after:{type:'string'},limit:{type:'integer',minimum:1,maximum:500}}},output:{type:'object',additionalProperties:false,properties:{version:{const:1},runs:{type:'array',items:{type:'object',additionalProperties:true}},next:{type:['string','null']}},required:['version','runs','next']}}},events:{}} as const;
