# Validation

Baseline: 0.2.2, reviewed on 2026-10-11 using Windows, Bun 1.2.15 and OpenCode 2.0.26.

| Check                                                        | Baseline result                              |
| ------------------------------------------------------------ | -------------------------------------------- |
| Official @opencode/plugin/client 2.0.26 types                | Passed                                       |
| Core, filesystem, plugin, telemetry and report tests         | 39 passed, 104 assertions                    |
| Repo-context helper preservation/freshness tests             | 13 passed                                    |
| Evaluation corpus validation                                 | Three cases; DIRECT and selective strategies |
| Native plugin/agent/session/permission loading               | Passed                                       |
| Central profile used from another project                    | Passed                                       |
| Bundled explicit-only repo-context discovery                 | Passed                                       |
| Controlled missing-provider terminal event → telemetry → RPC | Passed; zero model calls                     |
| Native and offline metadata reporting                        | Passed                                       |
| Representative real-model effectiveness/cost benchmark       | Not performed                                |

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
evaluation fixtures provide a synthetic baseline, not that benchmark. See the
[brownfield methodology](docs/benchmark.md).

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

The 0.4.0 npm publication run exposed a pack-output compatibility gap: its npm
12.2.0 toolchain returns package-keyed JSON, while the release test and inline
archive check assumed an array. The failure was reproduced locally with npm
12.2.0. After matching the existing package-check parser, all **77 tests (346
assertions)**, typecheck and production package installation/import/CLI help
passed on Node 24 with npm 12.2.0. The two release tests also passed with npm
11.12.1. CI now includes the publication toolchain alongside Node 22 Windows/Linux.
These checks did not publish a package or modify the immutable 0.4.0 release tag.

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

## Runtime version compatibility

Local Linux checks on 2026-10-12 with Bun 1.2.15: typecheck, **78 tests (386
assertions)**, production package installation/import/CLI help, version consistency
and diff checks passed. The no-inference native smoke check passed on both
**OpenCode 2.0.26 and 2.0.27**, using the pinned 2.0.26 API packages. Both checks
observed plugin loading, agent resolution, native session creation, permission
policy evaluation, bundled skill registration and failure telemetry, with
`modelCalls: 0`.

Native `plugin add aorchestra-opencode-v2@0.4.1` also succeeded on 2.0.27 with a
temporary global config and database. Its resulting config contained only the
plugin registration; it did not create the two bundled agent definitions. This
checks installation of the published package, while the smoke and package checks
above cover the local changes. Full provider-backed setup remains untested.

Setup, smoke checking and managed-service report discovery now share the runtime
range `>=2.0.26 <3.0.0`. Version-gate tests accept newer stable V2 versions and
reject older releases, prereleases, V1, V3 and malformed output. Acceptance by
that gate does not establish compatibility with every future V2 release or
successful model-driven behavior. No paid evaluation or publication ran.

## Automatic updates (development branch)

Local Linux checks on 2026-10-12 with Bun 1.2.15: typecheck, **88 tests (455
assertions)**, **13 repo-context helper tests**, evaluation corpus validation,
version consistency and production package installation/import/CLI help passed.
Native smoke checks passed on **OpenCode 2.0.26 and 2.0.27** with `modelCalls: 0`.
The updater is disabled during smoke checking to keep validation from installing
or changing the user's global harness.

Updater tests cover managed stable registrations, explicit package/main pins,
disabled checks/installations, prerelease/major/downgrade handling, preserved model
choices and settings, daily throttling after network/install failure, changes
during a registry request, native file-lock coordination and global JSONC/native
package identity checks. The native npm installer runs in a separate Bun worker:
importing it into a 2.0.27 server plugin pulled in an Effect HTTP module that the
host did not expose; moving it outside the server resolved the native load failure.

The update policy/merge/install dispatch is tested with controlled dependencies.
A complete background upgrade between published npm releases, real provider
catalogue discovery in that upgrade and Windows process-tree timeout cleanup
remain untested. No publication or paid
model-backed evaluation ran. A failed post-update smoke check can leave the
backed-up config visible; automatic rollback is not implemented.

## TUI version status (development branch)

Local Linux checks on 2026-10-12 with Bun 1.2.15: typecheck and **94 tests (486
assertions)** passed, including real OpenTUI render tests for availability/restart
labels, server-status failure, session switching, late-response rejection and
request cancellation on disposal. Update tests verify structured status before
and after installation, restoration during throttled startup and failure without
claiming a completed update. The native smoke check also verifies the server
version RPC without running a model.

