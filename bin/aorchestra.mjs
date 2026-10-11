#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result = spawnSync('bun', [fileURLToPath(new URL('../scripts/cli.ts', import.meta.url)), ...process.argv.slice(2)], {
  stdio: 'inherit', windowsHide: true,
});
if (result.error) {
  console.error('Bun is required. Install Bun, then run this command again.');
  process.exit(1);
}
process.exit(result.status ?? 1);
