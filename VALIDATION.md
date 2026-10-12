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

Current local checks: **55 harness/setup tests passed**, 185 assertions, plus
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
configuration. At the time of these initial package checks, npm registry
publication had not been performed. Version 0.3.0 is now available on npm.

The packaged Node/Bun CLI was exercised outside the source checkout. Repeating
setup against the same pinned source returned changed=false, no new backup, and
a successful global check. A separately installed repo-context remained present.

Model discovery retains the normal/custom credential DB and removes only explicit
config/content template overrides. This differs from smoke checking, which remains
isolated. Discovery waits for preferred configured models during asynchronous loading.

## P0 workflow and verification controller

Development checks on Linux with Bun 1.2.15 and OpenCode 2.0.26: **70 harness
and setup tests passed, 244 assertions**, plus **13 repo-context helper tests**.
Typecheck, three-case evaluation corpus validation, version consistency,
production package installation/import/CLI help and the repository-profile native
smoke check passed. The smoke check made zero external model calls. Windows
results must be read from this branch's CI; they are not inferred from Linux.

New tests exercise affected-package selection in a monorepo, workspace package
manager inheritance, configured checks for non-JavaScript paths, predicate
deduplication, unsupported conventions/conflicting lockfiles, malformed manifests
and symlink escapes. Controller tests cover phase transitions, read-only resume
across plugin restart, pending-check context, fresh discovered-check acceptance,
failed-rerun receipt revocation and repair budgets surviving restart/invalidation.
Existing dependency, serialization, write-scope, permission, delegation and
telemetry tests remain in the suite.

These tests verify controller mechanics with native-shaped events. The no-model
native smoke proves plugin loading and controlled failure collection, not a
successful autonomous coding/repair loop or project-specific script outcomes.
Real brownfield tasks, large-tree snapshot overhead and whole-workflow model cost
remain unmeasured. No paid evaluation was run and no routing change is justified
by these deterministic checks.

For an effectiveness benchmark, use matched historical tasks from target
repositories, identical base revisions and model/provider settings, independent
behavior and scope checks, and report both successful and blocked/failed runs.
Compare the prior harness with this controller before changing routing. The three
existing evaluation fixtures are smoke coverage, not that benchmark.

## Release, permissions and acceptance revocation

Development checks on Linux on 2026-10-12, with Bun 1.2.15 and OpenCode 2.0.26:
**76 harness/setup/release tests passed, 325 assertions**, plus **13 repo-context
helper tests**. Typecheck, evaluation corpus validation, version consistency and
production package installation/import/CLI help passed. Repository-profile and
isolated global-discovery native smoke checks passed with **zero model calls**.
The global fixture is separate from the user's actual global configuration.

Setup tests cover stable version pinning, explicit main/commit selection, option
conflicts, CLI/package version mismatch, known-default permission migration and
custom ordered-policy preservation. The native smoke evaluates routine check/Git
resources, unknown commands, compound-resource requests, a redirected package
check and executor shell denial through the pinned permission API. This does not
exercise every shell parser/platform or arbitrary command isolation.

Revocation tests cover accepted tasks, missing exit metadata, transitive dependent
acceptance, active child interruption, late child results, read-only restart,
explicit reacceptance and preserved baselines/budgets. Release tests execute the
actual publication-check script using real npm archives and a local registry
fixture, covering matching integrity, mismatches, absent versions and HTTP errors.
No package was published and no paid evaluation ran. Windows checks and actual
OIDC publication remain target-environment work; the release-script test is Linux
only because the publication job runs on Linux.

Further brownfield priorities remain separate from this change:

- Root/workspace and dependent-package coverage: nearest-package discovery alone
  does not validate consumers of shared APIs; use explicit predicates/rules today.
- Generated artifacts: test-created files can invalidate receipts or violate exact
  write scope; review artifact exclusions without hiding meaningful source changes.
- Snapshot cost: measure whole-tree hashing on large repositories before replacing
  the snapshot provider or weakening freshness checks.
- Effectiveness: compare matched historical tasks with independent regression and
  scope checks, counting blocked/failed runs and full workflow cost.

## Automatic release PR merging

Local Linux checks on 2026-10-12: typecheck, **77 harness/setup/release tests
(344 assertions)**, **13 repo-context helper tests**, evaluation corpus validation,
version consistency, workflow YAML parsing and diff checks passed. The release
automation test executes the actual workflow shell commands with a recording
GitHub CLI fixture, covering successful merge/dispatch, identity rejection, merge
failure, a changed-head API rejection, invalid SHA and dispatch failure. Existing
registry-integrity scenarios still pass. Localhost tests required running outside
the filesystem/network sandbox.

The fixture verifies command sequencing and submission of the validated SHA; it
does not execute GitHub's jq evaluator or prove live token permissions, branch
protection, Windows CI or npm OIDC publication. Those remain checks for the actual
Actions run after this configuration is merged. No release or package was
published during local verification.

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

Build/other-agent isolation is covered by controlled callback tests: harness tools
are hidden, old task state is not injected into compaction, retries/permissions
remain unchanged, switched-agent telemetry is incomplete rather than contaminated,
and outstanding children are interrupted/blocked. Global plugin discovery logs
remain normal; plugin loading is distinct from agent execution.

Version 0.3.0 is available in the npm registry. The workflow requires the owner's
trusted publisher configuration and NPM_PUBLISH_ENABLED=true; successful OIDC
publication is not established by local tests or the existence of that version.

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
