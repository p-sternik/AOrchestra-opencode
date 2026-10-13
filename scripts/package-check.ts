import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import pkg from '../package.json';
import { tmpdir } from 'node:os';
import { removeTemporary } from './runtime';
const root = resolve(import.meta.dir, '..'),
  scratch = resolve(root, 'work/package-check');
await mkdir(scratch, { recursive: true });
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run npm run pack:check so npm_execpath is available');
async function run(args: string[], cwd = root) {
  const result = Bun.spawn(['node', npm!, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [out, error, code] = await Promise.all([
    new Response(result.stdout).text(),
    new Response(result.stderr).text(),
    result.exited,
  ]);
  if (code !== 0) throw new Error(error);
  return out;
}
const packOutput = await run(['pack', '--json', '--pack-destination', scratch]);
const parsed = JSON.parse(packOutput);
const packed = Array.isArray(parsed) ? parsed[0] : parsed.files ? parsed : parsed[pkg.name];
if (!packed?.files) throw new Error(`PACK_OUTPUT_INVALID: ${packOutput.slice(0, 500)}`);
const names = new Set(packed.files.map((file: any) => file.path));
for (const path of [
  'bin/aorchestra.mjs',
  'scripts/cli.ts',
  'scripts/update.ts',
  'lib/update.ts',
  'lib/version-status.ts',
  'plugins/aorchestra.ts',
  'plugins/aorchestra-tui.tsx',
  'plugins/aorchestra/tui.ts',
  'instructions/aorchestra.md',
  'skills/repo-context/SKILL.md',
  'skills/improve/SKILL.md',
  'skills/improve/references/diagnosis.md',
  'skills/improve/references/experiments.md',
])
  if (!names.has(path)) throw new Error(`PACKAGED_ASSET_MISSING: ${path}`);
if (
  [...names].some(
    (name) => String(name).startsWith('work/') || String(name).startsWith('node_modules/'),
  )
)
  throw new Error('UNEXPECTED_PACKAGED_ARTIFACT');
// Outside the checkout: neither ancestor tsconfig nor development dependencies may help.
const consumer = await mkdtemp(join(tmpdir(), 'aorchestra-package-check-'));
try {
  await run([
    'install',
    '--prefix',
    consumer,
    join(scratch, packed.filename),
    '--ignore-scripts',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
  ]);
  const installed = join(consumer, 'node_modules', pkg.name);
  const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  if (manifest.exports['./server'] !== './plugins/aorchestra.ts')
    throw new Error('SERVER_EXPORT_MISSING');
  if (manifest.exports['./tui'] !== './plugins/aorchestra-tui.tsx')
    throw new Error('TUI_EXPORT_MISSING');
  const module = await import(join(installed, 'plugins/aorchestra.ts'));
  if (module.default.id !== 'aorchestra') throw new Error('PACKAGED_PLUGIN_INVALID');
  const help = Bun.spawn(['node', join(installed, 'bin/aorchestra.mjs'), '--help'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = await new Response(help.stdout).text();
  if ((await help.exited) !== 0 || !output.includes('aorchestra setup'))
    throw new Error('PACKAGED_CLI_FAILED');
  const tuiCheck = join(consumer, 'tui-check.ts');
  await writeFile(tuiCheck, await readFile(join(root, 'tests/fixtures/packaged-tui.ts'), 'utf8'));
  for (const mode of ['development', 'production']) {
    const child = Bun.spawn([process.execPath, '--conditions=browser', tuiCheck], {
      cwd: consumer,
      env: { ...process.env, NODE_ENV: mode },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [output, error, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`PACKAGED_TUI_FAILED (${mode}): ${error} ${output}`);
    if (!JSON.parse(output.trim()).serverVersionRendered)
      throw new Error('PACKAGED_TUI_VERSION_MISSING');
  }
  console.log(
    JSON.stringify({
      version: manifest.version,
      packedAssets: names.size,
      productionInstall: true,
      pluginImport: true,
      cliHelp: true,
      packagedTuiRender: true,
      tuiModes: ['development', 'production'],
    }),
  );
} finally {
  await removeTemporary(consumer, 'aorchestra-package-check-');
}
