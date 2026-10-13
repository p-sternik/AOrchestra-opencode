/** @jsxImportSource @opentui/solid */
import { Plugin } from '@opencode/plugin/tui';
import { createEffect, createSignal, onCleanup } from 'solid-js';
import { jsx } from '@opentui/solid/jsx-runtime';
import {
  sidebarVersion,
  versionRpc,
  setupRpc,
  type SetupStatus,
  type VersionStatus,
} from '../lib/version-status';

export function setupOnboardingUI(ctx: Plugin.Context) {
  const rpc = ctx.client.rpc(setupRpc);
  const location = () => ctx.location ?? ctx.data.location.default();
  const display = async (status: SetupStatus) => {
    if (
      status.state === 'restart-required' ||
      status.state === 'failed' ||
      status.state === 'skipped'
    )
      await ctx.ui.dialog.alert({ title: 'AOrchestra setup', message: status.message });
  };
  const choose = async (status: SetupStatus, signal?: AbortSignal) => {
    if (status.state !== 'needs-model') return display(status);
    if (!status.models.length)
      return ctx.ui.dialog.alert({ title: 'Connect a provider', message: status.message });
    const model = await ctx.ui.dialog.select({
      title: 'Set up AOrchestra',
      placeholder: 'Choose an authenticated provider model',
      options: status.models.map((model) => ({ title: model, value: model })),
    });
    if (!model || signal?.aborted) return;
    await display(
      (await rpc.configure({ model }, { location: location(), signal })) as SetupStatus,
    );
  };
  ctx.keymap.layer(() => ({
    commands: [
      {
        id: 'aorchestra_setup',
        title: 'Set up AOrchestra',
        group: 'AOrchestra',
        palette: true,
        slash: { name: 'aorchestra-setup' },
        run: async () => {
          try {
            await choose((await rpc.configure({}, { location: location() })) as SetupStatus);
          } catch {
            await ctx.ui.dialog.alert({
              title: 'AOrchestra setup',
              message: 'Setup is unavailable. Run the packaged aorchestra setup command.',
            });
          }
        },
      },
    ],
  }));
  return ctx.ui.slot({
    append: 'home.footer',
    render: () => {
      const [status, setStatus] = createSignal<SetupStatus>();
      const controller = new AbortController();
      let busy = false,
        offered = false;
      const refresh = async () => {
        if (busy || controller.signal.aborted) return;
        busy = true;
        try {
          const current = (await rpc.get(
            {},
            { location: location(), signal: controller.signal },
          )) as SetupStatus;
          if (controller.signal.aborted) return;
          setStatus(current);
          if (!offered && ['needs-model', 'restart-required', 'failed'].includes(current.state)) {
            offered = true;
            await choose(current, controller.signal);
          }
        } catch {
          /* The server may still be loading the plugin. */
        } finally {
          busy = false;
        }
      };
      void refresh();
      const timer = setInterval(() => {
        void refresh();
      }, 1000);
      onCleanup(() => {
        clearInterval(timer);
        controller.abort();
      });
      return jsx('text', {
        fg: ctx.theme.text.muted,
        get visible() {
          return !!status() && !['ready', 'skipped'].includes(status()!.state);
        },
        get children() {
          return status()?.message ?? '';
        },
      });
    },
  });
}

export default Plugin.define({
  id: 'aorchestra',
  setup(ctx) {
    const releaseOnboarding = setupOnboardingUI(ctx);
    const releaseSidebar = ctx.ui.slot({
      append: 'sidebar.footer',
      render: (input) => {
        const [status, setStatus] = createSignal<VersionStatus>();
        const [unavailable, setUnavailable] = createSignal(false);
        const rpc = ctx.client.rpc(versionRpc);
        createEffect(() => {
          const location =
            ctx.data.session.get(input.sessionID)?.location ??
            ctx.location ??
            ctx.data.location.default();
          const controller = new AbortController();
          let busy = false;
          setStatus(undefined);
          setUnavailable(false);
          const refresh = async () => {
            if (busy || controller.signal.aborted) return;
            busy = true;
            try {
              const result = (await rpc.get(
                {},
                { location, signal: controller.signal },
              )) as VersionStatus;
              if (!controller.signal.aborted) {
                setStatus(result);
                setUnavailable(false);
              }
            } catch {
              if (!controller.signal.aborted) {
                setStatus(undefined);
                setUnavailable(true);
              }
            } finally {
              busy = false;
            }
          };
          void refresh();
          const timer = setInterval(() => void refresh(), 10_000);
          onCleanup(() => {
            clearInterval(timer);
            controller.abort();
          });
        });
        const title = () => {
          const current = status();
          return current ? sidebarVersion(current).title : 'AOrchestra';
        };
        const update = () => {
          const current = status();
          return current
            ? sidebarVersion(current).update
            : unavailable()
              ? 'Status unavailable'
              : null;
        };
        return (
          <box flexDirection="column" marginTop={1}>
            {/* Getter props remain reactive with Bun's automatic JSX runtime in npm packages. */}
            {jsx('text', {
              fg: ctx.theme.text.muted,
              get children() {
                return title();
              },
            })}
            {jsx('text', {
              fg: ctx.theme.text.muted,
              get visible() {
                return update() !== null;
              },
              get children() {
                return update() ?? '';
              },
            })}
          </box>
        );
      },
    });
    return () => {
      releaseOnboarding();
      releaseSidebar();
    };
  },
});
