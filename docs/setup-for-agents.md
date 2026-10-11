# Set up AOrchestra with a coding agent

Use this procedure for global installation/configuration. Prefer the packaged CLI;
do not recreate its installer or copy files into a target project. Harness
development follows [AGENTS.md](../AGENTS.md).

## 1. Establish the environment

Identify the OS/shell, V2 executable and prerequisites in the
[README](../README.md#1-check-the-prerequisites). Verify the binary reports 2.0.26;
set OPENCODE_BIN if it is named opencode rather than opencode2. Resolve missing
prerequisites within the user's authorized scope. Provider sign-in may require
their interaction; never request credential contents.

Run `<binary> debug paths` and inspect OPENCODE_CONFIG_DIR, OPENCODE_CONFIG,
OPENCODE_CONFIG_CONTENT and XDG config overrides. A target project is optional for
global installation. Keep unrelated project/global settings and instructions.

**Done when:** the supported binary and required tools are available, active global
paths/overrides are known, and any provider interaction needed is identified.

## 2. Run packaged setup

Keep the documented per-command Git allowance and ignore-scripts flags for npm 12;
the package needs no install lifecycle scripts. Do not change persistent npm
settings to make Git installation work.

Use the README's GitHub command or the exact package/revision requested by the
user. npm registry publication is not yet available. For a non-interactive agent,
provide `--model=provider/model`, using an observed model identifier from the
existing configuration/catalogue. Use explicit tier flags only when requested;
otherwise setup retains available tier choices or uses the main model for all tiers.
Use `--default` only to replace an existing chosen default agent.

The CLI discovers global JSON/JSONC, selects JSONC if present, validates input,
installs through native plugin add, backs up a changed config and merges only
AOrchestra entries. It pins the default GitHub source to a commit, embeds the
installed instructions into agent definitions and runs the no-inference global
check. The skill's native ID is aorchestra-repo-context; other skill discovery is
preserved. Existing explicit skill-discovery exclusions remain user settings.

Inspect the exit status and output. If both global sources contain conflicting
AOrchestra registrations, resolve that specific conflict before retrying. If a
config changes concurrently, re-read it rather than overwriting it. A failed
post-install check leaves the backed-up change visible; diagnose its specific
error, rather than assuming success or weakening permissions.

**Done when:** the global check passes, prints global-discovery and modelCalls: 0,
and the installed spec/revision, config path and any backup are recorded. Provider
inference remains untested. Use the manual fallback below only when explicitly
requested or needed to diagnose an installation problem.

## 3. Verify usage and hand off

Use `aorchestra check --project=<absolute path>` through the same packaged CLI if
the user requests a project-specific check. Project-local config can override the
global setup. Restore/remove stale template environment overrides as appropriate,
preserving intentional overrides and explaining their effect.

Return the version/spec, global config/backup paths, selected models and observed
results. Provide commands to enter the user's project and run
`<binary> run --standalone --agent aorchestra '<user task>'`, without assigning a
project profile. Setup does not authorize running a real coding task or paid trial.
For undo, restore only AOrchestra-related changes from the backup while preserving
later unrelated edits. Updates use setup again with the requested package/revision.

**Done when:** runnable commands use the user's real shell/path, global loading is
verified, remaining limits are clear and the user can undo or update the setup.

## Manual fallback

Read [reference.md](reference.md#global-installation). Discover the active global
directory through the runtime, including OPENCODE_CONFIG_DIR. Inspect global
opencode.json/jsonc with a comment-preserving editor; JSONC loads after JSON in
2.0.26. Back up the file before editing. If absent, create global opencode.json.

Install the plugin with native `plugin add <npm-or-git-spec>`, then merge its options
and two agent definitions from the same package version. Embed its instruction
contents, or use absolute paths only for a permanent source checkout. Set
agents.aorchestra.model rather than replacing the global model used by other
agents. Keep the budgets, permissions and other agents/providers/plugins. One
available model can fill all tiers. Check duplicate registrations and stale
environment overrides. Never copy the template's entire config over the user's.

Use the packaged global check to validate actual loading. The original 0.2.2
release predates this installer/check mode; its template smoke check is not proof
of global installation. Do not claim a check that was not observed.
