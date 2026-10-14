# Core orchestration audit and hardening

Audit date: 2026-10-14. The verdict is **structurally stronger, with model-dependent
routing and task effectiveness still unverified**. This audit inspected executable
implementations, added failing regressions, corrected six contract defects, and
executed native tools without model inference. It did not run a paid evaluation.
The subsequent [real-model validation](real-model-core-validation.md) records two
successful autonomous DIRECT runs and a timed-out delegation diagnostic; the
model-driven child execution gaps remain unverified.

## Examined revisions and evidence boundaries

| Source                  | Revision examined                                                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Research                | [arXiv 2602.03786v2, sections 3.1–3.3 and Appendix D](https://arxiv.org/html/2602.03786v2)                                                                            |
| Original implementation | [FoundationAgents/AOrchestra, 14a1a2051d6b03c479b706f8f555a60b8419e3b5](https://github.com/FoundationAgents/AOrchestra/tree/14a1a2051d6b03c479b706f8f555a60b8419e3b5) |
| Target baseline         | `cb753315265aa98685645f0aa702806b8ae42b4d`, plus the existing uncommitted workspace changes                                                                           |
| Installed API packages  | `@opencode/plugin` and `@opencode/client` 2.0.26; their installed declarations were inspected                                                                         |
| Pinned native source    | [OpenCode v2.0.26, 9b4ec5714d481559990db0a816d5dec19541a814](https://github.com/anomalyco/opencode/tree/9b4ec5714d481559990db0a816d5dec19541a814)                     |
| Executed native runtime | [OpenCode v2.0.28, 026b106bc5d41b679ffc413264229c340871e4d3](https://github.com/anomalyco/opencode/tree/026b106bc5d41b679ffc413264229c340871e4d3)                     |
| Writing guidance        | [writing-for-agents](https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md), retrieved on audit date                         |

The starting tracked diff was preserved in `/tmp/aorchestra-audit-start.patch`;
its SHA-256 is `066dab9913026305d1954cd885f3258736ff1d5a94bb4d74fcb0b9c87d6c70b5`.
It covered permissions, setup, instructions and native checking. Those changes
were retained. They are part of the examined workspace, not attributed to this audit.
The pre-existing untracked `lib/primary-permissions-v090.json` was also retained.
The paper HTML SHA-256 was
`be915285abdc8eea61b7a176b486228af3c6acdc45c77f55b96f54a49f19f6fd`;
the writing guidance SHA-256 was
`551adca942227b44192edba88acd4e8db911f0121ce58ad16944ccf6a896a74a`.
Remote main branches were not treated as immutable specifications.

The hardened target remains an uncommitted working tree. These SHA-256 hashes
identify the final executable audit files independently of a future commit:

```text
f0b30d051eedb4f921c2f0ead0f7003689ef0965b0457ba37dbaf791dc906ca8  lib/core.ts
511f39795fb188fd1a610eac25a81f2e8e58c0483b0477fa32f9a0e128f4f930  plugins/aorchestra.ts
ba20a86055a703ad9d916a634a280358e4f897f904b5fdd12ebed6c3ce7947be  scripts/core-check.ts
f2d1d2f2db94d3eb653e9afdc035fce046ac9662fa49dd5f20ca5c2d6efb62f9  tests/fixtures/core-probe/index.ts
063fbd408ae41230c3d3ed82363f201ed5429a859949b98b794a07beac4a92a5  tests/core.test.ts
f054eb316f05b2fb957aa42197a89d8cf9664df4c8dc94cc6f1bbc7b698950e9  tests/plugin.test.ts
```

Native tool registry, context selection, model resolution, grep and instruction
discovery sources were compared between 2.0.26 and 2.0.28. In that inspected set,
only model-request implementation changed: an HTTP import and propagation of
permission declines through Promise plugin wrappers. The native checks below
establish behavior on 2.0.28; this audit did not execute 2.0.26.

## Original observable architecture

The research defines working memory as I/C and capabilities as T/M. Section 3.1
allows a generic orchestrator to execute directly, but the specific AOrchestra
architecture in section 3.2 uses Delegate/Finish exclusively. Dynamically selecting
all four components and integrating returned observations are essential principles;
the benchmark executor classes and response formats are implementation choices.
[Research](https://arxiv.org/html/2602.03786v2#S3).

These inspected source files establish the reference execution path:

- [MainAgent](https://github.com/FoundationAgents/AOrchestra/blob/14a1a2051d6b03c479b706f8f555a60b8419e3b5/aorchestra/main_agent.py): `reset` obtains the user instruction and metadata; `step` builds a prompt from them, model aliases, tool descriptions, attempt limits and subtask history. The model emits an action and parameters. JSON parsing and tool lookup select the next call; an unknown action returns an error. Decomposition and tuple synthesis are model decisions, without a deterministic complexity classifier. `_update_context` records completion/issues and prepends observations for the next iteration.
- [DelegateTaskTool](https://github.com/FoundationAgents/AOrchestra/blob/14a1a2051d6b03c479b706f8f555a60b8419e3b5/aorchestra/tools/delegate.py): receives task instruction, selected model, optional context and tools. It resolves aliases against a configured list, instantiates the selected LLM and a fresh executor/memory, runs the benchmark runner, extracts a finish observation, summarizes the trajectory and restores the environment instruction in `finally`. Invalid models or execution exceptions return unsuccessful outcomes. The summary uses a fixed extra model; the target deliberately omits this call.
- [ReActAgent](https://github.com/FoundationAgents/AOrchestra/blob/14a1a2051d6b03c479b706f8f555a60b8419e3b5/aorchestra/subagents/react_agent.py): GAIA/Terminal executors combine task-specific I/C with generic execution guidance, the original question, environment observations and bounded memory. Selected tools filter action-space descriptions with fuzzy name matching. An empty selection leaves the full action space. This file does not enforce denial of arbitrary returned action names; description filtering alone is not a security boundary.
- [SWEBenchSubAgent](https://github.com/FoundationAgents/AOrchestra/blob/14a1a2051d6b03c479b706f8f555a60b8419e3b5/aorchestra/subagents/swebench_agent.py): specializes its prompt from the task, context, original question, action space and prior observations; parses DISCUSSION/COMMAND and finish output. The delegate constructor does not pass selected T into this executor. Tool selection therefore is not uniformly implemented across the reference benchmarks.
- [SWE runner](https://github.com/FoundationAgents/AOrchestra/blob/14a1a2051d6b03c479b706f8f555a60b8419e3b5/aorchestra/runners/swebench_runner.py), [Terminal runner](https://github.com/FoundationAgents/AOrchestra/blob/14a1a2051d6b03c479b706f8f555a60b8419e3b5/aorchestra/runners/terminalbench_runner.py), [GAIA runner](https://github.com/FoundationAgents/AOrchestra/blob/14a1a2051d6b03c479b706f8f555a60b8419e3b5/aorchestra/runners/gaia_runner.py): own iterative orchestration and bounded environment steps. Benchmark-specific submit/complete paths terminate work; SWE/Terminal can force submission at the attempt limit. A child finish report is distinct from benchmark evaluation.
- [SWE prompt](https://github.com/FoundationAgents/AOrchestra/blob/14a1a2051d6b03c479b706f8f555a60b8419e3b5/aorchestra/prompts/swebench.py) and [GAIA prompt](https://github.com/FoundationAgents/AOrchestra/blob/14a1a2051d6b03c479b706f8f555a60b8419e3b5/aorchestra/prompts/gaia.py): ask the main model to generate bounded instructions, selected context, model and tool parameters, and adapt subsequent delegation to observations. Model aliases/pricing influence selection; they do not establish measured task suitability.

Thus the original is a fixed orchestrator/executor implementation whose _instances_
are specialized by runtime tuples. A fixed implementation class does not make an
instance a static specialist. Neither reference model availability at providers,
optimal selection, nor successful benchmark reproduction was tested here: UNKNOWN.
Training and cost-aware optimization discussed in section 3.3 were not reproduced.

## Target execution map

The entry point is [`plugins/aorchestra.ts`](../plugins/aorchestra.ts), `Plugin.define/setup`.
The native primary uses [`instructions/aorchestra.md`](../instructions/aorchestra.md).
The native executor has shared guardrails in
[`instructions/aorchestra-executor.md`](../instructions/aorchestra-executor.md),
then receives a new task-specific contract. Native loop ownership is preserved.

| Stage                           | Executable behavior and entry point                                                                                                                                                       | Evidence                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| User → primary                  | OpenCode selects configured agent/model and discovers project instructions; plugin context hook adds current worker-tier availability                                                     | Native agent/session loading; source inspection; controlled primary context hooks                  |
| DIRECT decision                 | Primary chooses native leaf tools under its instructions; no deterministic DIRECT classifier or mandatory delegation                                                                      | Native DIRECT fixture; routing admissibility matrix; model choice UNKNOWN                          |
| DIRECT execution                | Untracked work uses native policy; tracked work registers/starts through `aorchestra_task`, records a baseline, narrows edits and collects native verifier outcomes                       | Native edit/read/accept cycle; existing DIRECT acceptance/repair regressions                       |
| DELEGATE decision/decomposition | Primary supplies registered task, dependencies, handoff, tools, tier and routing evidence                                                                                                 | Controlled callers; usefulness of model-generated choices UNKNOWN                                  |
| Tuple admission                 | `registerTask`, `validateHandoff`, `validateTools`, `reserve`; plugin checks direct-callable registration, catalog model/variant/tools support and prompt bound before atomic reservation | Deterministic rejection tests; native unavailable-model rejection                                  |
| Native child                    | `ctx.session.create` with fresh parent-owned executor, selected model ref, location and deny-first `permissionRules`; durable child contract                                              | Native persisted parent/model/permissions; controlled full delegate flow                           |
| Prompt/context                  | Synthesized objective, selected context, sources/facts/unknowns/checks, snapshot, dependencies, preservation/scope/tools/verifiers and retry delta → `ctx.session.prompt`                 | Controlled exact-delivery tests; actual model-facing delivery UNKNOWN                              |
| Model execution                 | Native resolver selects the explicit catalog model; context hook removes non-selected tools and rejects missing effective selected tools                                                  | Installed types/native source; native persisted ref; no successful inference request               |
| Child tools                     | Native permissions + active-contract hooks; grep wrapper checks returned paths before delivery                                                                                            | Real native read/edit/grep and forbidden-operation checks; controlled context filtering            |
| Wait/cancel/error               | Timeout and parent signal race native wait; interruption, inactive contracts, dependency revocation and unknown outcomes prevent review                                                   | Controlled cancellation/recovery/late-result regressions; successful provider cancellation UNKNOWN |
| Result                          | `parseResult` validates STATUS/RESULT/EVIDENCE/CHANGED/OPEN; runtime must succeed; child report remains `accepted:false`                                                                  | Controlled child responses and failures                                                            |
| Continuation/acceptance         | Primary receives tool result, runs pending native checks, reviews compatibility and explicitly accepts; receipts bind before/after source snapshots and epochs                            | Native DIRECT acceptance; controlled delegated acceptance/revocation                               |

Native authority inspected:
[context selection](https://github.com/anomalyco/opencode/blob/026b106bc5d41b679ffc413264229c340871e4d3/packages/core/src/session/context.ts),
[model resolution](https://github.com/anomalyco/opencode/blob/026b106bc5d41b679ffc413264229c340871e4d3/packages/core/src/session/runner/model.ts),
[model request](https://github.com/anomalyco/opencode/blob/026b106bc5d41b679ffc413264229c340871e4d3/packages/core/src/session/model-request.ts),
[tool registry](https://github.com/anomalyco/opencode/blob/026b106bc5d41b679ffc413264229c340871e4d3/packages/core/src/tool.ts).

Native context selection merges agent/session permissions before discovery. Tools
whose `codemode` option is absent/true appear only through `execute`, rather than
as leaf definitions. The target now admits only direct-callable worker tools.
Native explicit-model resolution fails when the selected catalog model disappears;
there is no implicit replacement with another worker tier.

## Architecture comparison

PASS below applies to the named tested invariant, never to unmeasured effectiveness.
PARTIAL means a tested mechanism has a remaining execution or semantic gap.

| Component       | Research intent                              | Original behavior                                    | Current behavior                                                                                           | Verdict                                                                |
| --------------- | -------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| DIRECT/DELEGATE | Specific research system delegates execution | Main emits delegate/submit/complete                  | DIRECT is first-class; primary chooses strategy; native direct cycle works                                 | PARTIAL: intentional adaptation; model choice unverified               |
| Routing         | Task-specific capability allocation          | Model prompt plus aliases/configured model list      | Instructions guide choice; executable dependency/tier/tool/budget gates; live tier catalog disclosed       | UNVERIFIED: useful task selection                                      |
| Model           | Runtime M selection                          | Selected LLM instance; aliases checked               | Catalog/variant/tool capability checked; ref reaches native session; runtime failure explicit              | PARTIAL: actual inference dispatch unverified                          |
| Tools           | Task-specific T                              | ReAct descriptions filtered; SWE constructor omits T | Deny-first native rules, direct leaf selection, scoped edits, sensitive-search checks                      | PASS: tested native leaf permissions; arbitrary tools not certified    |
| Instructions    | Objective and success criteria               | Generated task I plus executor templates             | Runtime objective, preserve/scope/verifiers/dependencies/delta plus shared guardrails                      | PARTIAL: exact serialization tested; adequacy unverified               |
| Context         | Curated task-relevant C                      | Selected C, original goal and executor observations  | Bounded handoff/provenance/unknowns, selected context, native project instructions and permitted retrieval | PARTIAL: transport tested; sufficiency/factual provenance unverified   |
| Execution       | Fresh instantiated executor                  | New ReAct/SWE instance, benchmark loop               | New native session; native leaf execution observed; controlled lifecycle                                   | PARTIAL: successful model-driven child unverified                      |
| Result handling | Structured observation informs next decision | Finish/summary/history; benchmark submission         | Structured report, runtime gate, fresh receipts, primary compatibility acceptance                          | PASS: protocol/acceptance invariants; semantic continuation unverified |

## Routing scenario evidence

[`routing scenario matrix`](../tests/plugin.test.ts) executes these ten distinct
contract admissions. Recommendations are scenario annotations supplied by the
caller, not observed model decisions. The executable policy returns admission or
an exact error; it does **not** infer complexity from the description. Every row's
actual **model strategy choice is UNVERIFIED**, because inference was not authorized.
This separates policy defects from reasonable model judgment.

| Scenario                                  | Expected useful strategy                        | Actual deterministic result                                            | Outcome/evidence                                                                     |
| ----------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Trivial local change                      | DIRECT                                          | Explicit delegation remains permitted                                  | Unaccepted report; native trivial DIRECT edit/read/accept separately passes          |
| Straightforward single-file bug           | DIRECT                                          | Explicit delegation remains permitted                                  | Admission passes; task-level model fix not executed                                  |
| Read-only repository investigation        | DELEGATE when separation helps                  | Lookup + fast + read admitted without writes                           | Unaccepted read-only report                                                          |
| Complex change, independent investigation | DELEGATE investigation                          | Independent analysis admitted                                          | Controlled separate contract; no model judgment claim                                |
| Tightly coupled edits                     | DIRECT                                          | Single explicit delegate admitted; concurrent changes excluded         | Exclusivity regressions; semantic coupling remains primary responsibility            |
| Context unavailable to proposed child     | DIRECT/retrieve or BLOCKED                      | Missing handoff rejected: `HANDOFF_REQUIRED`                           | No child/budget; populated but insufficient context cannot be inferred automatically |
| Ordered dependencies                      | WAIT, then execute in order                     | `DEPENDENCY_UNMET` until prerequisite acceptance                       | No child; existing dependency/late-revocation regressions                            |
| Unavailable M/T                           | DIRECT with capabilities or BLOCKED             | `MODEL_UNAVAILABLE` / `TOOL_UNAVAILABLE`; Code Mode-only tool rejected | No child/budget; native missing-model admission also passes                          |
| Failed delegation                         | Inspect, repair/retry or escalate with evidence | `RUNTIME_FAILED`, blocked/error attempt                                | No successful report; retry/delta/tier and repair tests                              |
| Complex wording, localized implementation | DIRECT                                          | Wording does not trigger forced delegation                             | Explicit bounded delegation admitted; usefulness remains model-dependent             |

The system intentionally permits delegation even in a DIRECT-preferred scenario.
A nonempty routing reason is not a semantic proof of benefit. User constraints,
complexity, missing context, overhead and specialization are instruction-guided;
accepted dependencies, readonly scope, selected capabilities, budgets, tier
restrictions and retry deltas are executable policy. No learned classifier,
automatic cost optimizer or numeric overhead estimator is present.

## M/T/I/C consistency and context scenarios

M checks current catalog identity, variant and declared tool capability before
reservation. Malformed/null/unknown tier configuration fails explicitly; missing
keys retain documented defaults. Equal tier references remain valid but provide
no measured escalation. Catalog availability cannot prove credentials, quota,
endpoint health, supported context size or model optimality. Native failures remain
failures. The selected model ref is persisted in the native child; a successful
request to that provider was not observed.

T admits the exact registered leaf tools and native edit paths. Workers have no
shell; instructions explicitly assign shell checks to the primary. A child's own
build/test requirement cannot be fulfilled by escalating M: the child must leave
it OPEN. Read-only analyses cannot edit or acquire arbitrary MCP mutations.
Nested delegation, shell, Code Mode and inactive-contract access are rejected.
Native tool availability can differ from the global catalog; the context hook now
rejects a selected tool absent from the effective request. Custom tool internals
and permissions remain a trust boundary; this is not filesystem isolation.

I has defined sources: task.instruction supplies the objective/actions/deliverable;
task.preserve supplies compatibility constraints; native instruction discovery
supplies project conventions; writePaths/tools supply access bounds; dependsOn
supplies accepted prerequisite IDs; verifiers supply executable completion checks;
handoff supplies known/unknown requirements; delta supplies changed retry evidence.
The executor base prompt supplies completion/failure reporting. Required actions
remain free text, and no parser proves that they are complete or consistent. Empty
instructions, unusable handoffs, malformed reports and contradictory COMPLETE
reports are rejected. The full composed prompt is capped at 48,000 characters
before reservation, without truncating preservation requirements.

C distinguishes five stages:

1. Available: parent history, repository, instructions and permitted external sources.
2. Selected: the primary's task.context and handoff; full parent history is not copied.
3. Serialized: labeled context/handoff, revision declarations, snapshot and constraints.
4. Delivered: the exact text supplied to native `session.prompt`; controlled tests inspect it.
5. Retrievable: native read/search capabilities inside the project and selected web tools.

`brownfield context handoffs` tests localized bug/regression references, cross-module
consumers, undocumented legacy conventions, monorepo consumers, AGENTS.md references,
18,000-character context, missing/stale references, conflicting facts, read-only
investigation and follow-up retry handoffs. Required text and provenance labels
survive serialization without omission. These are **transport tests**, not successful
repository tasks. Sources can be candidates with unknown revisions; the source
fingerprint does not authenticate the supplied facts. A missing file or factual
conflict remains an explicit supplied unknown, not an automatically verified claim.
No semantic relevance engine or automatic dependency-result inclusion is implemented.
The primary must refresh the handoff after earlier child observations.

Cross-component checks reject unavailable models/variants/tool support, unavailable
or Code Mode-only tools, write tools on analyses, invalid scope, missing handoff,
oversized composed prompts, missing effective request tools, malformed/incomplete
reports, unsuccessful/unknown runtime outcomes and cancelled/stale attempts. Tool
requirements or inaccessible file references embedded in arbitrary prose cannot
be reliably inferred. A native child can retrieve repo-wide nonsensitive sources
when read is selected; an inaccessible external source must be supplied as context
or reported as a blocker. Repository conflicts and unsupported factual claims
remain primary review responsibilities. A worker's confidence cannot itself grant
acceptance: observed primary verifiers and compatibility review are still required.

## Verified findings and corrections

No reproduced CRITICAL defect was found. Fixes retain the native runtime and public
task/delegation interfaces. Each finding had a failing regression before its fix.

| Finding                                                             | Reproduction, root cause and impact                                                                                                                                                                                                                                                                                                         | Smallest correction and regression                                                                                                                                                                                                                          | Remaining uncertainty                                                                                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HIGH F1: ineffective T admitted                                     | A change task selects a catalog tool marked `codemode:true`; admission succeeds, but native registry exposes it only through denied `execute`. `validateTools` also allowed executable wrapper names when catalogued. Child can receive unusable nominal T. Research principle: selected capabilities must be executable.                   | Plugin admission rejects non-leaf registrations; core rejects `execute`/`opencode`. Tests: `worker tools only callable through Code Mode`, expanded worker-denial test.                                                                                     | Native real-model request tool composition unobserved; arbitrary custom tools are not certified. Raw HTTP through Code Mode is excluded rather than claimed isolated.             |
| HIGH F2: sensitive grep output bypasses read rules                  | Native grep authorizes action `grep` against pattern, not per-match read paths; native ripgrep uses `--hidden`. A directory search returns a fake `.env` marker despite read-deny rules. Research principle: effective T boundary.                                                                                                          | Wrap existing grep leaf, validate structured match paths before returning; reject sensitive/outside search roots before dispatch. Tests: `native grep cannot deliver sensitive matches`; real native fixture search rejection.                              | Search still scans locally before output rejection. It is output protection, not per-file search isolation. Transient symlink races/external mutations remain native limitations. |
| HIGH F3: late/unknown execution can enter review                    | Synthetic child has an unknown outcome or parent cancellation after wait while context/get ignore cancellation. Old code only rejects failed/interrupted outcomes and lacks a final signal check. Invalidated work can return a usable-looking report. Research principle: unsuccessful execution must not become a successful observation. | Require native succeeded outcome and check cancellation after context retrieval and at final ledger entry. Test: `unknown runtime outcome and cancellation after wait`.                                                                                     | Real provider/transport interruption and hanging create/prompt/interrupt operations untested; timeout races native wait, not every API.                                           |
| MEDIUM F4: invalid M spends an attempt                              | Syntax-valid missing model/variant is admitted and reserves budget before native failure; malformed/null overrides can silently use defaults or throw late. Research principle: coherent executable M.                                                                                                                                      | Validate override shape/ref syntax; sample native catalog before reservation; validate variant and tool capability; disclose tier availability to primary. Tests: unavailable model/variant and configuration/capability cases; native admission rejection. | Catalog is not provider health; disappearance after admission still fails natively. No capability/performance ranking evidence.                                                   |
| MEDIUM F5: globally present tool missing in effective child request | Controlled context removes selected read while durable contract still says read; old hook proceeds with no tool. Research principle: T actually reaches execution.                                                                                                                                                                          | Reject missing selected native definitions before generation. Test: `a registered tool removed from native child context`.                                                                                                                                  | Other plugins may transform tools later; successful provider request not tested.                                                                                                  |
| MEDIUM F6: composed prompt has no total bound                       | Individual I/C/handoff bounds leave preserve/verifier values unbounded. A 50k-character preservation field is sent to the child. Research principle: bounded task-sufficient I/C.                                                                                                                                                           | Serialize before admission; reject total prompt >48k characters atomically. Test: `oversized composed instructions`.                                                                                                                                        | Character bound is not a token/context-window guarantee; native project/system instructions add context.                                                                          |

Changed audit files:

- [`lib/core.ts`](../lib/core.ts): reject worker execution wrappers; preserve dependency, ledger, epoch and exact-path mechanisms.
- [`plugins/aorchestra.ts`](../plugins/aorchestra.ts): correct M/T admission, sensitive-search output handling, composed-prompt bound and terminal cancellation/outcome gates. Accepted dependency IDs are now explicit in the child prompt. Existing native model refs, session permissions, readonly concurrency, ownership and acceptance are retained.
- [`tests/core.test.ts`](../tests/core.test.ts), [`tests/plugin.test.ts`](../tests/plugin.test.ts): regressions, capability/configuration cases and routing/context contract matrices. Existing tests' synthetic native catalog now specifies direct-callable tools.
- [`scripts/core-check.ts`](../scripts/core-check.ts), [`tests/fixtures/core-probe/index.ts`](../tests/fixtures/core-probe/index.ts): development-only native no-inference leaf execution fixture; private server/database/project, fake sensitive marker and explicit callback-driving disclosure. No production RPC is introduced.
- This report, [`reference.md`](reference.md), [`VALIDATION.md`](../VALIDATION.md): observable behavior and limits. No telemetry, installation, dashboard or routing runtime layer added.

## Validation

Commands used Bun 1.2.15 from a temporary tool directory because Bun was absent
from PATH; Node/npm were available through Volta. The executed native binary
reported `opencode v2.0.28`. All checks used the preserved existing workspace changes.

| Exact check                                                                                                 | Evidence category                                             | Observed result                                                            |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `bun run test` before changes                                                                               | Controlled unit/hook tests                                    | 207 passed, 0 failed                                                       |
| `bun test tests/core.test.ts tests/plugin.test.ts` after initial regressions, before fixes                  | Controlled reproduction                                       | 4 failures: unavailable M, grep boundary, Code Mode-only T, wrapper denial |
| `bun test tests/plugin.test.ts -t 'unknown runtime outcome'` before lifecycle fix                           | Controlled reproduction                                       | Unknown native outcome incorrectly returned review                         |
| `bun test tests/plugin.test.ts -t 'removed from native\|oversized composed'` before bounds/availability fix | Controlled reproduction                                       | 2 failures: missing effective T, unbounded composed prompt                 |
| `bun test tests/core.test.ts tests/plugin.test.ts` after corrections                                        | Controlled structural/contract tests                          | 85 passed, 0 failed                                                        |
| `bun run typecheck`                                                                                         | Installed pinned API declarations                             | Passed                                                                     |
| `bun run format:check`                                                                                      | Repository formatting                                         | Passed                                                                     |
| `bun run test` after corrections                                                                            | Full controlled suite                                         | 216 passed, 0 failed; 1,580 assertions                                     |
| `bun run eval:check`                                                                                        | Existing corpus integrity; no model invocation                | Passed                                                                     |
| `python3 -m unittest discover -s tests -p '*_test.py'`                                                      | Existing helper/workflow checks                               | 29 passed                                                                  |
| `bun scripts/version-check.ts`                                                                              | Version consistency                                           | Passed                                                                     |
| `npm run pack:check`                                                                                        | Real archive and production consumer                          | Passed                                                                     |
| `bun run check`                                                                                             | Native no-inference smoke                                     | Passed on 2.0.28; `modelCalls: 0`                                          |
| `bun scripts/core-check.ts`                                                                                 | Real native leaf execution, manually driven harness callbacks | Passed on 2.0.28; `modelCalls: 0`                                          |
| Provider-backed DIRECT/DELEGATE tasks                                                                       | Real inference/effectiveness                                  | NOT RUN; explicit authorization required                                   |

The native core fixture executes an actual edit/read predicate/acceptance cycle,
creates a parent-owned child with persisted selected model/permissions, executes
actual child read/edit/grep leaves, and rejects outside-scope edits, sensitive reads
and grep output, shell, nested delegation and inactive contracts. It also invokes
the real registered delegate tool with an unavailable model and verifies zero
reservations. Tool boundary callbacks are called by the fixture, rather than
by a model-generated tool call; child creation for leaf testing is also explicit.
This fixture does **not** exercise a successful native delegate prompt/wait/result
cycle. The existing smoke likewise creates native children without successful
inference. Neither may be presented as provider-backed end-to-end delegation.

## Remaining gaps and final assessment

1. **Is DIRECT/DELEGATE selection correct? PARTIAL.** Native DIRECT works and delegation is optional. Admission is deterministic and tested; whether the primary chooses usefully is UNVERIFIED.
2. **Does routing reflect actual task requirements? PARTIAL.** Task fields, dependencies, current catalog, selected tools and retry history affect executable admission. Semantic suitability/overhead remain model instructions, without observed decisions.
3. **Are M/T/I/C independently and dynamically composed? YES, structurally.** Each native child gets independently chosen model/tools and task-specific instruction/context inputs; controlled payload tests and native session configuration support this. Coherent semantics remain PARTIAL.
4. **Does OpenCode execute the contract as intended? PARTIAL.** Native leaf capability enforcement and a DIRECT acceptance cycle pass. Successful model dispatch, child prompt execution and primary continuation are UNVERIFIED.
5. **Are instructions sufficiently task-specific? PARTIAL.** Objective, compatibility, scope, dependencies, evidence and retry constraints have observable sources and representation. Model comprehension/completion on actual tasks is UNVERIFIED.
6. **Is context adequate for brownfield/monorepos? UNVERIFIED.** Consumer/provenance/unknown transport passes; relevance, freshness of supplied facts and task sufficiency need real repository tasks. Native AGENTS discovery is source-inspected, not measured in a successful model request.
7. **What research mechanisms are absent/altered?** Pure orchestrator-only execution is replaced with optional DIRECT. No reference benchmark executor/runtime, fuzzy tool filtering, extra fixed-model summary, learned orchestrator or cost-aware optimizer is reproduced. T is more strictly enforced here; tier capability claims remain heuristics.
8. **Which adaptations are justified?** Native sessions/model dispatch/permissions/storage avoid duplicating OpenCode's runtime. DIRECT keeps cohesive edit/test reasoning with the shell-capable primary. Exact scopes, observed acceptance and removing the extra summary call simplify execution and strengthen tested controls. No savings claim follows without measurements.
9. **Which foundational issues remain?** Semantic task decomposition, mutually consistent free-text contracts, source factual provenance, actual provider/tool request composition, project-instruction conflicts, context-window limits and transport cancellation reliability remain unproven. Shared workspace and external writers are not isolated; unrestricted trusted primary shell scripts can mutate it. Timeout bounds native wait but relies on cancellation support in other API calls. Default operation counts are unlimited; only configured budgets bound retries. These are explicit limits, not claims of verified safety.
10. **Reliable enough for further optimization?** Reliable enough to begin explicitly authorized native task validation. Not enough evidence to justify routing/model/cost optimization or architectural expansion. First observe representative DIRECT and DELEGATE successes/failures on identical revisions, models and independent acceptance checks; retain these fixes and the simple native harness.
