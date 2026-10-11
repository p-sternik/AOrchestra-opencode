# Install AOrchestra globally with a coding agent

Use this procedure when the user asks to install or configure AOrchestra for
OpenCode V2. The default is a merge into the user's global configuration, available
across projects. For harness development, follow [AGENTS.md](../AGENTS.md).

## 1. Find the active global configuration

Identify the OS, shell and V2 executable: try `opencode2`, or use `opencode` when
that is V2. Verify its version against the [README prerequisites](../README.md#1-check-the-prerequisites).
Run `<binary> debug paths` and inspect `OPENCODE_CONFIG_DIR` (a global directory
override), `OPENCODE_CONFIG`, `OPENCODE_CONFIG_CONTENT` and XDG config settings.
Keep the user's other executable/profile available.

The usual directory is ~/.config/opencode, including on Windows, but discovered
runtime paths take precedence over guesses about HOME or APPDATA. Inspect the
existing opencode.json and opencode.jsonc there. In 2.0.26 JSONC loads after JSON;
update the authoritative existing file rather than creating a competing file.
If neither exists, create opencode.json in that global directory. Read JSONC with
a parser/editor that preserves comments and unrelated content.

`<binary> debug config` lists loaded sources when a service connection is available.
If it cannot connect, inspect the files and use the private global check below;
do not change a managed service's port just to complete setup. Never print
credentials or expanded config containing secrets. Inspect CLI help for unfamiliar
options. Resolve missing prerequisites within the user's authorized scope;
provider sign-in may require their interaction.

**Done when:** the supported V2 binary, permanent install directory, global config
directory/file and relevant overrides are known. A target project is optional for
global installation, needed only for checking project-specific overrides.

## 2. Install the harness in a permanent location

Use the requested version or verify the latest published GitHub release/tag.
Until a release includes the global checker, use current main for this workflow
and record its exact commit. Respect an explicit request to retain an older release,
but report the validation limitation below.
Follow the [download steps](../README.md#2-download-the-harness). Reuse a
suitable checkout after inspecting its version/local changes; preserve edits.
Install dependencies with `npm ci --ignore-scripts`.

Keep the checkout outside target projects, at a stable user-owned path. Record
its revision and version. Back up the existing global config before merging,
or record that the file is newly created. Do not copy the harness's AGENTS.md into
the global config directory or target repositories.

**Done when:** installed files/dependencies exist at the permanent location and
the previous global config can be recovered without losing later unrelated edits.

## 3. Merge AOrchestra into the global config

Treat the checkout's opencode.json as a template, not a replacement for the global
file. Preserve providers, other agents/plugins, permissions, model defaults,
compaction, warming and tool-output settings unless a relevant change is requested.

- Merge the AOrchestra plugin entry/options and the two agents, replacing only old
  AOrchestra entries. Preserve unrelated plugin entries and their order. The local
  plugin target is the absolute `<install>/plugins/aorchestra` directory.
- Rewrite both agent `system` file references to absolute instruction paths in
  that checkout. Relative paths copied from the template would resolve against
  the global config directory, not the install directory. Forward-slash Windows
  paths avoid JSON backslash mistakes.
- Inspect available models with `<binary> models --standalone`. Use observed exact
  identifiers for fast/balanced/strong and set `agents.aorchestra.model` explicitly.
  Retain the existing top-level model for other agents. One suitable model can fill
  all tiers, with no tier-based price differentiation. Catalogue availability is
  separate from authenticated inference.
- Set `default_agent` to `aorchestra` when the user wants it as the default; explicit
  `--agent aorchestra` works with an existing different default.
- Preserve the AOrchestra agent permissions and worker restrictions. Skill access
  remains restricted for the main agent. Do not blindly copy the template's
  `-opencode.config.skill` exclusion: globally it disables skill discovery for
  other agents too. Preserve existing skill discovery; if a same-ID repo-context
  registration conflicts with the bundle, resolve that specific conflict. Ask
  only when resolving it would change a separate setup the user wants to retain.

Check existing AOrchestra registrations in global discovery and known project-local
configs. Keep one active plugin registration per effective location; do not remove
unrelated project config. Inspect [reference.md](reference.md) for contract/API
details. Restore or remove a stale OPENCODE_CONFIG template override as appropriate;
do not install a persistent override pointing to the harness template. Report
intentional overrides that can supersede global settings.

**Done when:** valid global JSON/JSONC references the installed plugin and both
instructions, contains observed model identifiers, and retains unrelated settings.
Any duplicate registration, conflicting skill or relevant override is resolved.

## 4. Check actual global loading

From a checkout supporting this mode, set `OPENCODE_BIN` to the V2 binary and run
`bun run check -- --global`. Set `AORCHESTRA_CHECK_PROJECT` to an existing project's
absolute path when checking its overrides; otherwise the checker uses a neutral
directory outside the template's config discovery path.

This check removes explicit config/content overrides in its private child process,
uses normal global discovery and an isolated test DB, and verifies global agent
declarations plus active plugin, native session, bundled skill and failure telemetry.
Inspect exit status/output, including `configMode: global-discovery` and
`modelCalls: 0`. It does not validate successful model inference or compatibility
with every project. If the check fails, diagnose the specific conflict while
retaining existing permissions.

The original 0.2.2 checker lacks --global. Its template check is not evidence of
global installation. For an explicitly requested older release, verify loaded
sources/plugin/agents through the native API instead, or report that global loading
has not been verified. Do not claim the new check was run against that release.
Restore temporary terminal variables afterwards.

**Done when:** global discovery succeeds from a neutral directory and, if requested,
the chosen project, with zero model calls. Remaining authentication/inference
limits are stated. A real-model trial is run only when requested.

## 5. Hand off normal usage and recovery

Return the installed version/revision/path, global config and backup paths, V2
binary/runtime version, selected models and observed checks. Provide shell-correct
commands using the user's project path:

```text
<change directory to project>
<binary> run --standalone --agent aorchestra '<user task>'
```

No project config or OPENCODE_CONFIG assignment is required. Explain any relevant
project overrides. For undo, restore the AOrchestra-related changes from the backup
while preserving subsequent unrelated edits; restore the previous default agent
and any environment changes. Keep the referenced install directory until the
global plugin/instruction references are removed.

**Done when:** the user can run AOrchestra from projects through the global config,
understands observed checks/remaining gaps and can undo the installation.
