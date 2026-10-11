# Technical reference

For installation and everyday use, start with the [README](../README.md).

## Global installation

Discover the active global directory with `opencode2 debug paths`, checking
`OPENCODE_CONFIG_DIR` and the loaded config sources as described in the
[setup guide](setup-for-agents.md). Merge the template into the existing global
opencode.json/jsonc, preserving unrelated settings and JSONC comments. Use absolute
plugin directory and instruction paths pointing to the permanent harness checkout.
Normal use requires no project config or OPENCODE_CONFIG override. Project-local
config can still override global settings.

## How it works

The primary performs cohesive investigation/edit/test work directly. It delegates
settled, bounded changes or independent analysis when the separation is useful.
Each delegation builds an instruction/context/tools/model contract for a fresh
native child session. There is no additional agent runtime or mandatory planner,
reviewer or model-powered summarizer.

- `aorchestra_task` registers tasks, dependencies, exact write paths, compatibility
  constraints and verifiers; starts, accepts, invalidates or recovers work.
- `aorchestra_delegate` executes a registered contract with an explicit model tier,
  routing reason and, on retry, a description of what changed.
- A worker's completion report is separate from acceptance. Acceptance requires
  current observed verifier results, changes within the tracked scope and the
  primary's explicit compatibility review.

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

## Repository context

One portable [repo-context skill](../skills/repo-context/SKILL.md) is bundled and
registered through the native skill transform. Invoke it explicitly with
`@repo-context` or ask the agent to map/update repository documentation.

It reuses existing docs, starts with a short repo-map, adds architecture/domain/flow
detail only when useful and updates a bounded navigation block in AGENTS.md while
preserving authored rules. Its optional standard-library Python helper indexes
files/symbol candidates and checks source freshness and links. It is not Aider's
graph-ranking engine.

Existing context can be read when relevant; missing documentation leads to normal
code search. The skill has `autoinvoke: false`. This supplied profile disables the
global skill-discovery plugin and allows only the bundled skill. Repository
AGENTS.md instructions still apply; other profiles remain independently configured.

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
  ten minutes per delegation and 300k reported tokens per native session. These
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
