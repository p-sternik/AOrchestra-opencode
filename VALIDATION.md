# Validation

Baseline: 0.2.2, reviewed on 2026-10-11 using Windows, Bun 1.2.15 and OpenCode 2.0.26.

| Check | Baseline result |
| --- | --- |
| Official @opencode/plugin/client 2.0.26 types | Passed |
| Core, filesystem, plugin, telemetry and report tests | 39 passed, 104 assertions |
| Repo-context helper preservation/freshness tests | 13 passed |
| Evaluation corpus validation | Three cases; DIRECT and selective strategies |
| Native plugin/agent/session/permission loading | Passed |
| Central profile used from another project | Passed |
| Bundled explicit-only repo-context discovery | Passed |
| Controlled missing-provider terminal event → telemetry → RPC | Passed; zero model calls |
| Native and offline metadata reporting | Passed |
| Representative real-model effectiveness/cost benchmark | Not performed |

The repository adds deterministic Windows/Linux CI and version consistency checks.
Check the actual Actions run for current CI results; local baseline results do not
imply every platform or provider has been exercised.

## Global configuration check (development branch)

The added `check --global` mode was tested with an isolated global JSONC config,
absolute plugin/instruction paths, a neutral location outside the harness checkout,
and a separate project location. Explicit config/content overrides were removed
from the private server environment. The check requires global agent and plugin
declarations; loading the template locally is insufficient. Tests use an isolated
database and make zero model calls. This mode is not part of the original 0.2.2 tag.

## Installable package (development branch)

Current local checks: **51 harness/setup tests passed**, 157 assertions, plus
**13 repo-context helper tests passed**. Typecheck, package validation and the
repository-profile native smoke check also passed.

Setup adds behavioral checks for JSONC/comment preservation, unrelated settings,
idempotent updates, native-identified source migration, bundled skill permission
migration, exact backups and concurrent config changes. Package validation packs
an actual archive, installs production dependencies outside the checkout, imports
the plugin and invokes its CLI. CI runs the package check on Windows/Linux.

The native installation was exercised with an isolated Git package fixture and
global JSONC configuration, using native plugin add and then global smoke checking
with zero model calls. The bundle uses the ID aorchestra-repo-context and preserves
other skill discovery. This does not prove provider inference or every third-party
configuration. npm registry publication has not been performed.

The packaged Node/Bun CLI was exercised outside the source checkout. Repeating
setup against the same pinned source returned changed=false, no new backup, and
a successful global check. A separately installed repo-context remained present.

Model discovery retains the normal/custom credential DB and removes only explicit
config/content template overrides. This differs from smoke checking, which remains
isolated. Discovery waits for preferred configured models during asynchronous loading.

## What these checks establish

Routing/source-handoff changes are covered by tests that reject missing provenance
before budget/session creation, deliver the handoff and source fingerprint to the
child, restrict fast analysis to lookup, require a declared fast-to-strong reason
and delta, and retain the two-attempt cap. These validate mechanics, not the semantic
accuracy of model-supplied facts or routing categories. Older tasks can pass the
handoff on delegation without re-registering under a new task id.

Tests cover scope drift, stale evidence, verifier predicates, attempt escalation,
durable budgets, cancellation and plugin callbacks with controlled APIs. Metrics
tests cover missing versus measured-zero usage, cumulative-counter deltas, failed
children, late events, incomplete terminals, pagination and descriptive reporting.
The helper tests check authored AGENTS.md preservation, freshness, added/removed
files and explicit exclusions.

The native check starts a private server on a random localhost port and uses an
isolated database under work/runtime. A deliberately unavailable provider exercises
failure lifecycle collection without paid inference. These records are integration
test data, not evidence of user productivity or routing ROI.

## What remains unproven

Successful model-driven DIRECT/delegated coding, semantic compatibility on real
legacy systems, model availability/prices, provider-specific native exit metadata,
MCP/Code Mode behavior and whole-tree snapshot cost require target-environment
evaluation. Prompt rules are not behavioral guarantees. Native-edit checks do not
prove isolation of arbitrary primary shell commands. Reports do not establish
causal superiority of one routing strategy over another.

## Pinned API differences

OpenCode 2.0.26 supports permissions in session.create. The pinned API does not
provide the newer permission.rules interface. Explicit local plugins must target
a directory; plugins/aorchestra/index.ts supplies the portable entrypoint. Current
online documentation can differ from this tag. Re-run typecheck, tests and native
smoke before upgrading the runtime/API packages together.
