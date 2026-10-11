import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';
import { readFile, writeFile, mkdir, rename, unlink, realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BUNDLED_SKILL_ID } from './core';

type RecordValue = Record<string, any>;
export type Models = { primary: string; fast: string; balanced: string; strong: string };
export function readConfig(text: string): RecordValue {
  const errors: ParseError[] = [];
  const value = parse(text, errors, {allowTrailingComma:true});
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_GLOBAL_CONFIG');
  if (value.plugins !== undefined && !Array.isArray(value.plugins)) throw new Error('INVALID_PLUGIN_LIST');
  if (value.agents !== undefined && (!value.agents || typeof value.agents !== 'object' || Array.isArray(value.agents))) throw new Error('INVALID_AGENTS');
  return value;
}
export function isAOrchestraTarget(target: string): boolean {
  return /^aorchestra-opencode-v2(?:@|$)/.test(target)
    || /^(?:github:|git\+https:\/\/github\.com\/|https:\/\/github\.com\/)p-sternik\/AOrchestra-opencode(?:\.git)?(?:#|$)/i.test(target)
    || /(?:^|[\\/])plugins[\\/]aorchestra[\\/]?$/.test(target);
}
export function mergeSetup(text: string, template: RecordValue, spec: string, models: Models, makeDefault = false, observedTargets: string[] = []): string {
  const existing = readConfig(text);
  const matches = (target:string)=>target===spec || observedTargets.includes(target) || isAOrchestraTarget(target);
  const oldPlugin = existing.plugins?.find((entry: any)=>typeof entry==='object' && entry && matches(entry.package ?? ''));
  const options = {...template.plugins.find((entry:any)=>typeof entry==='object').options, ...oldPlugin?.options,
    models:{fast:models.fast,balanced:models.balanced,strong:models.strong}};
  const plugin = {package:spec, options};
  let inserted = false;
  const plugins = (existing.plugins ?? []).flatMap((entry:any)=>{
    const target = typeof entry==='string' ? entry : entry?.package;
    if (typeof target==='string' && matches(target)) {
      if (inserted) return [];
      inserted=true; return [plugin];
    }
    return [entry];
  });
  if (!inserted) plugins.push(plugin);
  const set = (path: string[], value: unknown) => {
    text = applyEdits(text, modify(text,path,value,{formattingOptions:{tabSize:2,insertSpaces:true,eol:text.includes('\r\n')?'\r\n':'\n'}}));
  };
  set(['plugins'],plugins);
  for (const id of ['aorchestra','aorchestra-executor']) {
    const prior = existing.agents?.[id];
    if (prior !== undefined && (!prior || typeof prior!=='object' || Array.isArray(prior))) throw new Error('INVALID_EXISTING_AGENT');
    const agent = {...template.agents[id],...prior,system:template.agents[id].system};
    if (id==='aorchestra') agent.model=models.primary;
    if (id==='aorchestra' && Array.isArray(agent.permissions)) agent.permissions=agent.permissions.map((rule:any)=>rule.action==='skill'&&rule.resource==='repo-context'&&rule.effect==='allow'?{...rule,resource:BUNDLED_SKILL_ID}:rule);
    set(['agents',id],agent);
  }
  if (makeDefault || existing.default_agent === undefined) set(['default_agent'],'aorchestra');
  return text;
}
export async function saveConfig(path: string, before: string | undefined, after: string): Promise<{changed:boolean;backup?:string}> {
  if (before === after) return {changed:false};
  // Follow existing dotfile symlinks rather than replacing the link with a file.
  path=await realpath(path).catch(error=>{if(error.code==='ENOENT')return path;throw error;});
  const current = await readFile(path,'utf8').catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
  if (current !== before) throw new Error('CONFIG_CHANGED_DURING_SETUP: retry after reviewing the current file');
  await mkdir(dirname(path),{recursive:true});
  const backup = before === undefined ? undefined : `${path}.aorchestra-backup-${randomUUID()}`;
  if (backup) await writeFile(backup,before!,{flag:'wx',mode:0o600});
  const temporary = `${path}.aorchestra-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary,after,{flag:'wx',mode:0o600});
    const latest = await readFile(path,'utf8').catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
    if (latest !== before) throw new Error('CONFIG_CHANGED_DURING_SETUP');
    await rename(temporary,path);
  } finally { await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;}); }
  return {changed:true,...(backup?{backup}:{})};
}