The actual sidebar version was observed in isolated, idle native TUI sessions on
**OpenCode 2.0.26 and 2.0.27** with auto-update disabled and no prompts submitted.
The native Solid JSX loader is used so renderables share the host renderer;
direct local JSX-runtime calls had failed with `No renderer found` in the TUI.
Available/restart status rendering uses controlled RPC responses in renderer
tests. A complete published-package upgrade followed by an interactive restart,
remote-server operation and Windows TUI behavior remain untested. No model-backed
evaluation or publication ran.

## Pinned API differences

OpenCode 2.0.26 supports permissions in session.create. The pinned API does not
provide the newer permission.rules interface. Explicit local plugins must target
a directory; plugins/aorchestra/index.ts supplies the portable entrypoint. Current
online documentation can differ from this tag. Re-run typecheck, tests and native
smoke when changing runtime or API package versions. Runtime and pinned API
versions may differ within the accepted range; native compatibility must still
be observed for the installed runtime.

## Evidence-based improvement skill and report coverage

Local Linux checks on 2026-10-13, with Bun 1.2.15 and OpenCode 2.0.26:
**101 harness/setup/release tests passed (536 assertions)**, plus **13 repo-context
helper tests**. Typecheck, three-case evaluation corpus validation, version
consistency, skill frontmatter validation, changed-document local link targets and
diff checks passed. Package validation included all improvement skill references,
production installation, plugin import and CLI help.

The repository-profile native smoke check passed with **zero model calls**. It
checks both bundled skills' paths against the loaded bundle and requires
`autoinvoke: false`. Native permission requests with an explicit agent verify that
the primary's shipped policy permits both exact skill IDs, denies unrelated skills,
and retains executor denial. Setup tests cover exact ordered v0.5.0 default-policy
migration, idempotency, comments and customized-policy preservation. The user's
actual global configuration was not changed or tested by this work.

New diagnostics regressions cover mixed measured-zero/unknown costs, failed-worker
usage, worker ownership, provider versus verifier signals, interruptions and
observation gaps, the three-run repeated-inspection threshold, secret omission
from exports/rendering, and imported truncation surviving offline re-export.
Coverage describes observed records and counters; it does not prove complete native
event delivery or semantic correctness of untracked tasks.

A primary-agent manual application of the skill reviewed empty, incomplete and
synthetic repeated-inspection reports, keeping unsupported optimizations and cost
claims inconclusive. This was an instruction review, not independent model-backed
skill evaluation. No paid evaluation ran. Windows integration, successful real-model
skill invocation and effectiveness/cost improvements remain unproven. Whole-workflow
cost/token integration in the evaluation runner remains a separate change.

## Packaged TUI JSX and version rendering

On Linux on 2026-10-13, the production archive reproduced a missing
`react/jsx-dev-runtime` import outside the checkout. Adding the local JSX source
and production TUI dependencies fixed loading, but the isolated render still
failed to show the server version: automatic JSX had evaluated signal values
before the asynchronous status response. Reactive text/visibility getters in
OpenTUI's native JSX runtime fixed that second regression.

The enhanced package check passed with a fresh `--omit=dev` installation outside
the repository, no tsconfig and no Solid JSX compiler preload. Both development
and production modes rendered an intentionally different server version, the
installed-update/restart message, and cancelled the pending request on disposal.
Server import and CLI help also passed. This exercises the actual npm archive,
not a source-checkout import that can borrow development dependencies.

Typecheck, **101 harness tests (536 assertions)**, evaluation corpus validation,
version consistency and diff checks passed. The repository-profile OpenCode
2.0.26 native smoke passed with **zero model calls**. These checks use Bun 1.2.15;
OpenTUI's package engine declaration requests newer Bun/Node versions, so these
observations do not establish compatibility for every runtime. Windows package
rendering remains a CI check, and an interactive OpenCode TUI session was not
exercised locally. No release was published or immutable 0.5.0 tag changed.

## Evaluation usage reconciliation (P1)

Local Linux checks on 2026-10-13 with Bun 1.2.15: **110 harness tests passed
(578 assertions)**, **13 repo-context helper tests**, typecheck, three-case corpus
validation, version consistency and production package installation/import/CLI/TUI
render checks passed. The repository-profile OpenCode 2.0.26 smoke check passed
with **zero model calls**.

