# Set up AOrchestra with a coding agent

Use this procedure when the user asks to install or configure AOrchestra for an
existing project. It configures the harness; it does not start a coding task.
For changes to this repository's implementation, follow [AGENTS.md](../AGENTS.md).

## 1. Identify the environment

Identify the target project, operating system, shell, install directory and
existing OpenCode configuration. Read applicable project instructions. Check
the actual executable versions and inspect existing configuration without
printing credentials. Try `opencode2`; use `opencode` if that is the V2 binary.
Inspect command help before using unfamiliar CLI options.

The supported runtime and tested prerequisites are in the
[README](../README.md#1-check-the-prerequisites); API versions are pinned in
package.json. If prerequisites are missing or incompatible, report the exact
gap and resolve installation within the user's authorized scope. Keep the user's
other OpenCode executable/profile available. Provider sign-in may require the
user's interaction; request that interaction rather than collecting secrets.

**Done when:** the project and install location are known, required tools are
available at the supported versions, and the V2 executable name is established.
Ask only for information that cannot be established from the environment.

## 2. Prepare a separate harness checkout

Choose the latest published release unless the user requested a specific version
or development checkout. Verify the release/tag in GitHub rather than treating
the main branch's package version as proof of a published release. Follow the
[download steps](../README.md#2-download-the-stable-version), substituting the
verified tag where needed. Reuse an existing suitable checkout after inspecting
its version and local changes; preserve existing edits.

Install dependencies from the lockfile with `npm ci --ignore-scripts`. Use the
checkout's opencode.json as a dedicated profile outside the target project.
Do not overwrite the user's global configuration or copy this harness's AGENTS.md
into their project. A global merge is a separate choice only when requested.

**Done when:** the checkout revision/version and absolute profile path are known,
dependencies are installed, and existing user configuration remains available.

## 3. Select available models

Inspect the existing provider setup and the model catalogue using the identified
V2 binary. In 2.0.26, `<binary> models --standalone` lists models without running
a task. A catalogue entry is not proof that authentication, billing or inference
will succeed. Reuse the user's stated model preferences where available.

Update only the top-level `model` and the AOrchestra plugin's
`options.models.fast`, `balanced` and `strong` in the dedicated profile. Use exact
provider/model identifiers from the catalogue. If only one suitable model is
available, all three tiers can reference it; explain that this gives no model-tier
cost differentiation. If a selection requires an unresolved user preference or
provider sign-in, resolve that before declaring setup complete.

Keep configured permissions and budgets. Check for duplicate AOrchestra
registrations in the effective configuration, including project-local config.
Preserve unrelated plugins. Read the [technical reference](reference.md) when
resolving configuration conflicts; keep the explicit directory plugin entry and
instruction paths intact. Do not claim provider prices or quality without evidence.

**Done when:** all four model settings use observed identifiers and duplicate or
conflicting registrations are resolved. Record model availability as catalogue
evidence, with inference still untested.

## 4. Verify the installation

From the harness folder, set `OPENCODE_BIN` to the identified executable and run
`bun run check`. To check loading in the actual target project, set
`AORCHESTRA_CHECK_PROJECT` to that project's absolute path for this invocation.
Use shell-appropriate environment syntax from the README and restore temporary
environment changes in a reused terminal when finished.

The check reads the dedicated checkout's opencode.json. It uses a private server
and an isolated test database, verifies the plugin, agents, child-session creation,
bundled skill and controlled failure telemetry, and makes no external model calls.
Inspect its exit status and observed output. Diagnose a failed check rather than
weakening permissions or describing the installation as successful.

**Done when:** the native check succeeds for the target location and reports the
plugin/agents/skill loaded and `modelCalls: 0`. Authentication and successful model
inference remain untested; run a real-model trial only when the user requests it.

## 5. Hand off runnable commands

Return the harness version/tag and install path, executable/runtime version,
absolute configuration path, selected models and observed check result. Provide
commands for the user's actual shell that set `OPENCODE_CONFIG` and
`OPENCODE_BIN`, enter their target project and run `--standalone --agent aorchestra`.
Quote paths correctly, including spaces. Use a task placeholder rather than
executing a coding task during setup.

For undoing this setup, explain how to restore the terminal's previous environment
values (or unset newly added ones) and resume the previous profile. Report any
remaining blockers or untested provider behavior explicitly.

**Done when:** the user has commands with their real paths, knows what was verified
and can return to their previous configuration.
