# AOrchestra for OpenCode V2

[![Validate](https://github.com/p-sternik/AOrchestra-opencode/actions/workflows/validate.yml/badge.svg)](https://github.com/p-sternik/AOrchestra-opencode/actions/workflows/validate.yml)
[![Release](https://img.shields.io/github/v/release/p-sternik/AOrchestra-opencode)](https://github.com/p-sternik/AOrchestra-opencode/releases)
[![Tested OpenCode](https://img.shields.io/badge/tested_OpenCode-2.0.26-blue)](VALIDATION.md)

**An OpenCode harness for working on existing codebases.** One main agent owns the
task, works directly when it makes sense, and delegates bounded work when useful.
It favors existing patterns, small patches and compatibility checks.

Inspired by [FoundationAgents/AOrchestra](https://github.com/FoundationAgents/AOrchestra),
adapted to native OpenCode V2 sessions and permissions.

## Why use it?

- **Work with the code you already have.** Find existing implementations and tests
  before adding new abstractions or rewriting modules.
- **Delegate selectively.** Keep related diagnosis, editing and testing together;
  hand off work with a clear scope and relevant context.
- **Check the result.** Tracked changes require current verification evidence and
  a compatibility review before acceptance.
- **Learn from actual runs.** Local metrics and on-demand reports reveal recurring
  problems without an extra model call after every task.

> **Status:** early-stage, tested with OpenCode **2.0.26**. Mechanism tests and CI
> pass; effectiveness and cost on representative legacy tasks remain unmeasured.
> See [validation results](VALIDATION.md).

## How it works

```mermaid
flowchart LR
    Request[Your task] --> Main[Main agent]
    Main -->|Work directly| Direct[Native OpenCode tools]
    Main -->|Delegate when useful| Worker[Scoped child session]
    Direct --> Check[Main agent checks the result]
    Worker --> Check
    Check --> Result[Result and verification evidence]
```

Delegated work receives a task-specific instruction, context, tool set and model.
The main agent owns the outcome; tracked-task acceptance is separate from a
worker's completion report.

## Quick start

### 1. Check the prerequisites

You need **OpenCode V2 2.0.26**, **Bun 1.2.15**, **Git**, **Node.js/npm**, and an
authenticated model provider in OpenCode. CI uses Node.js 22.

This guide uses `opencode2` as the V2 command. If yours is named `opencode`, replace
`opencode2` below and set `OPENCODE_BIN=opencode` when using the supplied scripts.
Check that the command reports **2.0.26**:

```sh
opencode2 --version
bun --version
```

Python 3 is optional: only the repository-context helper and its development tests
need it. You can run the harness without Python.

### 2. Download the stable version

```sh
git clone --branch 0.2.2 https://github.com/p-sternik/AOrchestra-opencode.git
cd AOrchestra-opencode
npm ci --ignore-scripts
```

This checks out the published `0.2.2` release. Cloning does not change your global
OpenCode configuration. If you prefer a ZIP, download the source archive from
[GitHub Releases](https://github.com/p-sternik/AOrchestra-opencode/releases), extract
it, open a terminal in the extracted folder and run `npm ci --ignore-scripts`.

### 3. Choose your models

Open `opencode.json` in your editor. Replace these values with models available
through your OpenCode provider:

| Setting | Used for |
| --- | --- |
| Top-level `model` | Main agent |
| Plugin options → `models.fast` | Lightweight delegated work |
| Plugin options → `models.balanced` | General delegated work |
| Plugin options → `models.strong` | More demanding delegated work |

Use the `provider/model` identifiers shown by your OpenCode setup. The supplied
GitHub Copilot values are example defaults; their availability is not guaranteed.

### 4. Run a task in your project

Run the following **from the harness folder**. Change the project path and task
description to match your work. The configuration path is captured before moving
to your project, so you do not need to enter the harness path manually.

**Windows — PowerShell**

```powershell
$env:OPENCODE_CONFIG = (Resolve-Path .\opencode.json).Path
$env:OPENCODE_BIN = 'opencode2'
Set-Location 'C:\projects\your-project'
opencode2 run --standalone --agent aorchestra 'Fix the failing test. Preserve existing behavior and verify the change.'
```

**Linux / macOS / WSL — shell**

```sh
export OPENCODE_CONFIG="$(pwd)/opencode.json"
export OPENCODE_BIN=opencode2
cd /absolute/path/to/your-project
opencode2 run --standalone --agent aorchestra 'Fix the failing test. Preserve existing behavior and verify the change.'
```

The same terminal keeps the selected profile for subsequent tasks. OpenCode's
configured permissions still apply, including requests to run shell commands.

**Optional installation check:** from the harness folder, run `bun run check`.
It checks native plugin loading using an isolated test database and makes no
external model calls.

## Everyday use

Describe the outcome you want. You do not need to manually create subagents or
task contracts:

```sh
opencode2 run --standalone --agent aorchestra 'Fix the missing-user error. Keep the public API unchanged and add a regression test.'
```

For an unfamiliar repository, explicitly request a context map:

```sh
opencode2 run --standalone --agent aorchestra 'Use repo-context to map this repository and update AGENTS.md with concise navigation. Write the documentation in English.'
```

The bundled skill reuses existing documentation and preserves authored AGENTS.md
rules. It runs on request; ordinary coding does not require a documentation phase.

To review execution metrics, return to the harness folder:

```sh
bun run report -- --project=/absolute/path/to/your-project --output=work/report.md
```

Reports make no model calls and do not change the harness policy. Costs are
estimates; runtime completion alone does not establish semantic correctness.

## Things to know

- Workers have scoped tools and edit paths. The main agent runs tests. Permissions
  are not an operating-system sandbox, and failed changes are not automatically reverted.
- Large repositories may need configuration: whole-tree snapshots have size limits
  and exclude some paths, including root `build` and `dist` directories.
- This profile enables only the bundled `repo-context` skill. Existing repository
  AGENTS.md instructions still apply.

See the [technical reference](docs/reference.md) for task contracts, budgets,
snapshot exclusions, telemetry and evaluation commands.

## Design sources and evidence

The original architectural source is **AOrchestra: Automating Sub-Agent Creation
for Agentic Orchestration**, by Jianhao Ruan et al. (2026):
[paper, arXiv v2](https://arxiv.org/abs/2602.03786v2) ·
[reference implementation](https://github.com/FoundationAgents/AOrchestra).
Its instruction/context/tools/model abstraction informs our dynamic delegation.
This repository is an independent OpenCode adaptation and is not affiliated with
the original authors.

| Basis | What it supports here |
| --- | --- |
| AOrchestra paper and pinned source review | Dynamic agent contracts; architectural inspiration |
| Reviews of mini-SWE, SWE-agent, OpenHands and Aider | Design choices around simplicity, recovery, verification and selective context |
| Local tests and Windows/Linux CI | 39 harness tests and 13 repository-context helper tests |
| Native OpenCode 2.0.26 smoke check | Plugin/session loading and controlled failure telemetry, with no model calls |

Published AOrchestra benchmark results describe the original system, not this
adaptation. Our three evaluation fixtures are a smoke corpus; representative
real-model brownfield effectiveness and cost have not yet been measured. We do
not implement the paper's learned routing or fine-tuning procedures.

Reviewed revisions and the reasoning behind each adaptation are recorded in
[RESEARCH.md](RESEARCH.md); test coverage and remaining gaps are in
[VALIDATION.md](VALIDATION.md). The release badge above links to the latest
published harness version; the OpenCode badge names the tested runtime version.

## Documentation and help

| Looking for | Read |
| --- | --- |
| Architecture, configuration and limits | [Technical reference](docs/reference.md) |
| What has been tested | [Validation](VALIDATION.md) |
| Research and design decisions | [Research](RESEARCH.md) |
| Changes between versions | [Changelog](CHANGELOG.md) |
| Development checks and automatic releases | [Contributing](CONTRIBUTING.md) |

Maintained by [Piotr Sternik](https://github.com/p-sternik). For bugs or questions,
[open an issue](https://github.com/p-sternik/AOrchestra-opencode/issues) with your
harness version, OpenCode version, operating system and a minimal reproduction.

Future versions are prepared automatically from Conventional Commits; merging the
release PR publishes the tag and GitHub Release. Use a release tag for reproducible
installation. This repository is installed from source and is not published to npm.
