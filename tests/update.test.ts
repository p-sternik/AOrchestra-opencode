import { expect, test } from 'bun:test';
import { checkUpdate, updateOptions, updateInstallation, type Installation } from '../lib/update';
import { assertManagedUpdate, mergeSetup, readConfig } from '../lib/setup';
import { Flock } from '@opencode/util/flock';
import { mkdtemp, rm, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Plugin } from '@opencode/plugin';
import pkg from '../package.json';
import { versionStatus, type VersionStatus } from '../lib/version-status';

const spec='aorchestra-opencode-v2@1.2.3';
const models={primary:'p/main',fast:'p/fast',balanced:'p/balanced',strong:'p/strong'};
const template={plugins:[{options:{}}],agents:{aorchestra:{system:'new primary'},'aorchestra-executor':{system:'new worker'}}};
function fixture(options:Record<string,unknown>={}) {
  let config=readConfig(mergeSetup(JSON.stringify({default_agent:'build',providers:{keep:true},agents:{aorchestra:{steps:17}},plugins:[{package:spec,options}]}),template,spec,models,false,[],true));
  let state:any;let now=1000;let latest='1.2.4';const installs:string[]=[];let requests=0;
  let present=true;
  const deps={version:'1.2.3',options,
    load:async():Promise<Installation|undefined>=>present?{config,spec:config.plugins[0].package}:undefined,
    get:async()=>state,set:async(next:any)=>{state=structuredClone(next);},now:()=>now,
    latest:async()=>{requests++;return latest;},
    install:async(version:string,from:string)=>{
      assertManagedUpdate(config,from);
      installs.push(version);
      config=readConfig(mergeSetup(JSON.stringify(config),template,`aorchestra-opencode-v2@${version}`,models,false,[],true));
    },
  };
  return {deps,installs,get config(){return config;},get requests(){return requests;},get state(){return state;},advance:()=>{now+=86400000;},latest:(value:string)=>{latest=value;},absent:()=>{present=false;}};
}

test('managed stable setup enables updates and moves its marker while preserving user settings',async()=>{
  const f=fixture();
  expect(f.config.plugins[0].options.updateManagedPackage).toBe(spec);
  expect(f.config.plugins[0].options.autoUpdate).toBe(true);
  expect(await checkUpdate(f.deps)).toContain('Restart OpenCode');
  expect(f.installs).toEqual(['1.2.4']);
  expect(f.config.plugins[0].options.updateManagedPackage).toBe('aorchestra-opencode-v2@1.2.4');
  expect(f.config.default_agent).toBe('build');expect(f.config.providers.keep).toBe(true);
  expect(f.config.agents.aorchestra.steps).toBe(17);
  expect(f.config.plugins[0].options.models).toEqual({fast:models.fast,balanced:models.balanced,strong:models.strong});
});

test('disabled automatic installation and manual version pins only notify',async()=>{
  for(const mode of ['disabled','pin','project-disabled']) {
    const f=fixture(mode==='disabled'?{autoUpdate:false}:{});
    if(mode==='pin')delete f.config.plugins[0].options.updateManagedPackage;
    if(mode==='project-disabled')f.deps.options={autoUpdate:false};
    expect(await checkUpdate(f.deps)).toContain('is available');
    expect(f.installs).toHaveLength(0);
  }
});

test('explicit package and main setup remove management marker and retain disabled updates',()=>{
  const f=fixture({autoUpdate:false});
  const before=JSON.stringify(f.config);
  for(const target of [spec,'git+https://github.com/p-sternik/AOrchestra-opencode.git#'+'a'.repeat(40)]) {
    const after=readConfig(mergeSetup(before,template,target,models,false,[],false));
    expect(after.plugins[0].options.updateManagedPackage).toBeUndefined();
    expect(after.plugins[0].options.autoUpdate).toBe(false);
  }
});

test('checks can be disabled and source or prerelease installations do not access registry',async()=>{
  for(const mode of ['disabled','source','prerelease','global-disabled']) {
    const f=fixture();
    if(mode==='disabled')f.deps.options={updateCheck:false};
    if(mode==='source')f.absent();
    if(mode==='prerelease')f.deps.version='1.2.3-beta.1';
    if(mode==='global-disabled')f.config.plugins[0].options.updateCheck=false;
    expect(await checkUpdate(f.deps)).toBeUndefined();expect(f.requests).toBe(0);expect(f.installs).toHaveLength(0);
  }
  for(const name of ['autoUpdate','updateCheck'])expect(()=>updateOptions({[name]:'true'})).toThrow('INVALID_OPTION');
});

test('check attempts are throttled across restarts including offline and failed installs',async()=>{
  for(const mode of ['offline','installation','current','notification']) {
    const f=fixture(mode==='notification'?{autoUpdate:false}:{});
    if(mode==='offline')f.deps.latest=async()=>{throw new Error('offline');};
    if(mode==='installation')f.deps.install=async()=>{throw new Error('failed setup');};
    if(mode==='current')f.latest('1.2.3');
    const first=await checkUpdate(f.deps).catch(()=>undefined);
    expect(f.state.checkedAt).toBe(1000);
    expect((await checkUpdate(f.deps))===first).toBe(true);
    const previous=f.requests;f.advance();await checkUpdate(f.deps).catch(()=>undefined);
    if(mode!=='offline')expect(f.requests).toBe(previous+1);
  }
});

