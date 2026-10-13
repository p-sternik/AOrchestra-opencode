import { readFile } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import { digest, portablePath, type Task, type Verifier } from './core';
import { canonicalTarget } from './files';

export type VerificationRule = { paths: string[]; verifiers: Verifier[] };
export type VerificationPlan = {
  snapshot: string;
  affectedPaths: string[];
  verifiers: Verifier[];
  sources: string[];
  gaps: string[];
  observations: Record<string, { event: string; snapshot: string; passed: boolean }>;
};
export const taskVerifiers = (task: Task): Verifier[] => [
  ...task.verifiers,
  ...(task.verification?.verifiers ?? []),
];
const matches = (file: string, path: string) =>
  path === '.' || file === path || file.startsWith(`${path}/`);
export function validateVerificationRules(raw: unknown): VerificationRule[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 50) throw new Error('INVALID_VERIFICATION_RULES');
  for (const rule of raw) {
    if (
      !rule ||
      !Array.isArray(rule.paths) ||
      !rule.paths.length ||
      rule.paths.some(
        (p: unknown) =>
          typeof p !== 'string' ||
          !p ||
          p.startsWith('/') ||
          p.includes('\\') ||
          p.includes(':') ||
          p.split('/').includes('..') ||
          /[*?]/.test(p),
      )
    )
      throw new Error('INVALID_VERIFICATION_PATH');
    if (
      !Array.isArray(rule.verifiers) ||
      !rule.verifiers.length ||
      rule.verifiers.length > 10 ||
      rule.verifiers.some(
        (v: Verifier) =>
          !v ||
          typeof v.id !== 'string' ||
          !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(v.id) ||
          typeof v.tool !== 'string' ||
          !v.tool.trim() ||
          !v.input ||
          typeof v.input !== 'object' ||
          Array.isArray(v.input) ||
          !Object.keys(v.input).length ||
          Object.values(v.input).some((value) => typeof value !== 'string') ||
          !v.expect ||
          typeof v.expect !== 'object' ||
          (v.expect.exitCode === undefined && !v.expect.contains) ||
          (v.expect.contains !== undefined &&
            (typeof v.expect.contains !== 'string' || !v.expect.contains.trim())) ||
          (v.expect.exitCode !== undefined && !Number.isInteger(v.expect.exitCode)),
      )
    )
      throw new Error('INVALID_VERIFICATION_PREDICATE');
  }
  return structuredClone(raw) as VerificationRule[];
}
const predicateKey = (v: Verifier, root: string) => {
  const input =
    v.tool === 'shell' ? { ...v.input, workdir: resolve(root, v.input.workdir ?? '.') } : v.input;
  return digest({
    tool: v.tool,
    input: Object.fromEntries(Object.entries(input).sort()),
    expect: v.expect,
  });
};

