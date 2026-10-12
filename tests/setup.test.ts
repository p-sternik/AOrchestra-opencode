import { expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mergeSetup, readConfig, saveConfig, isAOrchestraTarget, globalEnvironment, setupPackage, assertSetupVersion, primaryPermissions } from '../lib/setup';
import shippedTemplate from '../opencode.json';
import oldPermissions from '../lib/primary-permissions-v0.json';
import { removeTemporary } from '../scripts/runtime';
const template={plugins:[{package:'./plugins/aorchestra',options:{maxAttempts:2,models:{}}}],agents:{aorchestra:{system:'Main instructions',permissions:[{action:'shell',effect:'ask'}]},'aorchestra-executor':{system:'Worker instructions'}}};
const models={primary:'p/main',fast:'p/fast',balanced:'p/main',strong:'p/strong'};
test('stable setup pins the CLI version without Git; main pins a validated commit',async()=>{
  let calls=0;const revision=async()=>{calls++;return 'a'.repeat(40);};
  expect(await setupPackage('1.2.3',undefined,undefined,revision)).toBe('aorchestra-opencode-v2@1.2.3');
  expect(await setupPackage('1.2.3',undefined,'stable',revision)).toBe('aorchestra-opencode-v2@1.2.3');
  expect(await setupPackage('1.2.3','custom#commit',undefined,revision)).toBe('custom#commit');expect(calls).toBe(0);
  expect(await setupPackage('1.2.3',undefined,'main',revision)).toEndWith('#'+'a'.repeat(40));expect(calls).toBe(1);
  await expect(setupPackage('1.2.3','custom','main',revision)).rejects.toThrow('PACKAGE_CHANNEL_CONFLICT');
  await expect(setupPackage('1.2.3',undefined,'unknown',revision)).rejects.toThrow('INVALID_CHANNEL');
  await expect(setupPackage('1.2.3',undefined,'main',async()=>'main')).rejects.toThrow('CANNOT_PIN');
  expect(()=>assertSetupVersion('1.2.3','1.2.4','custom')).toThrow('CLI_PACKAGE_VERSION_MISMATCH');
  expect(()=>assertSetupVersion('1.2.3','1.2.3','custom')).not.toThrow();
});
test('setup migrates known ordered defaults and preserves custom permissions idempotently',()=>{
  for(const alias of ['repo-context','aorchestra-repo-context']) {
    const prior=oldPermissions.map(rule=>({...rule,resource:rule.resource==='aorchestra-repo-context'?alias:rule.resource}));
    const before='// retained\n'+JSON.stringify({agents:{aorchestra:{permissions:prior}},providers:{keep:true}});
    const after=mergeSetup(before,shippedTemplate,'aorchestra-opencode-v2@1.2.3',models);
    expect(readConfig(after).agents.aorchestra.permissions).toEqual(shippedTemplate.agents.aorchestra.permissions);
    expect(after).toContain('// retained');expect(readConfig(after).providers.keep).toBe(true);
    expect(mergeSetup(after,shippedTemplate,'aorchestra-opencode-v2@1.2.3',models)).toBe(after);
  }
  for(const prior of [oldPermissions.slice().reverse(),[...oldPermissions,{action:'shell',resource:'npm run test',effect:'ask'}],[]]) {
    const after=mergeSetup(JSON.stringify({agents:{aorchestra:{permissions:prior}}}),shippedTemplate,'aorchestra-opencode-v2@1.2.3',models);
    expect(readConfig(after).agents.aorchestra.permissions).toEqual(prior);
    expect(primaryPermissions(prior,shippedTemplate.agents.aorchestra.permissions).customized).toBe(true);
  }
});
test('global discovery retains the credential DB and directory while removing template overrides',()=>{
  const before={OPENCODE_DB:'user.db',OPENCODE_CONFIG_DIR:'global',OPENCODE_CONFIG:'template.json',OPENCODE_CONFIG_CONTENT:'{}'};
  const after=globalEnvironment(before);
  expect(after.OPENCODE_DB).toBe('user.db');expect(after.OPENCODE_CONFIG_DIR).toBe('global');
  expect(after.OPENCODE_CONFIG).toBeUndefined();expect(after.OPENCODE_CONFIG_CONTENT).toBeUndefined();expect(before.OPENCODE_CONFIG).toBe('template.json');
});
test('setup preserves JSONC comments, other agents, providers, default and unrelated plugins',()=>{
  const text='// User comment\n{"model":"old/model","default_agent":"build","providers":{"p":{"settings":{"x":1}}},"plugins":["*","other"],"agents":{"build":{"description":"keep"}}}';
  const result=mergeSetup(text,template,'aorchestra-opencode-v2@1.0.0',models);
  const config=readConfig(result);
  expect(result).toContain('// User comment');expect(config.model).toBe('old/model');expect(config.default_agent).toBe('build');
  expect(config.providers.p.settings.x).toBe(1);expect(config.agents.build.description).toBe('keep');
  expect(config.plugins.slice(0,2)).toEqual(['*','other']);expect(config.agents.aorchestra.model).toBe('p/main');
});
test('setup replaces old registration in place, retains budget/agent customization and is idempotent',()=>{
  const text=JSON.stringify({plugins:['other',{package:'C:/tools/old/plugins/aorchestra',options:{maxAttempts:1}},'aorchestra-opencode-v2@0.1.0'],agents:{aorchestra:{steps:17}}});
  const first=mergeSetup(text,template,'aorchestra-opencode-v2@1.0.0',models);
  expect(mergeSetup(first,template,'aorchestra-opencode-v2@1.0.0',models)).toBe(first);
  const config=readConfig(first);expect(config.plugins).toHaveLength(2);expect(config.plugins[1].options.maxAttempts).toBe(1);expect(config.agents.aorchestra.steps).toBe(17);
});
test('setup fails on malformed config and does not identify similarly named unrelated packages',()=>{
  expect(()=>readConfig('{bad')).toThrow('INVALID_GLOBAL_CONFIG');expect(()=>readConfig('{"plugins":{}}')).toThrow('INVALID_PLUGIN_LIST');
  expect(isAOrchestraTarget('other-aorchestra-opencode-v2')).toBe(false);
  expect(isAOrchestraTarget('github:p-sternik/AOrchestra-opencode#main')).toBe(true);
});
test('setup migrates the old bundled skill permission without disabling other skills',()=>{
  const before=JSON.stringify({plugins:['*','other'],agents:{aorchestra:{permissions:[{action:'skill',resource:'*',effect:'deny'},{action:'skill',resource:'repo-context',effect:'allow'},{action:'shell',resource:'*',effect:'ask'}]}}});
  const config=readConfig(mergeSetup(before,template,'aorchestra-opencode-v2@1.0.0',models));
  expect(config.plugins).not.toContain('-opencode.config.skill');
  expect(config.agents.aorchestra.permissions).toContainEqual({action:'skill',resource:'aorchestra-repo-context',effect:'allow'});
  expect(config.agents.aorchestra.permissions).toContainEqual({action:'shell',resource:'*',effect:'ask'});
});
test('native-identified custom sources can be upgraded without affecting unrelated packages',()=>{
  const before=JSON.stringify({plugins:['other',{package:'git+file:///old#revision',options:{maxAttempts:1}}],default_agent:'build'});
  const config=readConfig(mergeSetup(before,template,'git+file:///new#revision',models,true,['git+file:///old#revision']));
  expect(config.plugins).toHaveLength(2);expect(config.plugins[1].package).toBe('git+file:///new#revision');expect(config.plugins[1].options.maxAttempts).toBe(1);expect(config.default_agent).toBe('aorchestra');
});
test('config write backs up exact bytes, changes atomically and rejects concurrent edits',async()=>{
  const root=await mkdtemp(join(tmpdir(),'aorchestra-setup-test-'));const path=join(root,'opencode.jsonc');
  try {await writeFile(path,'// keep\n{}');const saved=await saveConfig(path,'// keep\n{}','{"x":1}');
    expect(await readFile(saved.backup!,'utf8')).toBe('// keep\n{}');expect(await readFile(path,'utf8')).toBe('{"x":1}');
    await expect(saveConfig(path,'{}','{"x":2}')).rejects.toThrow('CONFIG_CHANGED_DURING_SETUP');
    expect((await saveConfig(path,'{"x":1}','{"x":1}')).changed).toBe(false);
  } finally {await removeTemporary(root,'aorchestra-setup-test-');}
});
