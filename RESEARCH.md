# Sources and design decisions

Source review dated 2026-10-11. This is a review of specific implementations, not
a ranking of every harness in 2026 or a measured performance comparison.

| Project | Reviewed revision | Scope |
| --- | --- | --- |
| FoundationAgents/AOrchestra | 14a1a2051d6b03c479b706f8f555a60b8419e3b5 | Orchestrator, delegation, SWE-bench executor, runner and prompts |
| SWE-agent/mini-swe-agent | 04d809ceab9df28f9adaed044884180159172930 | Agent loop and configuration |
| SWE-agent/SWE-agent | 3ea751c087f32b16e039a2233dd6eefecef325d5 | Agent and default configuration |
| OpenHands/software-agent-sdk | 4cc058275c5a08d845bd846576aafc80e5dd7d0d | Persistent state and confirmation policy |
| OpenCode | 9b4ec5714d481559990db0a816d5dec19541a814 (v2.0.26) | Plugin loading, native sessions and API types |

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

## OpenCode 2.0.26 compatibility

Configured local plugin paths must be directories. Relative paths resolve against
the profile; the entry directory exposes index.ts. Auto-discovery alone does not
provide the portable central-profile installation or its configured options.
[Source resolution](https://github.com/anomalyco/opencode/blob/v2.0.26/packages/core/src/config/plugin/source.ts),
[host resolution](https://github.com/anomalyco/opencode/blob/v2.0.26/packages/plugin/src/host.ts).

Native session.create permissions are used instead of newer interfaces absent
from the pinned package. Source/types and local integration checks take precedence
over documentation for a later version.

## Release automation

Release Please generates version/changelog PRs from Conventional Commits and
creates releases when those PRs merge. GITHUB_TOKEN-created PRs do not trigger
ordinary PR workflows, so our release workflow explicitly validates the generated
branch through the reusable validation workflow.
[Official action documentation](https://github.com/googleapis/release-please-action).