test('major upgrades, downgrades, prereleases and invalid registry versions never install',async()=>{
  for(const version of ['2.0.0','1.2.2','1.2.3','1.2.4-beta.1','invalid','1.2.4; touch /tmp/unwanted']) {
    const f=fixture();f.latest(version);await checkUpdate(f.deps);expect(f.installs).toHaveLength(0);
  }
});

test('pin changes or disabling updates during network access prevent installation',async()=>{
  for(const mode of ['pin','disable','remove']) {
    const f=fixture();
    f.deps.latest=async()=>{
      if(mode==='pin')f.config.plugins[0].package='aorchestra-opencode-v2@1.2.2';
      if(mode==='disable')f.config.plugins[0].options.autoUpdate=false;
      if(mode==='remove')f.absent();
      return '1.2.4';
    };
    await checkUpdate(f.deps).catch(()=>undefined);expect(f.installs).toHaveLength(0);
  }
});

test('automatic setup rejects ambiguous registrations, changed pins and incomplete models',()=>{
  for(const mode of ['duplicate','pin','marker','model','disabled','check-disabled']) {
    const f=fixture();
    if(mode==='duplicate')f.config.plugins.push(spec);
    if(mode==='pin')f.config.plugins[0].package='aorchestra-opencode-v2@1.2.2';
    if(mode==='marker')delete f.config.plugins[0].options.updateManagedPackage;
    if(mode==='model')delete f.config.plugins[0].options.models.strong;
    if(mode==='disabled')f.config.plugins[0].options.autoUpdate=false;
    if(mode==='check-disabled')f.config.plugins[0].options.updateCheck=false;
    expect(()=>assertManagedUpdate(f.config,spec)).toThrow();
  }
});

test('native file locking prevents simultaneous startup checks from installing twice',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'aorchestra-update-test-'));
  try {
    const f=fixture();
    await Promise.all([1,2].map(()=>Flock.withLock('update-test',()=>checkUpdate(f.deps),{dir:directory,timeoutMs:5000})));
    expect(f.installs).toEqual(['1.2.4']);expect(f.requests).toBe(1);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('update status publishes availability before installation and restores installed status on startup',async()=>{
  const f=fixture();const observed:VersionStatus[]=[];
  const deps={...f.deps,publish:(state:any)=>{observed.push(versionStatus('1.2.3',state));},install:async()=>{expect(observed.at(-1)).toEqual({version:'1.2.3',availableVersion:'1.2.4',installedVersion:null});}};
  await checkUpdate(deps);
  expect(observed.at(-1)).toEqual({version:'1.2.3',availableVersion:'1.2.4',installedVersion:'1.2.4'});
  observed.length=0;await checkUpdate(deps);
  expect(observed).toEqual([{version:'1.2.3',availableVersion:'1.2.4',installedVersion:'1.2.4'}]);
});

test('failed installation leaves availability visible without claiming a completed update',async()=>{
  const f=fixture();let status:VersionStatus|undefined;
  await expect(checkUpdate({...f.deps,publish:state=>{status=versionStatus('1.2.3',state);},install:async()=>{throw new Error('setup failed');}})).rejects.toThrow('setup failed');
  expect(status).toEqual({version:'1.2.3',availableVersion:'1.2.4',installedVersion:null});
  expect(f.state.installedVersion).toBeUndefined();
});

test('global JSONC discovery requires the matching active native package and rejects duplicate or local registrations',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'aorchestra-update-test-'));
  const target=`${pkg.name}@${pkg.version}`;
  let source:any={type:'package',target,version:pkg.version};
  const ctx={plugin:{list:async()=>({data:[{id:'aorchestra',source,state:{status:'active'}}]})}} as Pick<Plugin.Context,'plugin'>;
  const text='// keep\n'+JSON.stringify({plugins:[{package:target,options:{autoUpdate:true}}]});
  try {
    expect(await updateInstallation(directory,ctx)).toBeUndefined();
    await writeFile(join(directory,'opencode.jsonc'),text);
    expect((await updateInstallation(directory,ctx))?.spec).toBe(target);
    for(const other of [{type:'local',path:'/checkout/plugins/aorchestra'},{type:'package',target:'other',version:pkg.version},{type:'package',target,version:'0.0.0'}]) {
      source=other;expect(await updateInstallation(directory,ctx)).toBeUndefined();
    }
    source={type:'package',target,version:pkg.version};
    await writeFile(join(directory,'opencode.json'),text);
    expect(await updateInstallation(directory,ctx)).toBeUndefined();
    await unlink(join(directory,'opencode.json'));
    await writeFile(join(directory,'opencode.jsonc'),JSON.stringify({plugins:[target,target]}));
    expect(await updateInstallation(directory,ctx)).toBeUndefined();
    await writeFile(join(directory,'opencode.jsonc'),'{broken');
    await expect(updateInstallation(directory,ctx)).rejects.toThrow('INVALID_GLOBAL_CONFIG');
  }finally{await rm(directory,{recursive:true,force:true});}
});
