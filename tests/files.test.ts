import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { canonicalTarget, snapshot, fingerprint, changedPaths } from '../lib/files';
async function fixture() {
  const scratch = resolve(import.meta.dir, '../work/tests');
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'fs-'));
  return {
    root,
    clean: async () => {
      if (!root.startsWith(`${scratch}\\`) && !root.startsWith(`${scratch}/`))
        throw new Error('CLEANUP_ESCAPE');
      await rm(root, { recursive: true });
    },
  };
}
test('canonical target rejects existing and new symlink escape targets', async () => {
  const f = await fixture(),
    external = await fixture();
  try {
    await writeFile(join(external.root, 'outside.txt'), 'outside');
    await symlink(
      external.root,
      join(f.root, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(canonicalTarget(f.root, 'escape/outside.txt')).rejects.toThrow('SYMLINK_ESCAPE');
    await expect(canonicalTarget(f.root, 'escape/new.txt')).rejects.toThrow('SYMLINK_ESCAPE');
  } finally {
    await f.clean();
    await external.clean();
  }
});
test('canonical target supports normal new files and rejects traversal and secrets', async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.root, 'src'));
    expect(await canonicalTarget(f.root, 'src/new.ts')).toBe(join(f.root, 'src/new.ts'));
    await expect(canonicalTarget(f.root, '../outside')).rejects.toThrow();
    await expect(canonicalTarget(f.root, '.env')).rejects.toThrow();
  } finally {
    await f.clean();
  }
});
test('snapshot detects untracked additions, content mutations and deletions', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, 'api.ts'), 'old');
    const before = await snapshot(f.root);
    await writeFile(join(f.root, 'api.ts'), 'new');
    await writeFile(join(f.root, 'consumer.ts'), 'added');
    const after = await snapshot(f.root);
    expect(fingerprint(before)).not.toBe(fingerprint(after));
    expect(changedPaths(before, after)).toEqual(['api.ts', 'consumer.ts']);
    await rm(join(f.root, 'api.ts'));
    expect(changedPaths(after, await snapshot(f.root))).toEqual(['api.ts']);
  } finally {
    await f.clean();
  }
});
test('snapshot ignores root artifacts but preserves source directories named build', async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.root, 'build'));
    await mkdir(join(f.root, 'src/build'), { recursive: true });
    await writeFile(join(f.root, 'build/output.js'), 'generated');
    await writeFile(join(f.root, 'src/build/logic.ts'), 'source');
    expect(Object.keys(await snapshot(f.root))).toEqual(['src/build/logic.ts']);
  } finally {
    await f.clean();
  }
});
