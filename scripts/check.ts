import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { command, binary, privateClient } from './runtime';
import { metricsRpc, type Run } from '../lib/telemetry';
const root = resolve(import.meta.dir, '..');
const project = resolve(process.env.AORCHESTRA_CHECK_PROJECT || root);
const version = (await command(['--version'], root)).trim();
if (/(\d+\.\d+\.\d+)/.exec(version)?.[1] !== '2.0.26') throw new Error(`Expected OpenCode 2.0.26; got ${version}`);
const source = await Bun.file(resolve(root, 'opencode.json')).json();
if (!source.agents?.aorchestra || !source.agents?.['aorchestra-executor']) throw new Error('AGENTS_MISSING');
if (source.agent || source.agents.aorchestra.tools || source.agents['aorchestra-executor'].tools) throw new Error('LEGACY_CONFIG');
const pkg = await Bun.file(resolve(root, 'node_modules/@opencode/plugin/package.json')).json();
if (pkg.version !== '2.0.26') throw new Error('PLUGIN_VERSION_MISMATCH');
const scratch = resolve(root, 'work/runtime');
await mkdir(scratch, {recursive:true});
const temporary=await privateClient(root,{...process.env,OPENCODE_CONFIG:resolve(root,'opencode.json'),OPENCODE_DB:resolve(scratch,'check.db')});
const {client}=temporary;
try {
  await client.location.get({location:{directory:project}});
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
  if(!agents.data.some(agent=>agent.id==='aorchestra')) throw new Error('RESOLVED_PRIMARY_MISSING');
  const session=await client.session.create({agent:'aorchestra-executor',location:{directory:project},permissions:[{action:'*',resource:'*',effect:'deny'},{action:'read',resource:'README.md',effect:'allow'}]});
  const persisted=await client.session.get({sessionID:session.id});
  let skills=await client.skill.list({location:{directory:project}});
  for(let attempt=0;attempt<10&&!skills.data.some(skill=>skill.id==='repo-context'&&skill.path===resolve(root,'skills/repo-context/SKILL.md'));attempt++) {
    await new Promise(resolve=>setTimeout(resolve,250)); skills=await client.skill.list({location:{directory:project}});
  }
  const bundledSkill=skills.data.find(skill=>skill.id==='repo-context');
  if(!bundledSkill || bundledSkill.autoinvoke!==false || bundledSkill.path!==resolve(root,'skills/repo-context/SKILL.md')) {
    console.log(JSON.stringify({repoContext:skills.data.filter(skill=>skill.id==='repo-context').map(skill=>({id:skill.id,path:skill.path,autoinvoke:skill.autoinvoke})),expected:resolve(root,'skills/repo-context/SKILL.md')}));
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
  console.log(JSON.stringify({binary,runtime:version,pluginApi:pkg.version,pluginLoaded:true,resolvedAgents:true,nativeSessionCreated:!!persisted.id,bundledSkill:true,skillAutoinvoke:false,nativeFailureTelemetry:true,modelCalls:0},null,2));
} finally {await temporary.close();}