// Select whole existing scripts, never fabricate framework-specific flags or test paths.
// No commands run here: the primary invokes these through native tools/permissions.
export async function verificationPlan(
  root: string,
  task: Task,
  affectedPaths: string[],
  snapshot: string,
  rules: VerificationRule[] = [],
): Promise<VerificationPlan> {
  const plan: VerificationPlan = {
    snapshot,
    affectedPaths: [...affectedPaths].sort(),
    verifiers: [],
    sources: [],
    gaps: [],
    observations: {},
  };
  const seen = new Set(task.verifiers.map((v) => predicateKey(v, root)));
  const add = (v: Verifier) => {
    const key = predicateKey(v, root);
    if (seen.has(key)) return;
    seen.add(key);
    plan.verifiers.push({ ...v, id: `auto-${key.slice(0, 24)}` });
  };
  const paths = affectedPaths.length ? affectedPaths : task.writePaths;
  const uncovered: string[] = [];
  for (const file of paths) {
    const applicable = rules.filter((rule) => rule.paths.some((path) => matches(file, path)));
    if (applicable.length) {
      for (const rule of applicable) for (const v of rule.verifiers) add(v);
      if (!plan.sources.includes('plugin options.verification'))
        plan.sources.push('plugin options.verification');
    } else uncovered.push(file);
  }
  const manifests = new Set<string>();
  for (const file of uncovered) {
    let directory = posix.dirname(portablePath(file));
    for (;;) {
      const path = directory === '.' ? 'package.json' : `${directory}/package.json`;
      try {
        const content = await readFile(await canonicalTarget(root, path), 'utf8');
        const pkg = JSON.parse(content) as {
          scripts?: Record<string, unknown>;
          packageManager?: unknown;
        };
        if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg))
          throw new Error('Invalid manifest');
        if (!manifests.has(path)) {
          manifests.add(path);
          plan.sources.push(path);
          // Explicit manager declaration wins. Otherwise nearest lockfile wins;
          // conflicting lockfiles are a gap, never a guessed package manager.
          let manager: string | undefined;
          if (pkg.packageManager !== undefined)
            manager =
              typeof pkg.packageManager === 'string'
                ? /^(npm|pnpm|yarn|bun)@[^\s]+$/.exec(pkg.packageManager)?.[1]
                : undefined;
          else {
            let lockDirectory = directory;
            for (;;) {
              if (lockDirectory !== directory) {
                const ancestor =
                  lockDirectory === '.' ? 'package.json' : `${lockDirectory}/package.json`;
                try {
                  const parent = JSON.parse(
                    await readFile(await canonicalTarget(root, ancestor), 'utf8'),
                  );
                  if (!parent || typeof parent !== 'object' || Array.isArray(parent))
                    throw new Error('Invalid manifest');
                  if (parent.packageManager !== undefined) {
                    manager =
                      typeof parent.packageManager === 'string'
                        ? /^(npm|pnpm|yarn|bun)@[^\s]+$/.exec(parent.packageManager)?.[1]
                        : undefined;
                    if (!plan.sources.includes(ancestor)) plan.sources.push(ancestor);
                    break;
                  }
                } catch (error) {
                  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                }
              }
              const found = new Set<string>();
              for (const [lock, value] of [
                ['package-lock.json', 'npm'],
                ['npm-shrinkwrap.json', 'npm'],
                ['pnpm-lock.yaml', 'pnpm'],
                ['yarn.lock', 'yarn'],
                ['bun.lock', 'bun'],
                ['bun.lockb', 'bun'],
              ]) {
                try {
                  await readFile(
                    await canonicalTarget(
                      root,
                      lockDirectory === '.' ? lock : `${lockDirectory}/${lock}`,
                    ),
                  );
                  found.add(value);
                } catch (error) {
                  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                }
              }
              if (found.size) {
                if (found.size === 1) manager = [...found][0];
                break;
              }
              if (lockDirectory === '.') {
                manager = 'npm';
                break;
              }
              lockDirectory = posix.dirname(lockDirectory);
            }
          }
          const scripts = ['typecheck', 'lint', 'test'].filter(
            (name) => typeof pkg.scripts?.[name] === 'string' && String(pkg.scripts[name]).trim(),
          );
          if (!manager || !scripts.length)
            plan.gaps.push(
              `${path}: ${!manager ? 'package manager unresolved' : 'no typecheck/lint/test scripts; configure verification rules or task predicates'}`,
            );
          else
            for (const name of scripts)
              add({
                id: name,
                tool: 'shell',
                input: {
                  command: `${manager} run ${name}`,
                  workdir: await canonicalTarget(root, directory),
                },
                expect: { exitCode: 0 },
              });
        }
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (directory === '.') {
          plan.gaps.push(
            `${file}: no package.json; configure verification rules or task predicates`,
          );
          break;
        }
        directory = posix.dirname(directory);
      }
    }
  }
  // User-authored IDs cannot collide with generated predicate IDs.
  if (plan.verifiers.some((v) => task.verifiers.some((manual) => manual.id === v.id)))
    throw new Error('VERIFIER_ID_DUPLICATE');
  for (const verifier of [...task.verifiers, ...plan.verifiers]) {
    const observed = task.verification?.observations?.[verifier.id];
    if (observed) plan.observations[verifier.id] = observed;
  }
  return plan;
}
