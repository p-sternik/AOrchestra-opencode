# Technical reference

For installation and everyday use, start with the [README](../README.md).

## Global installation

Prefer the packaged `aorchestra setup` command in the [README](../README.md).
It invokes native plugin add, pins the stable npm version or explicit main commit,
embeds the installed instructions and merges global JSONC. For manual/source installation, discover the directory with
`opencode2 debug paths`, checking
`OPENCODE_CONFIG_DIR` and the loaded config sources as described in the
[setup guide](setup-for-agents.md). Merge the template into the existing global
opencode.json/jsonc, preserving unrelated settings and JSONC comments. Use absolute
plugin directory and instruction paths pointing to the permanent harness checkout,
or a package spec and embedded instruction text for a packaged installation.
Normal use requires no project config or OPENCODE_CONFIG override. Project-local
config can still override global settings.

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

Task metadata uses the existing v1 ledger with optional `workflow` and
`verification` fields. Older tasks acquire phases without losing their baseline,
attempt history, receipts or delegation budget. Registration starts at `discover`
and records a transition to `plan`; start/delegation enters `execute`. Native
verification outcomes or `task verify` enter `verify`. Only acceptance, with fresh
predicates, write-scope validation and compatibility review, enters `complete`.
Failures/interruption can enter `blocked`. These phases describe control state,
not a model-generated architecture plan or proof of discovery completeness.

| Operation | Behavior |
| --- | --- |
| `plan` | Refresh project checks before starting; no commands run |
| `verify` | Select checks for baseline-to-current affected paths, enter verification |
| `repair` | Require an evidence-based `reason`, clear receipts, consume one repair cycle |
| `resume` | Read current phase, budgets, `pendingVerifiers`, observations and plan freshness |

Registration selects checks from declared write paths; delegation refreshes them
from actual affected paths on return. DIRECT work calls `verify` after edits.
Acceptance reselects against current files so omitting `verify` cannot bypass
required discovered checks. `resume` is read-only: it never spends a delegation,
launches a child, reruns a command or duplicates phase events. `recover` remains
an explicit action that interrupts stale children and preserves their files.
Invalidation resets plan/baseline and dependent tasks, retaining repair counters.

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
3. Run the script in that package using native shell's `workdir` for nested
   packages. Do not guess framework flags, test filenames, dependency graphs,
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
A failed matching rerun revokes any earlier successful receipt, including on an
unchanged snapshot. After acceptance, a failed or unverifiable matching rerun
blocks the completed task and all transitive dependents, clears their receipts and
compatibility reviews, and interrupts active dependent children. Baselines, attempt
history and consumed budgets survive. A later successful rerun alone cannot restore
acceptance: explicitly restart or enter repair, obtain fresh checks, then accept
with a new compatibility review. Successful reruns do not refresh accepted receipts.
Later edits invalidate receipts of unfinished tasks.

Status/context freshness uses the existing whole-tree snapshot provider. This
adds snapshot work during tracked verification and has not been benchmarked on
large repositories; incremental snapshots remain a separate change. Untracked
DIRECT work retains native behavior and has no new semantic acceptance claim.

## Repository context

One portable [repo-context skill](../skills/repo-context/SKILL.md) is bundled and
registered through the native skill transform. Invoke it explicitly with
`@aorchestra-repo-context` or ask the agent to map/update repository documentation.

It reuses existing docs, starts with a short repo-map, adds architecture/domain/flow
detail only when useful and updates a bounded navigation block in AGENTS.md while
preserving authored rules. Its optional standard-library Python helper indexes
files/symbol candidates and checks source freshness and links. It is not Aider's
graph-ranking engine.

Existing context can be read when relevant; missing documentation leads to normal
code search. The skill has `autoinvoke: false` and the namespaced native ID
`aorchestra-repo-context`. Main-agent permissions allow only the bundle by default.
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
Costs are platform-counter estimates rather than provider invoices.

Repeated signals can produce evidence-linked hypotheses after three runs. This is
a review heuristic, not statistical significance or proof of strategy superiority.
The harness does not modify its own prompts or routing policy. The intended loop is
observation → hypothesis → matched-task replay → reviewed versioned change.

## Validation and evaluation

```sh
bun run typecheck
bun run test
python -m unittest discover -s tests -p '*_test.py'
bun run eval:check
bun scripts/version-check.ts
npm run pack:check
bun run check
```

The native smoke check requires the pinned OpenCode runtime. It uses a temporary
localhost server and isolated database under `work/runtime`, tests plugin/skill
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
`work/eval` (override with `--output-dir`). Independent assertions check behavior
and change scope. The small corpus is a smoke suite, not representative legacy
evidence. See [VALIDATION.md](../VALIDATION.md) before interpreting results.

## Limits

- Default budgets: eight delegations per primary session, two attempts per task,
  two repair cycles per task, ten minutes per delegation and 300k reported tokens per native session. These
  are safeguards, not measured optimal thresholds or a hard whole-ticket dollar cap.
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
