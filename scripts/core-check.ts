import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { command, assertRuntime, privateClient, removeTemporary } from './runtime';
import { rpc as coreRpc } from '../tests/fixtures/core-probe';
import { rpc as proofRpc } from '../tests/fixtures/delegation-proof';
const proof = process.argv.includes('--delegation-proof');
const rpc = proof ? proofRpc : coreRpc;
const root = resolve(import.meta.dir, '..');
const scratch = await mkdtemp(resolve(tmpdir(), 'aorchestra-core-check-'));
try {
  const project = resolve(scratch, 'project');
  await mkdir(project);
  await writeFile(
    resolve(project, 'config.js'),
    'export const timeout=x=>x || 50; export const retries=x=>x ?? 2;\n',
  );
  await writeFile(resolve(project, 'api.ts'), 'export const api = "before";\n');
  await writeFile(resolve(project, 'other.ts'), 'export const other = "before";\n');
  await writeFile(resolve(project, '.env'), 'AUDIT_SECRET_MARKER=fake-fixture-value\n');
  await writeFile(resolve(project, 'AGENTS.md'), 'Preserve the existing api export.\n');
  const config = await Bun.file(resolve(root, 'opencode.json')).json();
  config.plugins = [
    '*',
    {
      package: resolve(
        root,
        proof ? 'tests/fixtures/delegation-proof' : 'tests/fixtures/core-probe',
      ),
      options: {
        autoSetup: false,
        noInferenceProbe: proof,
        updateCheck: false,
        models: { fast: 'audit-unavailable/model' },
      },
    },
  ];
  for (const [id, file] of [
    ['aorchestra', 'aorchestra.md'],
    ['aorchestra-executor', 'aorchestra-executor.md'],
  ])
    config.agents[id].system = await Bun.file(resolve(root, 'instructions', file)).text();
  const configPath = resolve(scratch, 'opencode.json');
  await writeFile(configPath, JSON.stringify(config));
  const env = {
    ...process.env,
    OPENCODE_CONFIG: configPath,
    OPENCODE_DB: resolve(scratch, 'check.db'),
    AORCHESTRA_DISABLE_SETUP: '1',
    AORCHESTRA_DISABLE_UPDATE: '1',
  };
  const version = (await command(['--version'], project)).trim();
  assertRuntime(version);
  const native = await privateClient(project, env);
  try {
    await native.client.location.get({ location: { directory: project } });
    for (let attempt = 0; attempt < 120; attempt++) {
      const plugins = await native.client.plugin.list({ location: { directory: project } });
      if (plugins.data.some((p) => p.id === 'aorchestra' && p.state.status === 'active')) break;
      if (attempt === 119) throw new Error('CORE_PROBE_NOT_ACTIVE');
      await Bun.sleep(250);
    }
    const result = await native.client.rpc(rpc).run({}, { location: { directory: project } });
    console.log(JSON.stringify({ version, result }, null, 2));
  } finally {
    await native.close();
  }
} finally {
  await removeTemporary(scratch, 'aorchestra-core-check-');
}