A separate fresh-database native check created one AOrchestra session with a
controlled unavailable provider, waited for its failure, restarted a private
server and reconciled its exact native session ID with one persisted telemetry
run. It preserved missing counters as incomplete usage and made **zero model
calls**. The initial check exposed native session pagination's boundary cursor on
the final nonempty page; the collector now reads that cursor before deciding
whether another root exists. A deterministic regression covers this behavior,
telemetry pagination, trajectory identity mismatch and server cleanup.

Deterministic tests cover primary/failed-worker costs, separate token categories,
duplicate/conflicting child records, measured zero versus absent tokens,
concurrent-session exclusion, ambiguous primary cycles, native child ownership,
unrecorded descendants, interrupted known costs, failed-assertion costs and
incomplete-cohort suppression of cost per verified success. Rebuilding summaries
from the same records produces identical metrics. Routing instructions,
permissions and the production telemetry schema were not changed.

Successful provider-backed DIRECT/SELECTIVE evaluation, provider credentials in
fresh databases, native successful worker-family collection and Windows native
integration remain untested. No paid evaluation was run. The controlled failure
and deterministic counters establish collection mechanics, not measured model
costs, semantic effectiveness or strategy superiority.

## Automated CI and release routing

Local Linux checks on 2026-10-13, based on main v0.6.0: **106 harness tests
passed (589 assertions)**, **13 repo-context helper tests**, typecheck, corpus
validation, version consistency and production package installation/import/CLI/TUI
render checks passed. OpenCode 2.0.26 repository-profile smoke passed with
**zero model calls**. Actionlint 1.7.12 accepted both workflows.

New tests parse the actual workflow YAML and use GitHub's expression evaluator to
check normal publication, empty manual inputs, tag-only retries with skipped
release dependencies, disabled publication, failed/cancelled release jobs,
non-main dispatches, immutable checkout selection and PR concurrency isolation.
The generated release PR still has explicit SHA validation and a successful
validation dependency before merging. Existing recording-CLI merge/race/dispatch
checks and real-archive registry integrity tests continue to pass.

Release Please 17.6.0, installed in a temporary external fixture, generated
`chore(main): release 0.6.1 [skip ci]` from the repository configuration and parsed
its version and branch correctly. The pinned v5 action declares this Release Please
version range. The marker suppresses ordinary push/PR event workflows; explicit
workflow calls and the post-merge dispatch remain responsible for release checks.
Standalone Validate no longer duplicates Release's main-push matrix.

These checks do not execute GitHub's scheduler, prove approval suppression on a
live generated PR, or exercise a new OIDC publication. The next actual release
must confirm those integrations. No release was published, tag changed or
repository protection setting modified during local verification. Branch rules
requiring skipped standalone PR checks remain incompatible with the generated
marker; the automation preserves GitHub's enforcement of those rules.

## Verification and evaluation review regressions

Local Linux checks on 2026-10-13 with Bun 1.2.15, based on main v0.7.0:
typecheck, **120 harness tests (683 assertions)**, **13 repo-context helper tests**,
three-case corpus validation, version consistency and production package
installation/import/CLI/TUI rendering passed. The OpenCode 2.0.26
repository-profile smoke check passed with **zero model calls**.

New regressions reject root-check evidence from another package without allowing
an unrelated failed rerun to revoke accepted root evidence. They cover implicit,
relative and absolute shell directories and predicate deduplication. Controller
tests exercise failed DIRECT verification through recovery, plugin restart,
planning, delegation, invalidation and bounded repair, including a new baseline
after invalidation. Pending repair requirements and consumed budgets persist.

Evaluation tests reject DIRECT delegation observed in native descendants or CLI
events even when primary telemetry records no children. They deduplicate native
and recorded child IDs, preserve SELECTIVE behavior and exclude unrelated primary
records. These are controlled regression checks, not provider-backed evidence of
effectiveness, cost savings or arbitrary process isolation. Windows checks and
successful model-backed evaluation remain target-environment work; no paid
evaluation ran.

## Verification snapshot pairs and pending repair acceptance

Local Linux checks on 2026-10-13 with Bun 1.2.15, based on main v0.7.0:
typecheck and **124 harness tests (705 assertions)** passed. The OpenCode 2.0.26
repository-profile smoke check passed with **zero model calls**. Diff and changed
documentation link checks passed.

