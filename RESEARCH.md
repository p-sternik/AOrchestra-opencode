# Sources and design decisions

Source review dated 2026-10-11. This is a review of specific implementations, not
a ranking of every harness in 2026 or a measured performance comparison.

| Project                      | Reviewed revision                                  | Scope                                                            |
| ---------------------------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| FoundationAgents/AOrchestra  | 14a1a2051d6b03c479b706f8f555a60b8419e3b5           | Orchestrator, delegation, SWE-bench executor, runner and prompts |
| SWE-agent/mini-swe-agent     | 04d809ceab9df28f9adaed044884180159172930           | Agent loop and configuration                                     |
| SWE-agent/SWE-agent          | 3ea751c087f32b16e039a2233dd6eefecef325d5           | Agent and default configuration                                  |
| OpenHands/software-agent-sdk | 4cc058275c5a08d845bd846576aafc80e5dd7d0d           | Persistent state and confirmation policy                         |
| OpenCode                     | 9b4ec5714d481559990db0a816d5dec19541a814 (v2.0.26) | Plugin loading, native sessions and API types                    |

## AOrchestra

The dynamic instruction/context/tools/model contract is the main architectural
inspiration. Native OpenCode child sessions implement the executor boundary here.
[Delegation source](https://github.com/FoundationAgents/AOrchestra/blob/14a1a2051d6b03c479b706f8f555a60b8419e3b5/aorchestra/tools/delegate.py).

In that revision, selected tools reach the GAIA/Terminal ReAct executor but not
the SWE-bench executor constructor. Delegation also makes a fixed Gemini summary
call after the runner returns its cost. That returned cost alone does not include
the summary. This adaptation uses explicit native permissions and omits the extra
summary model call.

The reference orchestrator owns its own model loop, JSON decisions and history.
Duplicating those in OpenCode would add another runtime. Our primary may execute
DIRECT work, whereas the reference focuses exclusively on orchestration.
[MainAgent](https://github.com/FoundationAgents/AOrchestra/blob/14a1a2051d6b03c479b706f8f555a60b8419e3b5/aorchestra/main_agent.py).

The publication also evaluates fine-tuning and cost-aware prompt optimization.
This repository implements metadata collection and review hypotheses, not those
learning procedures or their reported gains.
[Paper](https://arxiv.org/html/2602.03786v2).

## Other influences

- **mini-SWE:** simple direct execution, explicit budgets and preserving failed
  trajectories support using DIRECT as a real baseline and counting failures.
  [Agent](https://github.com/SWE-agent/mini-swe-agent/blob/04d809ceab9df28f9adaed044884180159172930/src/minisweagent/agents/default.py).
- **SWE-agent:** timeout, format, cost and context failures deserve separate
  treatment. Infrastructure retry differs from changing the attempted solution.
  [Agent](https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/sweagent/agent/agents.py).
- **OpenHands SDK:** persistent state and explicit confirmation policies inform
  interrupted-attempt recovery and separation of permissions from instructions.
  [State](https://github.com/OpenHands/software-agent-sdk/blob/4cc058275c5a08d845bd846576aafc80e5dd7d0d/openhands-sdk/openhands/sdk/conversation/state.py),
  [confirmation policy](https://github.com/OpenHands/software-agent-sdk/blob/4cc058275c5a08d845bd846576aafc80e5dd7d0d/openhands-sdk/openhands/sdk/security/confirmation_policy.py).
- **Aider:** selective repository context inspires the short map and on-demand
  detail. The Python helper does not reproduce Aider's symbol graph/ranking engine.
  [Repository map](https://aider.chat/docs/repomap.html).
- **Writing for agents:** concise steps, explicit completion criteria and
  progressive disclosure informed the bundled skill. This is a design influence,
  not a certification of compliance.
  [Matt Pocock's skills](https://github.com/mattpocock/skills).

These influences justify design choices; they do not prove performance transfer.
Compare DIRECT and selective routing on the same historical tasks/models, with
independent behavior/regression checks and whole-workflow cost measurements.

## Research interpretation and evidence boundaries

Reviewed publications support specific design hypotheses, not a universally optimal
harness or a measured benefit for this OpenCode adaptation:

- **CodeDelegator:** the 25.8% / 26.4% / 38.4% ReAct / CodeAct / CodeDelegator
  comparison is MCPMark pass@1 with DeepSeekV3.2, not a tau-squared-bench result.
  Its separate tau-squared-bench experiments and EPSS ablations motivate context
  separation; they do not establish our selective routing policy's effectiveness.
  [Paper, Tables 2–4](https://arxiv.org/html/2601.14914v1).
- **AOrchestra:** the reported 16.28% relative improvement uses Gemini-3-Flash
  across its evaluated benchmarks. Cost-aware ICL reduces average cost by 18.5%
  while increasing GAIA pass@1 by 3.03 percentage points. Those results concern
  the paper's policy and experiment, not this repository's tier configuration.
  [Paper](https://arxiv.org/html/2602.03786v2).
- **mini-SWE-agent:** approximately 100 lines describes the agent class, with
  additional environment, model and runner code. The project's reported >74%
  SWE-bench Verified score depends on its evaluated model/configuration; it is
  not proof that every simpler harness outperforms a richer one.
  [Author repository](https://github.com/SWE-agent/mini-swe-agent).

Workers cannot execute host shell commands, but this does not make editable tests
tamper-proof. Test changes can be legitimate task outputs and require primary diff
review. Independent diagnostic assertions remain runner-owned and outside the
worker's write scope. Snapshot-bound receipts establish freshness of observed
checks over measured sources, not test completeness, semantic correctness or
filesystem isolation. Untracked local DIRECT work uses ordinary native checks;
formal harness acceptance applies only to registered tasks. Full provider-backed
delegation and cost benefits still require the evidence described in
[VALIDATION.md](VALIDATION.md).

## OpenCode 2.0.26 compatibility

Configured local plugin paths must be directories. Relative paths resolve against
the profile; the entry directory exposes index.ts. Auto-discovery alone does not
provide the portable central-profile installation or its configured options.
[Source resolution](https://github.com/anomalyco/opencode/blob/v2.0.26/packages/core/src/config/plugin/source.ts),
[host resolution](https://github.com/anomalyco/opencode/blob/v2.0.26/packages/plugin/src/host.ts).

Native session.create permissions are used instead of newer interfaces absent
from the pinned package. Source/types and local integration checks take precedence
over documentation for a later version.

Runtime admission now accepts stable `>=2.0.26 <3.0.0` rather than requiring an
exact match with the pinned API packages. Keeping 2.0.26 as the minimum preserves
the observed baseline; excluding V3 avoids assuming compatibility across a major
API change. Native smoke checks passed on 2.0.26 and 2.0.27. Acceptance of another
V2 release by the version gate still requires native integration validation;
see [observed results and limits](VALIDATION.md#runtime-version-compatibility).

## Release automation

Release Please generates version/changelog PRs from Conventional Commits and
creates releases when those PRs merge. GITHUB_TOKEN-created PRs do not trigger
ordinary PR workflows, so our release workflow explicitly validates the generated
branch through the reusable validation workflow.
[Official action documentation](https://github.com/googleapis/release-please-action).

## Concurrent independent analyses

Read-only analysis contracts can share a source baseline because they have no
permitted writes. The v1 ledger therefore admits compatible analyses, bounded by
one running task per primary by default. Higher concurrency is explicitly enabled
after target-provider integration validation, while preserving exclusive change
and verification work through acceptance. Review keeps edit exclusion without
occupying a running slot. Dependencies and bounded contracts express independence;
semantic independence is not automatically inferred.

Group admission uses one ledger mutation and source snapshot, then reuses native
child lifecycle calls concurrently. No queue, parallel writer runtime or ledger
migration is introduced. Evidence, epochs, repairs and acceptance remain per task;
a sibling failure cannot revoke unrelated work. Owner recovery remains owner-wide.
Native permissions and snapshots are enforcement and freshness checks, not
filesystem isolation or cross-session workspace locks. Deterministic overlap and
no-inference native integration do not establish semantic effectiveness or cost
savings; see [validation limits](VALIDATION.md).
