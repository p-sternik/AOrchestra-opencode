# Technical reference

For installation and everyday use, start with the [README](../README.md).

## Global installation

Prefer the packaged `aorchestra setup` command in the [README](../README.md).
It invokes native plugin add, pins the stable npm version or explicit main commit,
embeds the installed instructions and merges global JSONC. Native
`opencode plugin add aorchestra-opencode-v2@latest` (or `opencode2 plugin add`)
only registers the plugin; run setup to configure or update its agents and models.
Setup and native checks accept stable OpenCode `>=2.0.26 <3.0.0`, with API packages
pinned to 2.0.26. Native checks passed on runtimes 2.0.26 and 2.0.27; other accepted
versions still need integration checking. CLIs through 0.4.2 enforce the former
exact-version gate. See [runtime validation](../VALIDATION.md#runtime-version-compatibility).

For manual/source installation, discover the directory with
`opencode2 debug paths`, checking
`OPENCODE_CONFIG_DIR` and the loaded config sources as described in the
[setup guide](setup-for-agents.md). Merge the template into the existing global
opencode.json/jsonc, preserving unrelated settings and JSONC comments. Use absolute
plugin directory and instruction paths pointing to the permanent harness checkout,
or a package spec and embedded instruction text for a packaged installation.
Normal use requires no project config or OPENCODE_CONFIG override. Project-local
config can still override global settings.

## Automatic updates

Stable setup writes `options.updateManagedPackage` equal to its exact npm package
spec and defaults `autoUpdate` to true, preserving an existing false value. An
explicit `--package` or `--channel=main` removes the marker. Earlier installations
remain pinned until setup from a release containing this feature is run. Editing
the package without changing the marker creates a manual pin. `autoUpdate: false`
means notification only; `updateCheck: false` disables checks. Both options must
be booleans. Local/project options can disable automatic installation as well.

Startup schedules work after plugin registration; it does not wait for the network
or call a model. Global JSON/JSONC discovery uses the native global paths and
`OPENCODE_CONFIG_DIR`. Multiple AOrchestra registrations, Git/local sources,
prerelease versions, explicit config/content overrides and mismatched active native
package metadata skip checks. This prevents a checkout from updating a global
installation. `AORCHESTRA_DISABLE_UPDATE=1` also skips checks, and setup/check
subprocesses set it to prevent recursive installation.

The updater records check attempts in native plugin storage before requesting
npm's latest stable metadata, including offline/failed attempts. The interval is
24 hours per native storage scope; native cross-process file locking serializes
automatic checks/installations for the same global config directory. A lock timeout
skips that attempt. The registry request times out after ten seconds. Greater
stable versions in the same major are eligible; major upgrades only notify.

An isolated Bun worker uses native `Npm.add`/`resolve` with an exact spec, checks package
identity/version, and runs that package's CLI with `setup --update-from=<old-spec>`.
This internal flag requires a matching managed registration, complete configured
models and a greater version in the same major. The CLI re-reads global config,
retains all chosen models (unavailable models fail rather than falling back),
merges instructions/options through normal setup, backs up changes and performs
the global zero-inference check. Existing concurrent-config protection still
applies. The worker and its children have a 15-minute timeout and use `OPENCODE_BIN` or the hosting
OpenCode executable when recognizable; Bun remains required.

Notifications are written to the server log and added to the next AOrchestra
primary context, and version/update status appears in the TUI sidebar footer.
They do not reload a running plugin/session: restart OpenCode
after success. Network/install/check failures leave execution available and do
not trigger an immediate retry. A failed post-install check can leave the backed-up
configuration change visible, as in manual setup; inspect the backup and rerun
setup manually. There is no automatic rollback. This feature has no provider
inference or semantic-effectiveness claim.

The package exposes a native `./tui` entrypoint; local directory discovery uses
`plugins/aorchestra/tui.ts`. Its additive `sidebar.footer` contribution shows
`AOrchestra v<loaded-version>` and, when applicable, `v<version> available` or
`v<version> installed · restart required`. It reads the location-scoped
`aorchestra.status.get` RPC from the active server plugin, rather than assuming
the TUI bundle and server have the same version. The read-only RPC returns
`version`, nullable `availableVersion` and nullable `installedVersion`.

The sidebar refreshes every ten seconds while mounted, cancels requests when its
session/location changes or it is disposed, and ignores late responses. An
unavailable RPC shows `Status unavailable` without substituting a local version.
Update state is persisted as structured metadata alongside the existing check
timestamp/message. An update is marked installed only after setup and its check
succeed; a newly loaded version ignores status from the previous package spec.
The sidebar makes no registry requests or model calls. Its TSX file declares
`@jsxImportSource @opentui/solid` locally, so an npm installation does not require
the checkout's tsconfig. Solid, OpenTUI and the TUI theme are production dependencies.
Text and visibility use reactive getter props in OpenTUI's JSX runtime, including
when Bun loads the package without the Solid compiler transform.

Development render tests use Solid's browser condition and OpenTUI's native JSX
preload through `bun run test`. `npm run pack:check` additionally installs a fresh
production consumer outside the checkout and renders the packaged sidebar without
that preload or tsconfig, in both development and production JSX modes. It checks
the server-reported version, installed-update text and request disposal.

## How it works

The primary performs cohesive investigation/edit/test work directly. It delegates
settled, bounded changes or independent analysis when the separation is useful.
Each delegation builds an instruction/context/tools/model contract for a fresh
native child session. There is no additional agent runtime or mandatory planner,
reviewer or model-powered summarizer.

- `aorchestra_task` registers tasks, dependencies, exact write paths, compatibility
  constraints and verifiers; plans, starts, verifies, repairs, accepts, resumes,
  invalidates or recovers work.
- `aorchestra_delegate` executes a registered contract with an explicit model tier,
  routing reason and, on retry, a description of what changed.
- A worker's completion report is separate from acceptance. Acceptance requires
  current observed verifier results, changes within the tracked scope and the
  primary's explicit compatibility review.

The primary allows exact `npm|pnpm|yarn|bun run typecheck|lint|test` commands,
`bun test` (including arguments), and `git status|diff|log|show|rev-parse` (including
arguments). Other shell commands ask; existing explicit restrictions still apply.
Use native `workdir` rather than adding `cd` to a check command. Additional package
script flags and commands such as Python checks use normal permission evaluation.
These allowances trust project scripts to execute code, including hooks; they do
not establish isolation. Native shell parsing evaluates individual resources in
compound commands. Default-rule migration is exact and ordered, preserving custom
rules and project overrides. Stable setup pins the invoked CLI version; obtain a
new stable version by invoking its CLI, or choose `--channel=main` explicitly.

Native child-session permissions default to deny. Workers receive selected tools
and exact edit paths. Workers do not receive shell; the primary runs verification
through native tools. Analysis/verification workers have a known read-tool
allowlist. Native edits by the primary are also checked during tracked work.

The instructions favor the nearest existing implementation, project conventions,
small replacements, reuse and removal of obsolete code within the requested scope.
These are model instructions; tests still establish behavior and compatibility.

## Task contracts and verification

A registered task includes `id`, `kind`, `instruction`, `context`, `dependsOn`,
`writePaths`, `preserve` and `verifiers`. Dependencies refer to earlier registered
tasks. Write paths are exact relative filenames rather than globs.

Every delegation also requires a bounded `handoff`, supplied on registration or
on the delegate call (including for an older stored task). Its `sources` distinguish
observed references from candidates, with an explicit revision or `unknown`;
`facts`, `unknowns` and `checks` are separate arrays. Empty arrays are allowed where
appropriate, but a source/search target is required. The handoff is capped at 12k
characters and sent to the child with a runtime source-snapshot fingerprint.
Neither a supplied revision nor the fingerprint proves the facts are current.

```json
{
  "sources": [{ "ref": "src/users.ts:findUser", "status": "observed", "revision": "unknown" }],
  "facts": ["Missing users currently trigger a dereference error"],
  "unknowns": ["Legacy caller expectations have not yet been checked"],
  "checks": ["Focused regression test not run"]
}
```

For research, `analysisMode: lookup` permits fast fact extraction; synthesis
requires balanced/strong. One known lookup normally stays DIRECT. Main-model
capability is separate from worker tiers: delegate a bounded strong investigation
or deliberately change the main model when direct reasoning exceeds it.

The default remains two attempts. Same-tier and one-tier retries require delta
and routing evidence; fast-to-strong additionally requires `escalationReason`:
reasoning-gap, compatibility-risk, security-risk or weak-verification. Downgrades
are rejected. Missing permissions/tools are blockers rather than model-escalation
signals. Categories and analysis modes are declared contracts, not automatic
semantic assessments. Distinct tiers have no effect if they map to one model.

Example verifier:

```json
{
  "id": "regression",
  "tool": "shell",
  "input": { "command": "bun test tests/api.test.ts" },
  "expect": { "exitCode": 0 }
}
```

Use the actual native tool schema and input fields. Exit-code verification needs
an observed numeric `metadata.exitCode`, `metadata.exit` or `output.exitCode`;
missing codes remain unverified. `contains` supports bounded read/grep evidence.
Acceptance also requires `compatibilityReview`, which is reasoning by the primary,
not a formal semantic proof. Failed work is not automatically rolled back.

## Workflow and project-aware verification

Task metadata uses the existing v1 ledger with optional `workflow`,
`verification` and `verificationEpoch` fields. Older tasks acquire phases without
losing their baseline, attempt history, receipts or delegation budget. Registration starts at `discover`
and records a transition to `plan`; start/delegation enters `execute`. Native
verification outcomes or `task verify` enter `verify`. Only acceptance, with fresh
predicates, write-scope validation and compatibility review, enters `complete`.
Failures/interruption can enter `blocked`. These phases describe control state,
not a model-generated architecture plan or proof of discovery completeness.

Independent `kind: analysis` tasks with empty `writePaths` may coexist in
`running` or `review`. Their contracts and `dependsOn` express independence; the
harness does not infer it from topics. `maxConcurrentAnalyses` is a positive
integer, default **1**, per primary session. Parallel execution is opt-in: configure
2 or 3 after validating the target provider's concurrent lifecycle. Existing explicit
overrides are preserved by setup. Only `running` analyses consume slots,
including DIRECT work, reserved delegations and repair. Planning and verification
remain possible at capacity. Review releases a running slot but still blocks
exclusive work and primary native edits. Accept analyses individually after fresh
checks and an explicit compatibility review, including while peers run.

Change and verification tasks remain exclusive through acceptance, even for
disjoint paths. Before switching from invalidated/recovered work, inspect retained
changes. Recovery blocks unfinished attempts before native calls, revokes their
contracts and attempts to interrupt every child even when one call fails.
`RECOVERY_INCOMPLETE` reports storage or interruption failures after all calls
settle; inspect the native child sessions because failed interruption does not
establish that execution stopped. Unrelated analyses
are not revoked by a sibling's failure. Native edit denial and whole-tree snapshot
checks do not establish filesystem isolation; avoid repository mutations through
shell or external tools during analysis. Cross-session workspace locking and
parallel writers are outside this scheduler.

Use a separate worktree for each independent primary session and keep other writers
out of that worktree during verification. This reduces accidental interference;
worktrees and native permissions are not process isolation.

Task responses expose `nextAction` with a reason and a suggested native tool call
when one is applicable. Placeholders in repair reasons and compatibility reviews
must be replaced with observed evidence. Capacity, dependency and exhausted-budget
blocks report why execution cannot proceed. Task-operation errors retain their error
code and add the task ID and recovery guidance. `resume` lists pending predicates;
checks interrupted by plugin restart need a new observed before/after pair. Guidance
does not execute operations or reset budgets, receipts or acceptance rules.

Status also returns `tokenBudget` (limit, consumed, remaining and nearLimit) for the
primary native session. At 80% of the limit, primary and executor context hooks add
a warning before model dispatch. All native token categories count; absent counters
keep consumed/remaining/nearLimit unknown rather than inventing zero. This remains
a per-session safeguard, not a whole-workflow cost cap.

The existing single-task delegate input/result is unchanged. For a group, supply
at least two unique registered analysis IDs with their usual routing fields.
This two-task example requires plugin option `maxConcurrentAnalyses: 2` or greater:

```json
{
  "tasks": [
    {
      "taskId": "callers",
      "model": "balanced",
      "tools": ["read"],
      "routingEvidence": "Independent caller analysis"
    },
    {
      "taskId": "compatibility",
      "model": "strong",
      "tools": ["read"],
      "routingEvidence": "Independent compatibility analysis"
    }
  ]
}
```

Each task needs its bounded source handoff, either registered or on its item.
Group and single-task fields are mutually exclusive. Admission validates all
members and reserves all attempts atomically against one source snapshot before
creating children. Invalid or oversized groups spend no budget and create no
children; there is no queue. Children run concurrently with separate permissions,
timeouts and evidence. The group waits for all to settle and returns `{results}`
in input order, each containing `content`, identity/attempt metadata and
`accepted: false`, plus `error` for a failure. A child failure leaves siblings
running; parent cancellation interrupts all outstanding children. A matching
primary check can attest to multiple tasks using their separate verification
epochs, while child checks remain scoped to their own task.

| Operation | Behavior                                                                         |
| --------- | -------------------------------------------------------------------------------- |
| `plan`    | Refresh project checks before starting; no commands run                          |
| `verify`  | Select checks for baseline-to-current affected paths, enter verification         |
| `repair`  | Require an evidence-based `reason`, clear receipts, consume one repair cycle     |
| `resume`  | Read current phase, budgets, `pendingVerifiers`, observations and plan freshness |

Registration selects checks from declared write paths; delegation refreshes them
from actual affected paths on return. DIRECT work calls `verify` after edits.
Acceptance reselects against current files so omitting `verify` cannot bypass
required discovered checks. `resume` is read-only: it never spends a delegation,
launches a child, reruns a command or duplicates phase events. `recover` remains
an explicit action that interrupts stale children and preserves their files.
Invalidation resets plan/baseline and dependent tasks, retaining repair counters
and any pending repair requirement. After a failed matching verifier, `recover`,
`plan`, `start`, delegation and plugin restart cannot replace bounded repair.
Acceptance also rejects a pending repair requirement, even if a later matching
command passes. Enter repair with an evidence-based reason, then rerun the checks;
receipts collected before repair are cleared.
If invalidation removed the baseline, entering repair records a new one and
consumes the same durable repair budget.

Set `maxRepairs` in plugin options (positive integer, default **2**). When another
repair would exceed it, the task returns `blocked`; start, invalidation and plugin
restart do not reset that budget. This is independent of `maxAttempts` (**2** by
default) and `maxDelegations`. Enter repair before editing a task in verification
or retrying its child. A retry still requires `delta`, tier evidence and existing
escalation/budget checks. Successful runtime execution alone does not consume a
repair or accept the task.

Project checks are selected deterministically:

1. For each affected path, use all matching `options.verification` rules. Paths
   are exact filenames or directory prefixes; `.` matches the project. No globs.
2. For uncovered paths, locate the nearest ancestor `package.json` inside the
   project and select existing nonempty `typecheck`, `lint`, `test` scripts.
   Use its supported `packageManager`, otherwise walk ancestors for a workspace
   declaration or nearest unambiguous lockfile.
   With no declaration/lockfile, use npm. Unknown/conflicting managers are gaps.
3. Run the script in that package using native shell's `workdir`, including for
   the project root. Shell predicates bind to their effective directory: omitted
   `workdir` means the native session location, and an identical command in another
   package cannot grant or revoke its receipt. Equivalent relative/absolute
   directories deduplicate. Do not guess framework flags, test filenames, dependency graphs,
   watch-mode overrides or build requirements. Root-wide/cross-package checks
   and other languages belong in explicit rules or task predicates.

Example plugin options (merge into the existing plugin registration):

```json
{
  "maxRepairs": 2,
  "verification": [
    {
      "paths": ["services/api"],
      "verifiers": [
        {
          "id": "api-regression",
          "tool": "shell",
          "input": { "command": "python -m unittest discover -s services/api/tests" },
          "expect": { "exitCode": 0 }
        }
      ]
    }
  ]
}
```

Explicit task predicates remain required and are never replaced. Identical
predicates are deduplicated and generated IDs remain stable across plan refresh.
Missing discovery is reported in `gaps`; a task's explicit predicates can supply
checks when the project has no supported convention. Gaps are not successful
checks or assurance of broad coverage. Malformed manifests and escaped symlinks
fail closed rather than silently skipping verification.

The controller injects pending tool/input pairs into the primary's native context
and records native outcomes as `{event, snapshot, passed}`. Commands still need the
primary's native tool call and normal permission evaluation. OpenCode 2.0.26's
plugin tool domain has no permission-preserving dispatch API; calling a tool's raw
`execute` or a host subprocess would bypass that boundary, so this controller does
neither. It does not promise unattended end-to-end execution or automatic repairs.
Each matching verifier captures a source snapshot in the native `execute.before`
hook and compares it with the snapshot in `execute.after`, using its session and
call IDs. A passing result grants a receipt only when both snapshots match and
the task's verification epoch is unchanged. Resetting receipts for execution,
repair, invalidation, recovery, native edits or accepted-evidence revocation
advances the durable epoch. Checks started in an earlier epoch are ignored by
the acceptance controller and verifier counters; their native tool events remain
in telemetry. An old result cannot grant a receipt, consume another repair cycle
or revoke newly accepted evidence, even when sources are identical. Existing
tasks without an epoch use zero until their evidence is reset.
Changed sources during an attributed check make the result unverifiable, revoke
its receipt and require bounded repair. A callback without a matching before
observation cannot grant or revoke evidence, add verifier observations or require
repair: its task and epoch ownership are unknown. In-flight snapshot observations
are local to the loaded plugin; checks spanning a restart must be rerun to provide
new evidence. Unpaired callbacks leave fresh evidence collected afterward intact. Comparing
snapshots does not detect a transient edit that is reverted before the after
snapshot, and it does not lock the filesystem against other processes.
A failed matching rerun revokes any earlier successful receipt, including on an
unchanged snapshot. After acceptance, a failed or unverifiable matching rerun
blocks the completed task and all transitive dependents, clears their receipts and
compatibility reviews, and interrupts active dependent children. Baselines, attempt
history and consumed budgets survive. A later successful rerun alone cannot restore
acceptance: enter bounded repair, obtain fresh checks, then accept
with a new compatibility review. Successful reruns do not refresh accepted receipts.
Later edits invalidate receipts of unfinished tasks.

Status/context freshness uses the existing whole-tree snapshot provider. This
adds snapshot work during tracked verification and has not been benchmarked on
large repositories; incremental snapshots remain a separate change. Untracked
DIRECT work retains native behavior and has no new semantic acceptance claim.

Task status includes plugin-local `snapshotDiagnostics`: scan count, total and last
duration in milliseconds, last successful file/symlink count, and failure count.
These cover all owners in the loaded plugin and reset on plugin restart; they are
not persisted telemetry or per-task timings. Every scan still hashes current sources.
Measure representative projects before changing exclusions. `snapshotIgnore` matches
basenames throughout the tree, so exclude only confirmed generated directories;
excluding source directories weakens freshness coverage.

## Repository context

A portable [repo-context skill](../skills/repo-context/SKILL.md) is bundled and
registered through the native skill transform. Invoke it explicitly with
`@aorchestra-repo-context` or ask the agent to map/update repository documentation.

It reuses existing docs, starts with a short repo-map, adds architecture/domain/flow
detail only when useful and updates a bounded navigation block in AGENTS.md while
preserving authored rules. Its optional standard-library Python helper indexes
files/symbol candidates and checks source freshness and links. It is not Aider's
graph-ranking engine.

Existing context can be read when relevant; missing documentation leads to normal
code search. The skill has `autoinvoke: false` and the namespaced native ID
`aorchestra-repo-context`. Main-agent permissions allow the bundled repo-context and improvement skills by
default.
Global skill discovery remains enabled for other agents; existing explicit user
exclusions are preserved. Repository AGENTS.md instructions still apply.

## Metrics and improvement reports

Local metadata is collected automatically from native execution events and hooks,
including DIRECT work without registered tasks. Full prompts, tool arguments,
outputs and raw errors are not copied into the aggregates. Full trajectories stay
in native OpenCode storage. Set `telemetry: false` to stop collection.

From the harness checkout:

```sh
bun run report -- --project=/absolute/path/to/project --output=/path/to/report.md --export=/path/to/metrics.json
bun run report -- --input=/path/to/metrics.json --output=/path/to/offline-report.md
```

The report reads the plugin's `aorchestra.metrics.list` RPC through a compatible
service or a temporary private server. It makes no model calls. Set `OPENCODE_DB`
for a custom native database, or use `--server=http://localhost:port` and
`OPENCODE_SERVER_PASSWORD` where needed. Data must come from the same project/DB.

Reports separate harness versions and DIRECT/delegated runs. They show error
categories, verifier failures, repeated inspections, retries, time and available
cost estimates. One record is a primary execution cycle, not necessarily a whole
ticket. Runtime success is separate from verified task success; untracked DIRECT
semantic correctness remains unknown. Missing usage is `null`, never invented zero.
Costs are platform-counter estimates rather than provider invoices. Reports show
terminal, unfinished, interrupted and complete/unknown workflow-cost coverage.
The measured-record sum includes only terminal records with known primary and all
recorded child costs, including failed workers. It is not a total over unknown-cost
records. Imported `truncated: true` stays partial through offline re-export.
Any child session classifies a run as delegated, without measuring DIRECT work
performed before delegation.

Repeated signals can produce evidence-linked hypotheses after three runs. This is
a review heuristic, not statistical significance or proof of strategy superiority.
The harness does not modify its own prompts or routing policy. The intended loop is
observation → hypothesis → matched-task replay → reviewed versioned change.

## Reviewing harness improvements

The bundled [improvement skill](../skills/improve/SKILL.md) has native ID
`aorchestra-improve` and `autoinvoke: false`. It is invoked explicitly, like
repo-context, and is not injected into ordinary coding sessions. Use a supplied
report/export or request collection for an identified project/DB using the report
commands above. Outside a checkout use `aorchestra report` with the same options.
Neither collection nor rendering calls a model; interpreting evidence happens in
the requesting primary session.

Each of at most three proposals includes observation and native references,
hypothesis and confidence, target files, smallest change, expected benefit,
regression risk and validation method/success criteria. Empty or inadequate data
must yield insufficient data, not generic optimization advice. Inspect the matching
harness version and nearest tests before proposing a change. Full trajectories stay
in native storage; do not copy sensitive content into proposals.

The process is evidence → hypothesis → smallest candidate → matched evaluation →
reviewed decision. A focused bug fix needs a regression. Behavior changes need
matched baseline/candidate revisions, cases, model settings and budgets, independent
behavior/regression/scope checks and explicit success criteria. Keep development
cases separate from holdout cases; do not tune on holdout outcomes. Adopt only when
criteria are met, reject demonstrated regressions or missing benefits, and mark
missing measurements or inadequate comparisons inconclusive. No policy is adopted
automatically. See the skill's [experiment guidance](../skills/improve/references/experiments.md).

The existing three-case evaluation suite is smoke coverage. Its runner reconciles
native workflow usage as described [below](#validation-and-evaluation); missing
measurements remain unknown. Deterministic checks alone cannot establish cost
savings. Paid `eval:run` remains opt-in. There is no new experiment registry, diagnostic service,
agent, mandatory runtime phase or self-modification loop.

## Validation and evaluation

```sh
npm run format:check
bun run typecheck
bun run test
python -m unittest discover -s tests -p '*_test.py'
bun run eval:check
bun scripts/version-check.ts
npm run pack:check
bun run check
```

If the CLI on PATH is a broken wrapper or belongs to another platform, select a
working native executable explicitly without changing global configuration:

```sh
OPENCODE_BIN=/absolute/path/to/opencode bun run check
```

The native smoke check accepts stable OpenCode >=2.0.26 <3.0.0 runtimes.
The API packages remain pinned to 2.0.26; acceptance by the version gate is
separate from successful native integration checks on that runtime. The check uses
a temporary localhost server and isolated database under `work/runtime`, tests plugin/skill
loading and controlled failure telemetry, and makes zero external model calls.
CI runs the deterministic checks on Windows and Linux; native smoke is a local
runtime integration check.

`bun run check` validates the repository template. `bun run check -- --global`
validates normal global discovery instead, removing explicit config/content
overrides from its private server environment. It checks that both agents are
declared in loaded global documents and uses a neutral project directory by default
to avoid the repository template overriding global config. Set
`AORCHESTRA_CHECK_PROJECT` to test a specific project location. Both modes use an
isolated database and make no model calls. The `--global` mode is available on main
and in releases that include this change; the original 0.2.2 checker has no such mode.

The packaged CLI exposes the same check as `aorchestra check`, with optional
`--project=/path`. Package registrations are checked against native source metadata;
the skill must come from the actually loaded package rather than the CLI cache.

Opt-in real-model evaluation:

```sh
bun run eval:run -- --strategy=both --repeat=3
```

This runs paid/provider-backed inference on three fresh fixture workspaces under
`work/eval` (override with `--output-dir`). Each attempt has a separate native
OpenCode database, a `workspace` directory, `trajectory.jsonl` and `metrics.json`.
The database and measurement files live outside the workspace so they do not
contaminate scope checks. Automatic harness updates are disabled for evaluation.
The private database does not copy credentials from the normal native database;
configure provider access through the native configuration/environment for this
opt-in run. Project and global configuration discovery otherwise remains native.

The runner reads the unique native root session from that attempt's database and
cross-checks any session IDs emitted by the CLI. It uses exact session/run IDs,
checks native child ownership against telemetry and rejects multiple primary
execution cycles or unrecorded descendants. It never correlates by timestamps,
fixture names or project directories. Partial stdout survives failed CLI exits.
A missing or ambiguous correlation is an explicit usage issue, not a zero cost.
Raw native JSONL can contain task/tool content; only metadata is exported to
`metrics.json`, as in the regular telemetry report.

`report.json` uses evaluation schema **version 2**, retaining `id`, `strategy`,
`repeat`, assertion/scope results and the existing nullable workflow-cost/token
fields. It adds session/run references, token categories, usage completeness and
issues, and per-strategy comparisons. In v2, `durationMs` measures CLI wall time,
including native startup, and excludes reconciliation and independent assertions.
`report.md` presents the same strategy summary. DIRECT attempts that delegate are
failed policy checks; SELECTIVE includes both native DIRECT and delegated work
chosen under the normal routing policy.
Delegation evidence includes native descendants, all matching primary telemetry
records and CLI delegation events. Missing child telemetry cannot hide a known
DIRECT policy violation; session IDs are deduplicated across observations.

Usage reuses the regular report's workflow calculation: primary execution deltas
plus each fresh child session once, including failed workers. Missing counters
remain null independently by category; measured zero stays zero. Native V2
normalizes output to visible tokens (excluding reasoning) and input to uncached
tokens, so total tokens sum input, output, reasoning, cache-read and cache-write.
Costs are native counter estimates, not provider invoices. An interrupted attempt
can retain known usage but has incomplete lifecycle coverage.

Independent assertions and scope checks determine verified success; telemetry's
native success alone never proves it. Observed cost sums attempts whose complete
workflow-cost counters are known, including failed/interrupted attempts; its run
count is shown alongside full usage coverage. Cost per verified success divides
the cost of **all** attempts in a strategy by verified successes, only when every
attempt has complete counters, correlation and lifecycle observations and there
is at least one success. Otherwise it remains null. No automatic winner or
percentage-improvement claim is generated.

The small corpus is a smoke suite, not representative legacy evidence. See
[VALIDATION.md](../VALIDATION.md) before interpreting results.

## Limits

- Default budgets: eight delegations per primary session, two attempts per task,
  two repair cycles per task, ten minutes per delegation and 300k reported tokens per native session. These
  are safeguards, not measured optimal thresholds or a hard whole-ticket dollar cap.
  The session-token limit uses the same total as usage reports: uncached input,
  visible output, reasoning, cache-read and cache-write. It is checked before the
  next model dispatch for both primary and executor; one response can cross it.
- Source snapshots include untracked files, do not traverse symlinks and exclude
  secrets, `.git`, `.opencode`, `node_modules`, `.cache`, plus root `coverage`,
  `dist` and `build`. Those root exclusions can hide meaningful files in unusual
  repositories. Extra artifact basenames can be configured through `snapshotIgnore`.
- Snapshots fail closed above 30k entries or an 8 MB file. Whole-tree hashing needs
  measurement before use in large monorepos.
- Tool permissions and path checks are not process isolation. The primary's shell
  can execute repository code beyond the native-edit scope checks.
- There are no isolated parallel writers, automatic merges or automatic rollback.
  Provider/MCP behavior and successful real-model coding still need target-environment tests.
- Missing events/counters can reduce telemetry coverage; incomplete records remain
  visible rather than being converted into success.