Controller regressions cover a passing verifier whose source files change between
the native before/after hooks, overlapping call IDs, a missing before observation,
an in-flight check spanning plugin restart and revocation of accepted evidence
after a source mutation during its rerun. The failure-then-success regression now
requires entering bounded repair before acceptance; repair clears earlier receipts
and consumes the durable repair budget before fresh checks can accept the task.

These are controlled plugin-hook regressions. The native smoke establishes plugin
loading and the existing no-inference integration, not a successful model-driven
repair loop. Snapshot comparison does not detect transient changes reverted before
the after observation or establish filesystem isolation. Added snapshot overhead
on large trees, Windows integration and provider-backed effectiveness remain
unmeasured. No paid evaluation ran.

## Verification epochs, review ownership and token budgets

Local Linux checks on 2026-10-13 with Bun 1.2.15, based on main v0.7.0:
typecheck, **129 harness tests (745 assertions)**, **13 repo-context helper tests**,
three-case evaluation corpus validation, version consistency, production package
installation/import/CLI/TUI rendering and diff checks passed. The OpenCode 2.0.26
repository-profile smoke check passed with **zero model calls**.

Regressions reject passing checks started before repair, invalidation or recovery,
even with identical source snapshots. A late failure from the previous repair
epoch cannot revoke fresh acceptance or add a current verifier failure. Existing
v1 tasks without an epoch remain readable. Tests also reject both overlapping and
disjoint task execution while another task awaits review, without creating a child
or spending delegation budget, and permit the next task after acceptance. Native
edits reject ambiguous ownership in older concurrent running/review state.

Primary and executor token-budget tests cover below-limit and at-limit totals,
including separate cache-read/cache-write and reasoning tokens. Budget enforcement
and reporting share the native token-category sum; missing usage remains unknown.

These are controlled hook regressions and a no-inference loading smoke check.
Successful provider-backed repair loops, Windows integration and large-repository
snapshot overhead remain unmeasured. No paid evaluation or release ran.

## Parallel independent analyses

Local Linux checks on 2026-10-13 with Bun 1.2.15 and pinned API 2.0.26:
typecheck, **140 harness tests (861 assertions)**, **13 repo-context helper tests**,
three-case evaluation corpus validation, version consistency and production
package installation/import/CLI/TUI rendering passed. The OpenCode 2.0.26
repository-profile smoke passed with **zero model calls**, creating three native
children concurrently under one parent and checking persisted ownership and
read-only session permission rules. These native children did not dispatch tools
or execute model prompts; full group execution is covered by controlled plugin
fixtures, not a provider-backed native run.

Controlled session waits prove three analysis children reach execution before
any completes. Regressions cover capacity for delegation and DIRECT start,
review slot release, bounded repair admission, same-task overlap, individual
acceptance while peers run, exclusive change/verification in both directions,
and atomic rejection without children or budget for invalid group contracts,
dependencies, tools, handoffs, retry rules and exhausted budgets. They also cover
mixed success/failure with separate child usage records, timeout, parent
cancellation, owner switch, restart/recovery and late callbacks. Child evidence
stays task-scoped; primary evidence uses each task's separate verification epoch.
External mutations block fresh acceptance, and primary native edits are denied
through running/review analysis states. Setup retains existing limit overrides.

The limit is per primary session. Cross-session workspace locking, parallel
writers, transient mutations reverted between snapshots, Windows native execution,
large-tree snapshot overhead and successful provider-backed concurrent analysis
remain untested. Contracts and dependencies declare independence; these results
do not prove semantic independence, filesystem isolation, effectiveness or cost
savings. No paid evaluation or release ran.

## Concurrent recovery and unattributed verifier callbacks

Local Linux checks on 2026-10-13 with Bun 1.2.15: typecheck and
**142 harness tests (895 assertions)** passed. The OpenCode 2.0.26
repository-profile smoke passed with **zero model calls**, including three native
read-only child sessions. Diff and changed-document link checks passed.

Controlled regressions make the first child interruption or contract-storage
write fail. Recovery blocks attempts before native calls, attempts every contract
revocation and interruption, and reports incomplete cleanup after all calls
settle. Late child completions preserve recovered state. Another regression
delivers passing and failing checks started before task execution, unpaired
callbacks and callbacks spanning plugin restart after fresh acceptance; none
revokes current evidence. Unpaired checks cannot grant receipts, and a fresh
paired check remains necessary before acceptance.

