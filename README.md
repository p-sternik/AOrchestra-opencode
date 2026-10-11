# AOrchestra for OpenCode V2

[![Validate](https://github.com/p-sternik/AOrchestra-opencode/actions/workflows/validate.yml/badge.svg)](https://github.com/p-sternik/AOrchestra-opencode/actions/workflows/validate.yml)
[![Release](https://img.shields.io/github/v/release/p-sternik/AOrchestra-opencode)](https://github.com/p-sternik/AOrchestra-opencode/releases)

A small harness for brownfield and legacy work: one primary agent, selective
delegation, explicit change contracts and separate acceptance of the result.
Built against **OpenCode 2.0.26** using its native sessions, permissions, tools,
trajectories and plugin storage. Inspired by FoundationAgents/AOrchestra; this
repository is an independent adaptation, not a reproduction of its benchmarks.

The current baseline is **0.2.2**. See [CHANGELOG.md](CHANGELOG.md) for changes,
[VALIDATION.md](VALIDATION.md) for tested behavior and [RESEARCH.md](RESEARCH.md)
for sources and design decisions. Real-model effectiveness remains unmeasured.

## Install and run

Requirements: OpenCode **2.0.26**, Bun **1.2.15**, Node.js for independent evaluation
checks, and access to the models you configure. Python 3 is optional for the
repo-context helper and required for its development tests.

```sh
git clone https://github.com/p-sternik/AOrchestra-opencode.git
cd AOrchestra-opencode
git checkout 0.2.2
npm ci --ignore-scripts
bun run typecheck
bun run test
bun run eval:check
```

Edit `opencode.json`: set the primary `model` and the plugin's `models.fast`,
`models.balanced` and `models.strong` to provider/model identifiers available to
you. The supplied GitHub Copilot identifiers are example defaults inherited from
the original profile; their availability and pricing have not been verified.

Use the profile from the **target project's directory**. Paths inside the profile
resolve relative to its configuration file.

PowerShell:

```powershell
$env:OPENCODE_CONFIG = 'C:\tools\AOrchestra-opencode\opencode.json'
$env:OPENCODE_BIN = 'opencode2'
Set-Location 'C:\projects\your-project'
opencode2 run --standalone --agent aorchestra 'Fix the bug and verify compatibility'
```

Linux / WSL:

```sh
export OPENCODE_CONFIG=/absolute/path/AOrchestra-opencode/opencode.json
export OPENCODE_BIN=opencode2
cd /absolute/path/your-project
opencode2 run --standalone --agent aorchestra 'Fix the bug and verify compatibility'
```

If your V2 executable is named `opencode`, use that command and set
`OPENCODE_BIN=opencode`. Version checks validate the runtime version, not its name.
Copying or cloning this repository does not install a global profile. To make a
permanent installation, merge the configuration deliberately and remove duplicate
AOrchestra plugin registrations.

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

One portable [repo-context skill](skills/repo-context/SKILL.md) is bundled and
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

Opt-in real-model evaluation:

```sh
bun run eval:run -- --strategy=both --repeat=3
```

This runs paid/provider-backed inference on three fresh fixture workspaces under
`work/eval` (override with `--output-dir`). Independent assertions check behavior
and change scope. The small corpus is a smoke suite, not representative legacy
evidence. See [VALIDATION.md](VALIDATION.md) before interpreting results.

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

## Versioning

Use Conventional Commits: `fix:` for patch releases, `feat:` for minor releases and
`!`/`BREAKING CHANGE:` for incompatible changes. During 0.x, incompatible changes
bump the minor version. Release Please maintains a release PR with package/lockfile
versions and changelog; merging it creates a plain numeric tag and GitHub Release.
Telemetry reads the package version automatically. See [CONTRIBUTING.md](CONTRIBUTING.md).

Tags such as `0.2.2` are immutable snapshots; use GitHub comparisons to inspect
changes between releases. This private npm package is installed from source;
the workflow does not publish to npm.
