import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';
import { readFile, writeFile, mkdir, rename, unlink, realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BUNDLED_SKILL_ID } from './core';
import legacyPermissions from './primary-permissions-v0.json';
import v050Permissions from './primary-permissions-v050.json';
import v090Permissions from './primary-permissions-v090.json';

type RecordValue = Record<string, any>;
export type Models = { primary: string; fast: string; balanced: string; strong: string };
const permissionKey = (rules: unknown) =>
  JSON.stringify(rules, (key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );
const normalizedPermissions = (prior: unknown) =>
  Array.isArray(prior)
    ? prior.map((rule) =>
        rule?.action === 'skill' && rule.resource === 'repo-context' && rule.effect === 'allow'
          ? { ...rule, resource: BUNDLED_SKILL_ID }
          : rule,
      )
    : prior;
export function primaryPermissions(
  prior: unknown,
  defaults: unknown,
): { rules: unknown; customized: boolean } {
  const rules = normalizedPermissions(prior);
  if (
    rules === undefined ||
    [legacyPermissions, v050Permissions, v090Permissions].some(
      (defaults) => permissionKey(rules) === permissionKey(defaults),
    )
  )
    return { rules: defaults, customized: false };
  return { rules, customized: permissionKey(rules) !== permissionKey(defaults) };
}
export async function setupPackage(
  version: string,
  explicit: string | undefined,
  channel: string | undefined,
  mainRevision: () => Promise<string>,
): Promise<string> {
  if (channel !== undefined && channel !== 'stable' && channel !== 'main')
    throw new Error('INVALID_CHANNEL: use stable or main');
  if (explicit !== undefined && channel !== undefined)
    throw new Error('PACKAGE_CHANNEL_CONFLICT: choose --package or --channel');
  if (explicit !== undefined) {
    if (!explicit.trim()) throw new Error('PACKAGE_REQUIRED');
    return explicit;
  }
  if (channel !== 'main') return `aorchestra-opencode-v2@${version}`;
  const revision = await mainRevision();
  if (!/^[a-f0-9]{40}$/.test(revision))
    throw new Error('CANNOT_PIN_GITHUB_REVISION: provide --package explicitly');
  return `git+https://github.com/p-sternik/AOrchestra-opencode.git#${revision}`;
}
export function assertSetupVersion(cliVersion: string, packageVersion: string, spec: string): void {
  if (cliVersion !== packageVersion)
    throw new Error(
      `CLI_PACKAGE_VERSION_MISMATCH: run the CLI from ${spec} with setup --package=${spec}`,
    );
}
export function globalEnvironment(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...input };
  delete env.OPENCODE_CONFIG;
  delete env.OPENCODE_CONFIG_CONTENT;
  return env;
}
export function readConfig(text: string): RecordValue {
  const errors: ParseError[] = [];
  const value = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INVALID_GLOBAL_CONFIG');
  if (value.plugins !== undefined && !Array.isArray(value.plugins))
    throw new Error('INVALID_PLUGIN_LIST');
  if (
    value.agents !== undefined &&
    (!value.agents || typeof value.agents !== 'object' || Array.isArray(value.agents))
  )
    throw new Error('INVALID_AGENTS');
  return value;
}
export function isAOrchestraTarget(target: string): boolean {
  return (
    /^aorchestra-opencode-v2(?:@|$)/.test(target) ||
    /^(?:github:|git\+https:\/\/github\.com\/|https:\/\/github\.com\/)p-sternik\/AOrchestra-opencode(?:\.git)?(?:#|$)/i.test(
      target,
    ) ||
    /(?:^|[\\/])plugins[\\/]aorchestra[\\/]?$/.test(target)
  );
}
export function mergeSetup(
  text: string,
  template: RecordValue,
  spec: string,
  models: Models,
  makeDefault = false,
  observedTargets: string[] = [],
  managedUpdate?: boolean,
  lowerConfig: RecordValue = {},
): string {
  const existing = readConfig(text);
  const matches = (target: string) =>
    target === spec || observedTargets.includes(target) || isAOrchestraTarget(target);
  const oldPlugin = existing.plugins?.find(
    (entry: any) => typeof entry === 'object' && entry && matches(entry.package ?? ''),
  );
  const options = {
    ...template.plugins.find((entry: any) => typeof entry === 'object').options,
    ...oldPlugin?.options,
    models: { fast: models.fast, balanced: models.balanced, strong: models.strong },
  };
  if (managedUpdate !== undefined) {
    delete options.updateManagedPackage;
    if (managedUpdate) {
      options.updateManagedPackage = spec;
      options.autoUpdate ??= true;
    }
  }
  const plugin = { package: spec, options };
  let inserted = false;
  const plugins = (existing.plugins ?? []).flatMap((entry: any) => {
    const target = typeof entry === 'string' ? entry : entry?.package;
    if (typeof target === 'string' && matches(target)) {
      if (inserted) return [];
      inserted = true;
      return [plugin];
    }
    return [entry];
  });
  if (!inserted) plugins.push(plugin);
  const set = (path: string[], value: unknown) => {
    text = applyEdits(
      text,
      modify(text, path, value, {
        formattingOptions: {
          tabSize: 2,
          insertSpaces: true,
          eol: text.includes('\r\n') ? '\r\n' : '\n',
        },
      }),
    );
  };
  set(['plugins'], plugins);
  for (const id of ['aorchestra', 'aorchestra-executor']) {
    const lower = lowerConfig.agents?.[id],
      upper = existing.agents?.[id];
    for (const value of [lower, upper])
      if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value)))
        throw new Error('INVALID_EXISTING_AGENT');
    const lowerRules = normalizedPermissions(lower?.permissions),
      upperRules = normalizedPermissions(upper?.permissions);
    const prior =
      lower === undefined
        ? upper
        : {
            ...lower,
            ...upper,
            // Native config appends ordered permissions from JSON, then JSONC.
            ...(Array.isArray(lowerRules) && Array.isArray(upperRules)
              ? {
                  permissions:
                    permissionKey(upperRules.slice(0, lowerRules.length)) ===
                    permissionKey(lowerRules)
                      ? upperRules
                      : [...lowerRules, ...upperRules],
                }
              : {}),
          };
    const agent = { ...template.agents[id], ...prior, system: template.agents[id].system };
    if (id === 'aorchestra') agent.model = models.primary;
    if (id === 'aorchestra')
      agent.permissions = primaryPermissions(
        prior?.permissions,
        template.agents[id].permissions,
      ).rules;
    set(['agents', id], agent);
  }
  if (
    makeDefault ||
    (existing.default_agent === undefined && lowerConfig.default_agent === undefined)
  )
    set(['default_agent'], 'aorchestra');
  return text;
}
// Setup pins packages for reproducibility; only its matching marker permits
// automatic replacement. Editing the package spec makes it a manual pin.
export function assertManagedUpdate(config: RecordValue, expected: string): void {
  const entries = (config.plugins ?? []).filter((entry: any) =>
    isAOrchestraTarget(typeof entry === 'string' ? entry : (entry?.package ?? '')),
  );
  const entry = entries[0];
  if (
    entries.length !== 1 ||
    entry?.package !== expected ||
    entry.options?.updateManagedPackage !== expected ||
    entry.options?.autoUpdate === false ||
    entry.options?.updateCheck === false
  )
    throw new Error('AUTO_UPDATE_CONFIG_CHANGED: update skipped; rerun setup manually');
  if (
    ![
      config.agents?.aorchestra?.model,
      ...['fast', 'balanced', 'strong'].map((tier) => entry.options?.models?.[tier]),
    ].every((model) => typeof model === 'string' && model.length > 0)
  )
    throw new Error('AUTO_UPDATE_MODELS_REQUIRED: rerun setup manually');
}
export async function saveConfig(
  path: string,
  before: string | undefined,
  after: string,
): Promise<{ changed: boolean; backup?: string }> {
  if (before === after) return { changed: false };
  // Follow existing dotfile symlinks rather than replacing the link with a file.
  path = await realpath(path).catch((error) => {
    if (error.code === 'ENOENT') return path;
    throw error;
  });
  const current = await readFile(path, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (current !== before)
    throw new Error('CONFIG_CHANGED_DURING_SETUP: retry after reviewing the current file');
  await mkdir(dirname(path), { recursive: true });
  const backup = before === undefined ? undefined : `${path}.aorchestra-backup-${randomUUID()}`;
  if (backup) await writeFile(backup, before!, { flag: 'wx', mode: 0o600 });
  const temporary = `${path}.aorchestra-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, after, { flag: 'wx', mode: 0o600 });
    const latest = await readFile(path, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (latest !== before) throw new Error('CONFIG_CHANGED_DURING_SETUP');
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  return { changed: true, ...(backup ? { backup } : {}) };
}
