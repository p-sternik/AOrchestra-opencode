import { expect, test } from 'bun:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The publication job runs on Linux. Execute its actual inline script against a
// local registry fixture and real npm packing, without publishing anything.
test.skipIf(process.platform === 'win32')('release retries require matching archive integrity and publish metadata comes from the checked archive',async()=>{
  const root=await mkdtemp(join(tmpdir(),'aorchestra-release-'));
  let status=200;let integrity='';
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>Response.json({name:'aorchestra-release-fixture',version:'1.0.0',dist:{integrity}},{status})});
  try {
    await writeFile(join(root,'package.json'),JSON.stringify({name:'aorchestra-release-fixture',version:'1.0.0',files:['index.js'],scripts:{prepack:'node -e "process.exit(42)"'}}));
    await writeFile(join(root,'index.js'),'export const fixture = true;\n');
    const workflow=await readFile(new URL('../.github/workflows/release.yml',import.meta.url),'utf8');
    const inline=workflow.split("node --input-type=module <<'JS'\n")[1]?.split('\n          JS')[0];
    expect(inline).toBeDefined();
    const script=inline!.split('\n').map(line=>line.replace(/^          /,'')).join('\n').replace('https://registry.npmjs.org',server.url.origin);
    const pack=Bun.spawn(['npm','pack','--json','--ignore-scripts'],{cwd:root,stdout:'pipe',stderr:'pipe'});
    const packed=JSON.parse(await new Response(pack.stdout).text())[0];
    expect(await pack.exited).toBe(0);integrity=packed.integrity;
    for(const scenario of [{status:200,match:true,success:true},{status:200,match:false,success:false},{status:404,match:false,success:true},{status:503,match:false,success:false}]) {
      status=scenario.status;integrity=scenario.match?packed.integrity:'sha512-mismatch';
      const output=join(root,`output-${status}-${scenario.match}`);
      const child=Bun.spawn(['node','--input-type=module','-e',script],{cwd:root,env:{...process.env,GITHUB_OUTPUT:output},stdout:'pipe',stderr:'pipe'});
      const error=await new Response(child.stderr).text();const code=await child.exited;
      if(scenario.success) {
        expect(code).toBe(0);
        expect(await readFile(output,'utf8')).toBe(`exists=${status===200}\narchive=${packed.filename}\n`);
      } else {
        expect(code).not.toBe(0);
        expect(error).toContain(status===200?'differs from the tagged package':'Registry HTTP 503');
        expect(await readFile(output,'utf8').catch(()=>undefined)).toBeUndefined();
      }
    }
  }finally{server.stop(true);await rm(root,{recursive:true,force:true});}
},15000);
