import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { OpenCode } from '@opencode/client/promise';
export const binary = process.env.OPENCODE_BIN || 'opencode2';
export async function command(args: string[], cwd: string, timeoutMs = 120_000, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    let expired = false;
    const timer = setTimeout(() => { expired = true; child.kill(); }, timeoutMs);
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (expired) reject(new Error('CLI_TIMEOUT')); else if (code !== 0) reject(new Error(`CLI_EXIT_${code}: ${stderr.slice(-3000)}`)); else resolve(stdout); });
  });
}

// A short-lived private server shares the native DB unless the caller supplies a test DB.
// It does not start models, change the managed service, or reveal its password.
export async function privateClient(cwd:string,env:NodeJS.ProcessEnv=process.env) {
  let password=randomBytes(24).toString('hex');
  const server=spawn(binary,['serve','--hostname','127.0.0.1','--port','0'],{cwd,env:{...env,OPENCODE_SERVER_PASSWORD:password},windowsHide:true,stdio:['ignore','pipe','pipe']});
  const close=async()=>{
    if(process.platform==='win32'&&server.pid)await new Promise<void>(resolve=>{const stop=spawn('taskkill',['/PID',String(server.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});stop.on('close',()=>resolve());stop.on('error',()=>resolve());});else server.kill();
  };
  try {
    const baseUrl=await new Promise<string>((resolve,reject)=>{
      let logs='';const timer=setTimeout(()=>reject(new Error('SERVER_START_TIMEOUT')),60_000);
      const receive=(data:Buffer)=>{logs+=data.toString();const p=/server password ([^\r\n]+)/.exec(logs);if(p)password=p[1].trim();const url=/http:\/\/127\.0\.0\.1:\d+/.exec(logs);if(url){clearTimeout(timer);resolve(url[0]);}if(logs.length>20000)logs=logs.slice(-10000);};
      server.stdout.on('data',receive);server.stderr.on('data',receive);server.on('error',error=>{clearTimeout(timer);reject(error);});server.on('exit',code=>{clearTimeout(timer);reject(new Error(`SERVER_EXIT_${code}`));});
    });
    return {client:OpenCode.make({baseUrl,headers:{authorization:`Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`}}),close};
  }catch(error){await close();throw error;}
}
