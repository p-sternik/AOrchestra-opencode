// Run native npm utilities outside the server plugin's Effect module boundary.
// The server bounds this worker and its child process tree to fifteen minutes.
import { Npm } from '@opencode/util/npm';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pkg from '../package.json';

const [version,from]=process.argv.slice(2);
if(!/^\d+\.\d+\.\d+$/.test(version??'') || !/^aorchestra-opencode-v2@\d+\.\d+\.\d+$/.test(from??''))throw new Error('INVALID_UPDATE_REQUEST');
const spec=`${pkg.name}@${version}`;
await Npm.add(spec);
const target=await Npm.resolve(spec);
const manifest=JSON.parse(await readFile(join(target.directory,'package.json'),'utf8'));
if(manifest.name!==pkg.name || manifest.version!==version)throw new Error('AUTO_UPDATE_PACKAGE_MISMATCH');
const child=Bun.spawn(['bun',join(target.directory,'scripts/cli.ts'),'setup',`--update-from=${from}`],{
  cwd:target.directory,env:{...process.env,AORCHESTRA_DISABLE_UPDATE:'1'},stdin:'ignore',stdout:'inherit',stderr:'inherit',
});
process.exit(await child.exited);