These tests establish controller behavior under controlled failures. An incomplete
recovery does not prove that native child execution stopped. Successful
provider-backed concurrent delegation, Windows integration and filesystem
isolation remain unverified. No paid evaluation or release ran.

## Conservative defaults and recovery diagnostics

Local Linux checks on 2026-10-13 with Bun 1.2.15: typecheck and
**147 harness tests (923 assertions)** passed, along with **13 repo-context helper
tests**, three-case corpus validation and version consistency. Production package
installation/import/CLI/TUI rendering passed. The repository-profile OpenCode
2.0.26 smoke passed with **zero model calls**, using an explicit Linux executable
through `OPENCODE_BIN` rather than the unavailable PATH wrapper. It still creates
three native read-only children to check ownership and permission mechanics;
it does not prove successful provider-backed group execution.

Analysis concurrency now defaults to one in the ledger, plugin and template;
explicit overrides remain intact. Controlled overlap tests explicitly enable
three slots. Added regressions cover atomic group rejection under the serial
default, task-specific repair guidance without budget consumption, dependency and
exhaustion guidance across restart, primary/executor near-limit warnings, unknown
versus measured-zero budgets, and snapshot diagnostics without freshness caching.

Three source scans of this checkout, excluding generated `work` data, covered
71 files/symlinks and took approximately 31–38 ms each. This small local sample
is not a large-repository benchmark or evidence of a snapshot speedup. Diagnostics
expose scan durations and counts; no snapshot cache or filesystem lock was added.

Before enabling concurrency on a target provider, opt-in integration should cover
two independent successful analyses, one failed child with a successful sibling,
parent cancellation, restart/recovery, and a source mutation before acceptance.
Check native child ownership, final task states, fresh evidence and usage coverage
against independent assertions. No paid evaluation ran; successful real-provider
execution, large-tree overhead and cross-session filesystem isolation remain gaps.

## Repository formatting

On Linux on 2026-10-13, Prettier 3.9.10 was pinned as a development dependency
and applied to supported repository files. `format:check`, typecheck,
**147 harness tests (923 assertions)**, **13 Python helper tests**, corpus
validation, version consistency, package installation/import/CLI/TUI rendering,
workflow Actionlint and diff checks passed. The OpenCode 2.0.26 repository-profile
native smoke passed with **zero model calls**. Local Windows validation was not
run; the reusable Windows/Linux CI now includes the formatting check.

Formatting excludes dependencies, generated artifacts and local credentials.
Markdown retains double quotes in skill front matter for the existing JSON-string
loader. The initial formatting pass spans existing source and documentation;
formatting checks do not establish semantic effectiveness or provider isolation.
No paid evaluation or release ran.

## PR #20 usage and evaluation corrections

Local Linux checks on 2026-10-13 with Bun 1.2.15: typecheck, **151 harness
tests (971 assertions)**, **13 Python helper tests**, three-case evaluation corpus
validation, version consistency, formatting, production package installation/import/CLI/TUI
rendering, changed-document local links and diff checks passed. The repository-profile OpenCode 2.0.26
smoke passed with **zero model calls**, including three native read-only children.

New controlled regressions allow 347,000 historical tokens without a default
hard stop, preserve explicit numeric usage limits for primary and executor, and
keep absent counters distinct from measured zero. Warnings describe cumulative
usage rather than context exhaustion. Evaluation requires explicit runtime success
and reports execution confirmation separately from behavior, scope and usage
coverage. Unknown or non-success outcomes cannot pass independent assertions into
an overall success; missing usage alone does not reject confirmed success.

Extended epoch tests reject late failures after fresh acceptance following
invalidation or recovery. A deterministic two-slot test holds both children at
barriers, rejects a third analysis and exclusive edits, denies read-only worker
writes, and observes one worker remaining active after its sibling fails. Existing
regressions continue to cover restart, workdir mismatch, source mutation, durable
repair requirements/budgets and recovery attempting every interruption despite
failures. No verification state or lock was added.

These are controlled lifecycle checks and a native no-inference smoke, not a
successful provider-backed concurrent execution or an effectiveness/isolation
claim. Remote CI and Windows were not run locally. Large-JSON handling remains a
separate follow-up; these corrections do not establish native large-file limits
or solve actual context overflow. No paid evaluation, release or PR merge ran.

## Brownfield evaluation baseline

