/** @jsxImportSource @opentui/solid */
import { Plugin } from '@opencode/plugin/tui';
import { createEffect, createSignal, onCleanup } from 'solid-js';
import { jsx } from '@opentui/solid/jsx-runtime';
import { sidebarVersion, versionRpc, type VersionStatus } from '../lib/version-status';

export default Plugin.define({
  id:'aorchestra',
  setup(ctx) {
    return ctx.ui.slot({append:'sidebar.footer',render:input=>{
      const [status,setStatus]=createSignal<VersionStatus>();
      const [unavailable,setUnavailable]=createSignal(false);
      const rpc=ctx.client.rpc(versionRpc);
      createEffect(()=>{
        const location=ctx.data.session.get(input.sessionID)?.location??ctx.location??ctx.data.location.default();
        const controller=new AbortController();
        let busy=false;
        setStatus(undefined);setUnavailable(false);
        const refresh=async()=>{
          if(busy || controller.signal.aborted)return;
          busy=true;
          try {
            const result=await rpc.get({},{location,signal:controller.signal}) as VersionStatus;
            if(!controller.signal.aborted){setStatus(result);setUnavailable(false);}
          } catch {
            if(!controller.signal.aborted){setStatus(undefined);setUnavailable(true);}
          } finally {busy=false;}
        };
        void refresh();
        const timer=setInterval(()=>void refresh(),10_000);
        onCleanup(()=>{clearInterval(timer);controller.abort();});
      });
      const title=()=>{const current=status();return current?sidebarVersion(current).title:'AOrchestra';};
      const update=()=>{const current=status();return current?sidebarVersion(current).update:unavailable()?'Status unavailable':null;};
      return <box flexDirection="column" marginTop={1}>
        {/* Getter props remain reactive with Bun's automatic JSX runtime in npm packages. */}
        {jsx('text',{fg:ctx.theme.text.muted,get children(){return title();}})}
        {jsx('text',{fg:ctx.theme.text.muted,get visible(){return update()!==null;},get children(){return update()??'';}})}
      </box>;
    }});
  },
});
