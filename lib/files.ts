import { lstat, readFile, realpath, readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { digest, inside, portablePath, scopedPath, secretPath } from './core';

export async function canonicalTarget(root: string, path: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const target = scopedPath(canonicalRoot, path);
  let existing = target;
  const suffix: string[] = [];
  while (true) {
    try {
      const canonical = await realpath(existing);
      if (!inside(canonicalRoot, canonical) || secretPath(relative(canonicalRoot, canonical))) throw new Error('SYMLINK_ESCAPE_OR_SENSITIVE');
      return resolve(canonical, ...suffix.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = resolve(existing, '..');
      if (parent === existing) throw error;
      suffix.push(existing.slice(parent.length).replace(/^[\\/]/, ''));
      existing = parent;
    }
  }
}

// A conservative snapshot of project sources. Symlinks are represented, never traversed.
// Native tools perform reads/edits; this module only measures state for evidence freshness.
export async function snapshot(root: string, ignored: string[] = []): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const exclude = new Set(['.git', '.opencode', 'node_modules', '.cache', ...ignored]);
  const rootArtifacts = new Set(['coverage', 'dist', 'build']);
  let count = 0;
  async function walk(directory: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = resolve(directory, entry.name);
      const path = portablePath(relative(root, absolute));
      if (exclude.has(entry.name) || (directory === root && rootArtifacts.has(entry.name)) || secretPath(path)) continue;
      if (++count > 30_000) throw new Error('SNAPSHOT_TOO_LARGE: configure snapshotIgnore or use a smaller project location');
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) { result[path] = `symlink:${info.mtimeMs}:${info.size}`; continue; }
      if (info.isDirectory()) await walk(absolute);
      else if (info.isFile()) {
        if (info.size > 8_000_000) throw new Error(`SNAPSHOT_FILE_TOO_LARGE: ${path}`);
        result[path] = digest((await readFile(absolute)).toString('base64'));
      }
    }
  }
  await walk(root);
  return result;
}
export const fingerprint = (files: Record<string, string>) => digest(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
export const changedPaths = (before: Record<string, string>, after: Record<string, string>) => [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => before[path] !== after[path]).sort();
