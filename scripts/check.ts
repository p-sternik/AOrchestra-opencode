import { resolve, dirname } from 'node:path';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { command, binary, privateClient, removeTemporary } from './runtime';
import { metricsRpc, type Run } from '../lib/telemetry';
import { Npm } from '@opencode/util/npm';
import { BUNDLED_SKILL_ID } from '../lib/core';
const root = resolve(import.meta.dir, '..');
const globalMode = process.argv.includes('--global');
const scratch = resolve(root, 'work/runtime');
// A project containing the template would override global config during discovery.
const neutralProject = globalMode && !process.env.AORCHESTRA_CHECK_PROJECT
  ? await mkdtemp(resolve(tmpdir(), 'aorchestra-global-check-')) : undefined;
const project = resolve(process.env.AORCHESTRA_CHECK_PROJECT || neutralProject || root);
const version = (await command(['--version'], root)).trim();
if (/(\d+\.\d+\.\d+)/.exec(version)?.[1] !== '2.0.26') throw new Error(`Expected OpenCode 2.0.26; got ${version}`);
const source = await Bun.file(resolve(root, 'opencode.json')).json();
if (!source.agents?.aorchestra || !source.agents?.['aorchestra-executor']) throw new Error('AGENTS_MISSING');
if (source.agent || source.agents.aorchestra.tools || source.agents['aorchestra-executor'].tools) throw new Error('LEGACY_CONFIG');
const pkg = await Bun.file(resolve(dirname(Bun.resolveSync('@opencode/plugin',root)), '../../package.json')).json();
if (pkg.version !== '2.0.26') throw new Error('PLUGIN_VERSION_MISMATCH');
await mkdir(scratch, {recursive:true});
const checkEnv: NodeJS.ProcessEnv = {...process.env, OPENCODE_DB:resolve(scratch, globalMode ? 'global-check.db' : 'check.db')};
if (globalMode) {
  delete checkEnv.OPENCODE_CONFIG;
  delete checkEnv.OPENCODE_CONFIG_CONTENT;
} else checkEnv.OPENCODE_CONFIG = resolve(root, 'opencode.json');
const temporary=await privateClient(globalMode ? project : root,checkEnv);
const {client}=temporary;
try {
  let globalTargets:string[]=[];
  await client.location.get({location:{directory:project}});
  if (globalMode) {
    const paths = await command(['debug', 'paths'], project, 120_000, checkEnv);
    const directory = checkEnv.OPENCODE_CONFIG_DIR ?? /^config\s+(.+)$/m.exec(paths)?.[1]?.trim();
    if (!directory) throw new Error('GLOBAL_CONFIG_DIRECTORY_UNKNOWN');
    const entries = await client.config.get({location:{directory:project}});
    const globalFiles = ['opencode.json','opencode.jsonc'].map(name=>resolve(directory,name));
    const documents = entries.filter(entry=>entry.type==='document' && entry.path && globalFiles.includes(resolve(entry.path)));
    if (!['aorchestra','aorchestra-executor'].every(id=>documents.some(entry=>entry.type==='document' && entry.info.agents?.[id]))) throw new Error('GLOBAL_AGENT_CONFIG_MISSING');
    globalTargets=documents.flatMap(entry=>entry.type==='document' ? (entry.info.plugins??[]).map(plugin=>{
      const target=typeof plugin==='string'?plugin:plugin.package;
      return target.startsWith('./')||target.startsWith('../')?resolve(dirname(entry.path!),target):target;
    }):[]);
  }
  const bootstrap=await client.session.create({location:{directory:project}});
  let [plugins,agents]=await Promise.all([client.plugin.list({location:{directory:project}}),client.agent.list({location:{directory:project}})]);
  for(let attempt=0;attempt<20 && !plugins.data.some(p=>p.id==='aorchestra');attempt++) {
    await new Promise(resolve=>setTimeout(resolve,250));
    [plugins,agents]=await Promise.all([client.plugin.list({location:{directory:project}}),client.agent.list({location:{directory:project}})]);
  }
  if(!plugins.data.some(plugin=>plugin.id==='aorchestra' && plugin.state.status==='active')) {
    console.log(JSON.stringify({location:bootstrap.location,localPluginStates:plugins.data.filter(p=>p.source.type==='local').map(p=>({id:p.id,state:p.state})),primaryFound:agents.data.some(a=>a.id==='aorchestra')},null,2));
    throw new Error('PLUGIN_NOT_LOADED');
  }
  const active=plugins.data.filter(plugin=>plugin.id==='aorchestra'&&plugin.state.status==='active');
  if(active.length!==1)throw new Error('DUPLICATE_AORCHESTRA_PLUGINS');
  const loaded=active[0];
  if(globalMode && !globalTargets.includes(loaded.source.type==='package'?loaded.source.target:loaded.source.type==='local'?loaded.source.path:''))throw new Error('GLOBAL_PLUGIN_CONFIG_MISSING');
  const bundleRoot=loaded.source.type==='package'?(await Npm.resolve(loaded.source.target)).directory:root;
  const expectedSkill=resolve(bundleRoot,'skills/repo-context/SKILL.md');
  if(!agents.data.some(agent=>agent.id==='aorchestra')) throw new Error('RESOLVED_PRIMARY_MISSING');
  const session=await client.session.create({agent:'aorchestra-executor',location:{directory:project},permissions:[{action:'*',resource:'*',effect:'deny'},{action:'read',resource:'README.md',effect:'allow'}]});
  const persisted=await client.session.get({sessionID:session.id});
  let skills=await client.skill.list({location:{directory:project}});
  for(let attempt=0;attempt<10&&!skills.data.some(skill=>skill.id===BUNDLED_SKILL_ID&&skill.path===expectedSkill);attempt++) {
    await new Promise(resolve=>setTimeout(resolve,250)); skills=await client.skill.list({location:{directory:project}});
  }
  const bundledSkill=skills.data.find(skill=>skill.id===BUNDLED_SKILL_ID);
  if(!bundledSkill || bundledSkill.autoinvoke!==false || bundledSkill.path!==expectedSkill) {
    console.log(JSON.stringify({repoContext:skills.data.filter(skill=>skill.id===BUNDLED_SKILL_ID).map(skill=>({id:skill.id,path:skill.path,autoinvoke:skill.autoinvoke})),expected:expectedSkill}));
    throw new Error('BUNDLED_SKILL_NOT_REGISTERED_EXPLICITLY');
  }
  const rpc=client.rpc(metricsRpc);
  const controlled=await client.session.create({agent:'aorchestra',location:{directory:project},model:{providerID:'aorchestra-smoke-missing-provider',id:'missing'}});
  await client.session.prompt({sessionID:controlled.id,text:'Controlled local smoke failure. No external model should run.'}).catch(()=>{});
  await client.session.wait({sessionID:controlled.id},{signal:AbortSignal.timeout(10000)}).catch(()=>{});
  let metrics:{version:1;runs:Run[];next:string|null}|undefined;
  for(let attempt=0;attempt<40;attempt++){
    metrics=await rpc.list({limit:500},{location:{directory:project}}) as typeof metrics;
    if(metrics?.runs.some(r=>r.sessionID===controlled.id&&r.endedAt!==null))break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  const observed=metrics?.runs.find(r=>r.sessionID===controlled.id&&r.endedAt!==null);
  if(!observed||observed.runtimeOutcome!=='failed')throw new Error('NATIVE_FAILURE_TELEMETRY_NOT_OBSERVED');
  await Bun.write(resolve(scratch,'check.metrics.json'),JSON.stringify({version:1,runs:metrics!.runs},null,2));
  await client.session.remove({sessionID:session.id});
  await client.session.remove({sessionID:bootstrap.id});
  console.log(JSON.stringify({binary,runtime:version,configMode:globalMode?'global-discovery':'repository-profile',project,pluginApi:pkg.version,pluginLoaded:true,resolvedAgents:true,nativeSessionCreated:!!persisted.id,bundledSkill:true,skillAutoinvoke:false,nativeFailureTelemetry:true,modelCalls:0},null,2));
} finally {await temporary.close(); if (neutralProject) await removeTemporary(neutralProject,'aorchestra-global-check-');}
// The native package resolver retains its service scope; this is a one-shot CLI.
process.exit(0);
