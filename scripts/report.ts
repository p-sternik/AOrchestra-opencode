import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { OpenCode } from '@opencode/client/promise';
import { Service } from '@opencode/client/service';
import { privateClient } from './runtime';
import { metricsRpc, type Run } from '../lib/telemetry';
import { aggregate, markdown } from '../lib/report';
const option=(name:string)=>process.argv.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3);
const root=resolve(import.meta.dir,'..'),project=resolve(option('project')??process.cwd());
const limit=Number(option('limit')??'1000');
if(!Number.isInteger(limit)||limit<1||limit>10000)throw new Error('Report limit must be 1..10000');
let runs:Run[]=[],truncated=false;
const input=option('input');
if(input){
  const data=JSON.parse(await readFile(resolve(input),'utf8'));
  if(data.version!==1||!Array.isArray(data.runs)||data.runs.some((r:Run)=>r.version!==1||typeof r.id!=='string'||typeof r.sessionID!=='string'||!Array.isArray(r.tasks)||!Array.isArray(r.children)||!r.inspections||!r.models||!r.tools))throw new Error('Invalid metrics dataset');
  runs=data.runs.slice(0,limit);truncated=data.runs.length>limit;
}else{
  let close=async()=>{};
  const server=option('server');
  let client:ReturnType<typeof OpenCode.make>;
  if(server){const password=process.env.OPENCODE_SERVER_PASSWORD;client=OpenCode.make({baseUrl:server,headers:password?{authorization:`Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`}:{}});}
  else{
    const endpoint=process.env.OPENCODE_DB?undefined:await Service.discover({version:'2.0.26'});
    if(endpoint)client=OpenCode.make({baseUrl:endpoint.url,headers:Service.headers(endpoint)});
    else{const temporary=await privateClient(project,{...process.env,OPENCODE_CONFIG:resolve(root,'opencode.json')});client=temporary.client;close=temporary.close;}
  }
  let bootstrap:string|undefined;
  try{
    bootstrap=(await client.session.create({location:{directory:project}})).id;
    const rpc=client.rpc(metricsRpc);
    let cursor:string|undefined;
    do{
      // Plugin initialization can be asynchronous. Retry availability only, never analysis or execution.
      let page:{version:1;runs:Run[];next:string|null}|undefined;
      for(let attempt=0;attempt<20;attempt++){
        try{page=await rpc.list({after:cursor,limit:Math.min(500,limit-runs.length)},{location:{directory:project}}) as typeof page;break;}
        catch(error){if(!['rpc.unavailable','rpc.method_not_found'].includes((error as {type?:string}).type??''))throw error;if(attempt===19)throw error;await new Promise(resolve=>setTimeout(resolve,250));}
      }
      if(!page)throw new Error('METRICS_UNAVAILABLE');
      const remaining=limit-runs.length;
      if(page.runs.length>remaining)truncated=true;
      runs.push(...page.runs.slice(0,remaining));cursor=page.next??undefined;
      if(runs.length>=limit){truncated=truncated||Boolean(cursor);break;}
    }while(cursor);
  }finally{if(bootstrap)await client.session.remove({sessionID:bootstrap}).catch(()=>{});await close();}
}
const report=aggregate(runs);
const destination=resolve(option('output')??resolve(root,'work/report.md'));
await mkdir(dirname(destination),{recursive:true});
await writeFile(destination,markdown(report)+(truncated?'\nCollection was capped by --limit; coverage is partial.\n':''));
const exported=option('export');
if(exported){const file=resolve(exported);await mkdir(dirname(file),{recursive:true});await writeFile(file,JSON.stringify({version:1,runs:report.runs,truncated},null,2)+'\n');}
console.log(JSON.stringify({report:destination,runs:report.totalRuns,closed:report.closedRuns,unfinished:report.unfinishedRuns,hypotheses:report.hypotheses.length,truncated,policyChanged:false,modelCalls:0}));