Local Linux checks on 2026-10-13 with Bun 1.2.15: typecheck,
**164 tests (1,059 assertions)**, development/holdout corpus validation and formatting
passed. The OpenCode 2.0.26 repository-profile no-inference smoke also passed with
**zero model calls**. Its new native shell check generated 1,728,892 bytes of JSON,
retrieved bounded 12,000-byte slices and verified cursor continuation. The native
API's `truncated` flag was false for these bounded slices; byte counts and cursor
progress establish retrieval coverage without assuming that flag describes paging.

Ten added synthetic cases cover local bugs, cross-module consumers, public API
compatibility, shared-module refactoring, conventions, preserved behavior and
independent read-only analysis. Six join the three original development cases;
four live in a separate holdout file. Controlled fixture tests reject each original,
accept a scoped reference repair, preserve existing tests and reject broken behavior
even when workspace tests are removed. The runner retains native usage reconciliation,
adds explicit matched primary-model selection and records configured conditions and
observed model IDs. Reports expose token/delegation totals and coverage without
replacing unknown counters with zero or dropping failed-attempt costs.

Large JSON hook coverage leaves output unchanged and verifies dispatch after
347,000 historical tokens under default/null limits, rejection under an explicit
300,000 limit and unknown counters remaining unknown. Existing primary/executor
limit regressions still pass. See the [methodology and threats](docs/benchmark.md).
This does not prove model-facing native tool line truncation, provider dispatch at
actual context capacity, real-repository effectiveness, isolated delegation overhead
or strategy superiority. Paid benchmarks and Windows integration were not run.

## DIRECT and SELECTIVE evaluation protocols

Local Linux checks on 2026-10-13 with Bun 1.2.15: typecheck,
**172 tests (1,111 assertions)** and both development/holdout corpus checks passed.
The OpenCode 2.0.26 repository-profile no-inference smoke passed with **zero model
calls**. Native checks use the same preparation helper as evaluation: persist
session permissions, resume each protocol through the CLI with `--auto` and an
unavailable provider, confirm session identity and verify DIRECT denies remain
while read/edit/test permissions are retained. Separate fresh workspaces/databases
also produced identical resolved-settings fingerprints. New protocol checks run
only in repository-profile mode, preserving customized global configuration checks.

The runner pairs cases/repetitions, alternates strategy order, detects changed
harness source or resolved settings before dispatch and checkpoints every attempt.
Performance runs require a successful matched provider-backed fixture smoke for
both protocols; no such run was authorized or executed here. Original fixture
regression sources run independently of workspace tests, with their original import
directory. Tests cover removed workspace tests, failed regression acceptance,
unknown counters, distinct cost/token coverage, incomplete lifecycle, unmatched or
duplicate pairs, descriptive variability, provider/child retries and repair counters
from paginated native history. SELECTIVE without children remains SELECTIVE.

These results validate deterministic protocol controls and native permission
persistence, not successful provider coding, comparative savings or process
isolation. Missing tool history leaves repair counts unknown; child retry counts do
not infer rejected requests without a child. Within-attempt external configuration
changes and counterfactual delegation overhead remain limitations. Provider-backed
smokes/repetitions, parallel-provider experiments and Windows integration were not
run. See the [methodology](docs/benchmark.md) before interpreting comparisons.

## Evaluation scope and recurring update checks

Local Linux checks on 2026-10-13 with Bun 1.2.15: typecheck, **178 tests**,
**13 repo-context helper tests**, formatting, evaluation corpus validation,
version consistency and production package validation passed. The packaged TUI
rendered in development and production modes. Final updater/TUI checks passed
**19 tests**, including daily timer scheduling, overlapping callback rejection,
disposal, persisted failures during throttled startup and error clearing after a
successful check. The OpenCode 2.0.26 repository-profile native smoke passed with
**zero model calls** and verifies the version RPC has no update error when the
updater is disabled.

Evaluation tests verify that independent checks cannot introduce an agent scope
violation through generated files or hide a forbidden edit by restoring it.
Their net workspace mutations are reported separately. Smoke readiness remains
independent of corpus/split selection and usage completeness.

Update scheduling uses controlled timer callbacks rather than a real 24-hour wait.
Failures and recovery use controlled dependencies; a complete background upgrade
between published npm releases and Windows timeout/TUI behavior remain untested.
Native smoke disables the updater and does not verify actual installation.
No paid/model-backed evaluation, publication or user configuration change ran.
