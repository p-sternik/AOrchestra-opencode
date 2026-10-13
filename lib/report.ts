import type { Run } from './telemetry';
export const route = (run: Run) => run.children.length ? 'delegated' : 'direct';
export const verified = (run: Run) => run.tasks.length>0 && run.tasks.every(t=>t.status==='complete'&&t.expectedVerifiers>0&&t.observedVerifiers>=t.expectedVerifiers);
export const workflowEstimate = (run: Run): number | null => {
  const parent=run.primaryUsage?.cost;
  if(parent===null||parent===undefined||run.children.some(child=>child.usage?.cost===null||child.usage?.cost===undefined))return null;
  return parent+run.children.reduce((sum,c)=>sum+c.usage!.cost!,0);
};
const median=(values:number[])=>{if(!values.length)return null;const v=[...values].sort((a,b)=>a-b),mid=Math.floor(v.length/2);return v.length%2?v[mid]:(v[mid-1]+v[mid])/2;};
const repeats=(run:Run)=>Object.values(run.inspections).reduce((n,i)=>n+Math.max(0,i.count-1),0);
export function aggregate(input: Run[], collection: {truncated?: boolean} = {}) {
  const unique=new Map<string,Run>();
  for(const run of input){const previous=unique.get(run.id);if(!previous||run.endedAt!==null)unique.set(run.id,run);}
  const runs=[...unique.values()].sort((a,b)=>a.startedAt-b.startedAt),closed=runs.filter(r=>r.endedAt!==null);
  const groups=[...new Set(runs.map(r=>r.harnessVersion))].flatMap(harnessVersion=>['direct','delegated'].map(mode=>{
    const selected=closed.filter(r=>route(r)===mode&&r.harnessVersion===harnessVersion),estimates=selected.map(workflowEstimate).filter((v):v is number=>v!==null);
    return {harnessVersion,mode,runs:selected.length,nativeSucceeded:selected.filter(r=>r.runtimeOutcome==='succeeded').length,verifiedTrackedRuns:selected.filter(verified).length,untrackedOutcome:selected.filter(r=>!r.tasks.length).length,
      medianDurationMs:median(selected.map(r=>Math.max(0,r.endedAt!-r.startedAt))),knownCostRuns:estimates.length,unknownCostRuns:selected.length-estimates.length,interruptedRuns:selected.filter(r=>r.runtimeOutcome==='interrupted').length,observedEstimateUSD:estimates.length?estimates.reduce((a,b)=>a+b,0):null,
      toolErrors:selected.reduce((n,r)=>n+r.toolErrors,0),repeatedInspections:selected.reduce((n,r)=>n+repeats(r),0),providerRetries:selected.reduce((n,r)=>n+r.providerRetries,0),delegations:selected.reduce((n,r)=>n+r.children.length,0),verifierFailures:selected.reduce((n,r)=>n+(r.verifierFailures??0),0)};
  }));
  const hypotheses:Array<{observation:string;proposal:string;validation:string;evidence:string[]}>=[];
  const problems=[...new Set(closed.flatMap(r=>r.errors.map(e=>e.category)))].map(category=>{
    const affected=closed.filter(r=>r.errors.some(e=>e.category===category));
    return {category,signals:affected.reduce((n,r)=>n+r.errors.filter(e=>e.category===category).length,0),runs:affected.length,refs:affected.flatMap(r=>r.errors.filter(e=>e.category===category).map(e=>`${r.sessionID}:${e.ref}`)).slice(0,10)};
  });
  const sample=(list:Run[])=>list.slice(0,10).map(r=>`${r.sessionID}/${r.id}`);
  const repeated=closed.filter(r=>route(r)==='delegated'&&Object.values(r.inspections).some(i=>i.sessions.length>1&&i.count>1));
  if(repeated.length>=3)hypotheses.push({observation:`${repeated.length} delegated runs repeated identical inspection calls across sessions.`,proposal:'Check whether a more cohesive DIRECT slice or more precise handoff avoids repeated exploration. Re-reading after a change may be necessary.',validation:'Replay the same tasks and models with one routing change; compare acceptance, regressions, whole-workflow usage and duration.',evidence:sample(repeated)});
  const blockers=closed.filter(r=>r.errors.some(e=>['capability','environment','provider'].includes(e.category)));
  if(blockers.length>=3)hypotheses.push({observation:`${blockers.length} runs recorded capability/environment/provider errors.`,proposal:'Inspect native error references and improve availability checks or early blocker reporting. Do not widen permissions from this signal.',validation:'Add a focused regression for the recurring failure and replay affected tasks.',evidence:sample(blockers)});
  const escalations=closed.filter(r=>r.children.some(c=>c.attempt>1));
  if(escalations.length>=3)hypotheses.push({observation:`${escalations.length} runs used another logical task attempt.`,proposal:'Review whether the initial evidence, tier or contract was insufficient; an execution error alone does not justify a stronger model.',validation:'Compare one proposed tier/contract change against the same held-out task set, including easy cases.',evidence:sample(escalations)});
  const regression=closed.filter(r=>r.errors.some(e=>['scope','verification'].includes(e.category)));
  if(regression.length>=3)hypotheses.push({observation:`${regression.length} runs recorded scope or verification failures.`,proposal:'Check task scope and verifier design against the actual native trajectories before changing acceptance policy.',validation:'Create regressions that reject the observed invalid completion; verify valid workflows still pass.',evidence:sample(regression)});
  const knownCostRuns=closed.filter(r=>workflowEstimate(r)!==null).length;
  const coverage={terminalRuns:closed.length,unfinishedRuns:runs.length-closed.length,interruptedRuns:closed.filter(r=>r.runtimeOutcome==='interrupted').length,knownCostRuns,unknownCostRuns:runs.length-knownCostRuns};
  return {coverage,truncated:collection.truncated===true,version:1,generatedAt:new Date().toISOString(),totalRuns:runs.length,closedRuns:closed.length,unfinishedRuns:runs.length-closed.length,harnessVersions:[...new Set(runs.map(r=>r.harnessVersion))],groups,problems,hypotheses,runs};
}
const safe=(value:unknown)=>String(value).replace(/[\r\n|`]/g,' ').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').slice(0,240);
export function markdown(report: ReturnType<typeof aggregate>): string {
  const lines=['# AOrchestra — execution evidence', '',`Generated: ${report.generatedAt}. Runs: ${report.totalRuns}; closed: ${report.closedRuns}; unfinished: ${report.unfinishedRuns}.`,'',
    'A run is one native primary execution cycle, not necessarily one user ticket. Native success is not semantic acceptance. Cost values are native counter estimates, not provider invoices; missing components remain unknown. DIRECT outcomes without tracked verifiers remain unverified in this report.','',
    '| Version / route | Runs | Native succeeded | Verified tracked runs | Untracked | Median ms | Known / unknown cost runs | Measured-record sum USD | Tool errors | Failed verifiers | Repeated inspections |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'];
  for(const g of report.groups)lines.push(`| ${safe(g.harnessVersion)} / ${g.mode} | ${g.runs} | ${g.nativeSucceeded} | ${g.verifiedTrackedRuns} | ${g.untrackedOutcome} | ${g.medianDurationMs??'unknown'} | ${g.knownCostRuns} / ${g.unknownCostRuns} | ${g.observedEstimateUSD===null?'unknown':g.observedEstimateUSD.toFixed(6)} | ${g.toolErrors} | ${g.verifierFailures} | ${g.repeatedInspections} |`);
  lines.push('',`Coverage: observed terminal records ${report.coverage.terminalRuns}/${report.totalRuns}; unfinished ${report.coverage.unfinishedRuns}; interrupted ${report.coverage.interruptedRuns}; complete workflow-cost records ${report.coverage.knownCostRuns}/${report.totalRuns}; unknown workflow-cost records ${report.coverage.unknownCostRuns}.`, '', ...(report.truncated?['Collection is truncated; coverage is partial.','']:[]));
  lines.push('','## Observed problem signals','', '| Category | Signals | Affected runs | Native references |','|---|---:|---:|---|');
  for(const p of report.problems)lines.push(`| ${safe(p.category)} | ${p.signals} | ${p.runs} | ${p.refs.map(safe).join(', ')} |`);
  if(!report.problems.length)lines.push('| none observed | 0 | 0 | Coverage may be incomplete |');
  lines.push('','## Hypotheses for review','');
  if(!report.hypotheses.length)lines.push('No recurring signal crossed the descriptive threshold of three runs. This is not evidence that the harness is optimal.');
  for(const h of report.hypotheses)lines.push(`- Observation: ${h.observation}`,`  Proposal: ${h.proposal}`,`  Validation: ${h.validation}`,`  Native session/run references: ${h.evidence.map(safe).join(', ')}`);
  lines.push('','## Run references','', '| Session / run | Outcome | Tracked tasks | Model dispatches | Provider retry decisions | Permission asks / rejects |', '|---|---|---|---|---:|---|');
  for(const r of report.runs)lines.push(`| ${safe(r.sessionID)} / ${safe(r.id)} | ${r.observationIssue??r.runtimeOutcome} | ${r.tasks.map(t=>`${safe(t.id)}:${safe(t.status)}`).join(', ')||'none'} | ${Object.entries(r.models).map(([m,n])=>`${safe(m)}:${n}`).join(', ')||'unknown'} | ${r.providerRetries} | ${r.permissionRequests} / ${r.permissionRejections} |`);
  lines.push('','## Limits','', 'Differences between DIRECT and delegated groups are descriptive: task difficulty and selection are uncontrolled. A run with any child session is classified as delegated; this does not measure DIRECT work before delegation. Cost sums include only terminal records with measured primary and all child costs. Unfinished observations are not counted as failures. Repeated inspections may be necessary. Provider retry counts are observed retry decisions; later hooks can change them. Stream interruptions, restart gaps or missing terminal events reduce coverage. Source content, prompts and raw errors are not copied into this dataset. Review full native trajectories before accepting a hypothesis.','', 'No prompt, model policy, permission or skill is modified by this report. A policy candidate needs independent replay against a previous version and a rollback path.');
  return lines.join('\n')+'\n';
}
