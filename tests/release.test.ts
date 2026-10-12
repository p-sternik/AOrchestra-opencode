import { expect, test } from 'bun:test';
import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Execute the actual workflow commands with a recording GitHub CLI fixture.
// SHA rejection models the merge API lease; no GitHub writes occur.
test.skipIf(process.platform === 'win32')('automatic release merges only the validated SHA and dispatches only after success',async()=>{
  const root=await mkdtemp(join(tmpdir(),'aorchestra-auto-release-'));
  try {
    const workflow=await readFile(new URL('../.github/workflows/release.yml',import.meta.url),'utf8');
    const inline=workflow.split('      - name: Merge validated release PR and continue release\n        run: |\n')[1]?.split('\n  publish-npm:')[0];
    expect(inline).toBeDefined();
    const script=inline!.split('\n').map(line=>line.replace(/^          /,'')).join('\n');
    await writeFile(join(root,'gh'),`#!/usr/bin/env node
const fs=require('node:fs');
const args=process.argv.slice(2);
fs.appendFileSync(process.env.CALL_LOG,JSON.stringify(args)+'\\n');
if(args[0]==='workflow')process.exit(process.env.SCENARIO==='dispatch-failed'?1:0);
if(args.includes('PUT')){
  if(!args.includes('sha='+process.env.PR_HEAD_SHA)||!args.includes('merge_method=squash'))process.exit(9);
  if(process.env.SCENARIO==='merge-failed'||process.env.SCENARIO==='head-race')process.exit(1);
}else if(process.env.SCENARIO==='identity-changed')process.exit(1);
console.log('ok');
`);
    await chmod(join(root,'gh'),0o755);
    for(const scenario of ['success','identity-changed','merge-failed','head-race','invalid-sha','dispatch-failed']) {
      const log=join(root,scenario);
      const child=Bun.spawn(['bash','-e','-o','pipefail','-c',script],{env:{...process.env,PATH:`${root}:${process.env.PATH}`,GITHUB_REPOSITORY:'owner/repo',PR_NUMBER:'12',PR_HEAD_SHA:scenario==='invalid-sha'?'':'a'.repeat(40),CALL_LOG:log,SCENARIO:scenario},stdout:'pipe',stderr:'pipe'});
      expect(await child.exited).toBe(scenario==='success'?0:1);
      const calls=(await readFile(log,'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line) as string[]);
      expect(calls.length).toBe(scenario==='invalid-sha'?0:scenario==='identity-changed'?1:scenario==='success'||scenario==='dispatch-failed'?3:2);
      if(calls.length===3)expect(calls[2]).toEqual(['workflow','run','release.yml','--repo','owner/repo','--ref','main']);
      if(calls.length>=2)expect(calls[1]).toContain('sha='+'a'.repeat(40));
    }
  }finally{await rm(root,{recursive:true,force:true});}
});

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
