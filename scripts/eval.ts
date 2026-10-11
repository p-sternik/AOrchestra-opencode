import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { command } from './runtime';
import { snapshot, changedPaths } from '../lib/files';
type Case = { id: string; task: string; files: Record<string,string>; allowedChanges: string[]; assertions: string };
const root = resolve(import.meta.dir, '..');
const corpus = await Bun.file(join(root, 'eval/cases.json')).json() as {version: number; cases: Case[]};
if (corpus.version !== 1 || !corpus.cases.length || new Set(corpus.cases.map(c => c.id)).size !== corpus.cases.length) throw new Error('INVALID_CORPUS');
for (const c of corpus.cases) if (!c.task || !c.assertions || !c.allowedChanges.length) throw new Error('INVALID_CASE');
if (process.argv[2] === 'check') { console.log(JSON.stringify({ cases: corpus.cases.length, strategies: ['direct','selective'], goldToolsInPrompt: false, independentBehaviorChecks: true })); process.exit(0); }
if (process.argv[2] !== 'run') throw new Error('Use check or run');
const selected = process.argv.find(arg => arg.startsWith('--strategy='))?.slice(11) ?? 'both';
if (!['direct','selective','both'].includes(selected)) throw new Error('INVALID_STRATEGY');
const repetitions = Number(process.argv.find(arg => arg.startsWith('--repeat='))?.slice(9) ?? '1');
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20) throw new Error('INVALID_REPEAT');
const destination = resolve(process.argv.find(arg => arg.startsWith('--output-dir='))?.slice(13) ?? join(root, 'work/eval'));
await mkdir(destination, {recursive:true});
const results: Record<string,unknown>[] = [];
for (const strategy of selected === 'both' ? ['direct','selective'] : [selected]) for (const c of corpus.cases) for (let repeat = 0; repeat < repetitions; repeat++) {
  const cwd = await mkdtemp(join(destination, `${strategy}-${c.id}-`));
  for (const [path, content] of Object.entries(c.files)) await writeFile(join(cwd,path),content);
  const before = await snapshot(cwd); const startedAt = Date.now(); let output = '', error: string | null = null;
  try {
    output = await command(['run','--standalone','--agent','aorchestra','--format','json','--auto', `${strategy === 'direct' ? 'For this run perform all work directly; do not delegate. ' : 'Choose direct work or selective delegation using your normal policy. '}Task: ${c.task}`],cwd,600_000,{...process.env,OPENCODE_CONFIG:join(root,'opencode.json')});
  } catch (err) { error = String(err); }
  await writeFile(join(cwd,'../',`${c.id}-${strategy}-${repeat}-${Date.now()}.trajectory.jsonl`),output);
  const after = await snapshot(cwd); const changes = changedPaths(before,after);
  const events = output.split(/\r?\n/).filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const delegations = events.filter(event => event.type === 'tool_use' && event.part?.tool === 'aorchestra_delegate');
  const checks = await new Promise<{passed:boolean;output:string}>(resolve => {
    const child = spawn(process.env.NODE_BIN || 'node',['--input-type=module','-e',`import assert from 'node:assert/strict'; ${c.assertions}`],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let detail=''; const timer=setTimeout(()=>child.kill(),10_000);
    child.stdout.on('data',data=>{detail+=data;}); child.stderr.on('data',data=>{detail+=data;});
    child.on('error',err=>{clearTimeout(timer);resolve({passed:false,output:String(err)});});
    child.on('close',code=>{clearTimeout(timer);resolve({passed:code===0,output:detail.slice(-2000)});});
  });
  const scoped = changes.every(path=>c.allowedChanges.includes(path));
  results.push({id:c.id,strategy,repeat:repeat+1,passed:!error&&checks.passed&&scoped,behaviorPassed:checks.passed,scopePassed:scoped,changedPaths:changes,delegations:delegations.length,durationMs:Date.now()-startedAt,totalWorkflowCost:null,totalWorkflowTokens:null,error,independentCheck:checks.output,workspace:cwd});
}
const report = {version:1,generatedAt:new Date().toISOString(),results,summary:{total:results.length,passed:results.filter(r=>r.passed).length},limitations:['Small smoke corpus, not a representative brownfield benchmark','Cost and tokens are unknown until full native trajectories are independently reconciled','--auto is used only for isolated evaluation fixtures; explicit denials remain enforced']};
await writeFile(join(destination,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
process.exit(results.every(r=>r.passed)?0:1);
