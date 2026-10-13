// Copied into a fresh production consumer by package-check, without tsconfig/preload.
import { testRender } from '@opentui/solid';
import type { Plugin } from '@opencode/plugin/tui';
import tui from 'aorchestra-opencode-v2/tui';

let claim:any;
let release:((value:unknown)=>void)|undefined;
let signal:AbortSignal|undefined;
const ctx={
  theme:{text:{muted:'#999999'}},
  data:{session:{get:()=>({location:{directory:'/server/project'}})}},
  client:{rpc:()=>({get:(_input:unknown,options:any)=>{
    signal=options.signal;
    return new Promise(resolve=>{release=resolve;});
  }})},
  ui:{slot:(value:any)=>{claim=value;return ()=>{};}},
} as unknown as Plugin.Context;
const cleanup=await tui.setup(ctx);
if(claim.append!=='sidebar.footer')throw new Error('PACKAGED_SIDEBAR_SLOT_MISSING');
const view=await testRender(()=>claim.render({sessionID:'session'}),{width:70,height:8});
try {
  await view.renderOnce();
  if(view.captureCharFrame().includes('AOrchestra v'))throw new Error('PACKAGED_SIDEBAR_ASSUMED_LOCAL_VERSION');
  release!({version:'9.8.7',availableVersion:'9.8.8',installedVersion:'9.8.8'});
  await view.waitForFrame(frame=>frame.includes('AOrchestra v9.8.7')&&frame.includes('v9.8.8 installed'));
  if(!view.captureCharFrame().includes('restart required'))throw new Error('PACKAGED_UPDATE_STATUS_MISSING');
}finally{view.renderer.destroy();if(cleanup)await cleanup();}
if(!signal?.aborted)throw new Error('PACKAGED_SIDEBAR_REQUEST_NOT_CANCELLED');
console.log(JSON.stringify({packagedTuiImport:true,serverVersionRendered:true,updateRendered:true,disposed:true}));
