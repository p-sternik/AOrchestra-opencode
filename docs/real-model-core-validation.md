# Real-model core validation

Date: 2026-10-14. **Overall: PARTIAL.** Two autonomous SELECTIVE runs chose
DIRECT and passed independent acceptance. The authorized delegation diagnostic
timed out before any delegation call. Successful model-driven child composition,
execution and parent continuation remain **UNVERIFIED**. No routing or production
orchestration code was changed.

## Readiness and authorization

The six audit implementation/test files match the SHA-256 hashes in the
[core audit](core-orchestration-audit.md). All existing working-tree changes were
preserved. Target revision: `cb753315265aa98685645f0aa702806b8ae42b4d`, with the
existing dirty tree. Installed plugin/client API packages: 2.0.26. Executed native
runtime: **OpenCode 2.0.28**.

Checks performed before inference:

- `bun test tests/core.test.ts tests/plugin.test.ts tests/eval.test.ts tests/eval-corpus.test.ts`: **115 passed, 0 failed; 862 assertions**.
- `bun run typecheck` and `bun run eval:check`: passed.
- `bun scripts/core-check.ts`: passed; zero model calls, including invalid-model rejection before reservation and actual forbidden native tool operations.
- Native catalog inspection in both a fresh database and the default database: configured GitHub Copilot provider/models unavailable. The available OpenCode catalog listed twelve models with declared tool support. Catalog loading was asynchronous; an immediate initial sample was incomplete.
- Both selected fixture baselines failed independent behavioral acceptance while their original regression tests passed. Native preflight confirmed the isolated profile and budgets without inference.

The user explicitly authorized at most three quota-consuming primary runs using
`opencode/mimo-v2.6-flash-free` in an isolated profile. Primary and all three worker
tiers use that same model. Each run has 12 primary steps, 8 child steps, one
allowed delegation/attempt/repair, 120-second child timeout and 600-second CLI
attempt timeout. No automatic fixture reruns or hard dollar cap were authorized.
Three primary runs were executed; **zero child sessions** were created. No further
model calls were made after budget exhaustion. Native title/other auxiliary
requests were not separately audited; the counts below describe recorded primary
model steps.

A snapshot of the actual dirty-tree harness was used outside the repository, with
only its test profile's model references and execution budgets changed. Production
configuration, global configuration and routing instructions stayed intact.
Workspaces/databases were fresh and outside the harness's instruction hierarchy.
Main and worker capabilities were not ranked or optimized. Equal worker models
cannot demonstrate adaptive choice among different model capabilities.

## Reproducible tasks and commands

Existing [development fixtures](../eval/cases.json), helpers and the evaluation
runner were reused. Both autonomous trials used SELECTIVE so delegation was
permitted: the existing forced-DIRECT protocol would not test autonomous choice.
The third trial added an explicit delegation diagnostic to the original task text;
initial files, scope and independent assertions were unchanged. It is not an
additional autonomous routing trial or a matched performance comparison.

```sh
bun <snapshot>/scripts/eval.ts run --phase=smoke --strategy=selective --case=brownfield-cache-falsy --repeat=1 --output-dir=<artifacts>/run-1-localized
bun <snapshot>/scripts/eval.ts run --phase=smoke --strategy=selective --case=brownfield-analysis-callers --repeat=1 --output-dir=<artifacts>/run-2-investigation
# The snapshot corpus task text is augmented with the archived diagnostic input.
bun <snapshot>/scripts/eval.ts run --phase=smoke --strategy=selective --case=brownfield-analysis-callers --repeat=1 --output-dir=<artifacts>/run-3-delegation-diagnostic
```

Bun 1.2.15 was supplied through the temporary tool PATH. Replay consumes quota and
requires new authorization. The prepared snapshot's configuration hash is
`046de53290d20c484e2e5d0f9cabf31e5273720990699af69c947686d9d72be0`;
its executable harness fingerprint is
`0e5a777b7c078ded514ba37f2fdc3b656aa1fca0eee229f1adbbc7aacbec4d4c`.
All three native settings fingerprints match:
`4516878ba5a9411695e4020c114e559134617259c0092a4031bbc749dc0f1a28`.
The snapshot has no Git metadata, so runner revision fields are null; the original
revision, source diff and executable file hashes are archived separately.

Local evidence is retained in `work/core-real-validation/`: `readiness.json`,
`preflight.json`, `results.json`, `source-start.patch`, readiness check logs, and
`artifacts/`. Each run contains the runner report/checkpoint, exact protocol,
trajectory, metrics, workspace, native database snapshot and `native-evidence.json`
collected through the pinned client API. `artifacts/harness/` preserves executable
sources/configuration; `artifacts/diagnostic-input.json` preserves the complete
third input. Historical database/workspace paths in those records refer to the
original temporary directories; their archived copies retain the same relative
run/attempt layout. The diagnostic database contains a suspended execution claim;
inspect it read-only and use a fresh database for any authorized replay.

## Actual execution and independent acceptance

| Run | Task and observed strategy                                                                                                                           | Native evidence                                                                                                              | Independent outcome                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Repair falsy memoization, preserve key identity/instance separation, add regression. Autonomous **DIRECT**.                                          | `ses_ec68acf66ffeJ4CvnsvrQo8pN6`; 10 primary steps; zero delegation calls/descendants; runtime succeeded                     | **PASS**: behavior, original regression, scope and protocol. Only `memo.js` and `regression.test.js` changed. 159.824 seconds.                              |
| 2   | Identify parse callers/null handling and independent zero-discarding configuration settings. Autonomous **DIRECT**.                                  | `ses_ec687a0f5ffeUseK2y2xFm4Ur6`; 9 primary steps; zero delegation calls/descendants; runtime succeeded                      | **PASS**: behavior, original regression, scope and protocol. Only `findings.json` changed. 131.916 seconds.                                                 |
| 3   | Same investigation, explicitly request one readonly configuration child and parent-owned caller analysis/artifact. Instructed delegation diagnostic. | `ses_ec6850a43ffeZl7wWeGa0IGB1V`; 5 recorded primary steps; no registered task, delegation call or descendant; `CLI_TIMEOUT` | **FAIL** for task completion: findings absent. Original regression/scope/protocol pass. 600.113 seconds. Native terminal outcome missing; usage incomplete. |

All recorded primary assistant dispatches are
`opencode/mimo-v2.6-flash-free#default`, matching the approved selected model.
The two successful runs report complete native workflow token counters of 109,976
and 116,370 respectively, with native cost estimates of zero. These are cumulative
counters including cache/reasoning, not context-window sizes or provider invoices.
The timed-out run's full token/cost totals remain unknown; no cohort cost total or
routing superiority is inferred.

**Run 1:** actual tools were read, glob, edit and shell. Reads covered the workspace,
`memo.js`, `regression.test.js` and `package.json`. The model changed cache presence
checking to `Map.has`, added regressions, observed `npm run test` exit 1, corrected
its test and obtained exit 0. It additionally exercised the original bug in a
temporary copy. That compound shell returned exit 0 after printing the inner
failure, so it is not treated as a standalone failing-exit predicate. Runner-owned
assertions independently establish the fix. Its final explicit routing reason was
that a single-file diagnosis/edit/test loop would only duplicate inspection if
delegated. This is observed model judgment, not a deterministic routing rule.

**Run 2:** tools were glob, shell, aorchestra_task, grep and write. The parent read
`parse.js`, `safe.js`, `unsafe.js`, `config.js`, project instructions and regression
sources, registered/started the scoped `findings-analysis` change task, wrote the
artifact, ran native verifiers, called verify and accepted with a compatibility
review. The independent oracle confirmed exactly:
`callers=[safe.js,unsafe.js]`, `nullSafeCallers=[safe.js]`,
`zeroDiscardingSettings=[timeout]`. All source files were unchanged. No explicit
final justification for avoiding delegation was recorded. Separability does not
prove a delegation benefit for this six-file fixture; this choice is not classified
as a routing defect.

**Run 3:** actual tools were read, glob, grep and shell. The fourth recorded step
took 504.142 seconds before returning shell inspections; the fifth ended with
`aborted: Step interrupted` at the CLI deadline. The model never reached task
registration/delegation or wrote `findings.json`. There is no completed child
contract to inspect. The delay's underlying provider/model/transport cause is
UNKNOWN; it is not attributed to a reproduced core orchestration defect.

## M/T/I/C and component verdicts

| Component                            | Verdict                     | Evidence and exact missing evidence                                                                                                                                                                                                 |
| ------------------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Autonomous DIRECT/DELEGATE selection | **PARTIAL**                 | Two permitted-delegation runs autonomously chose DIRECT and succeeded; autonomous DELEGATE choice was not observed.                                                                                                                 |
| Policy correctness                   | **PASS**, tested boundaries | SELECTIVE permissions did not force DIRECT; source scopes passed. Existing native negative tests rejected unavailable M, unauthorized edits/search output, shell and nesting. This does not certify every contract.                 |
| Model M                              | **PARTIAL**                 | Selected primary reference matches successful native assistant dispatch. Worker dispatch and selection among different configured models remain unverified.                                                                         |
| Tools T                              | **PARTIAL**                 | Actual primary leaf operations and native negative controls observed. No model-created child's effective tools/permissions were observed.                                                                                           |
| Instructions I                       | **PARTIAL**                 | Actual task-specific primary contract and verified behavior observed in run 2. No generated child objective/constraints/completion criteria were delivered.                                                                         |
| Context C                            | **PARTIAL**                 | Actual source reads and unchanged known fixture bytes support the primary findings. No generated child handoff, delivered child context or child provenance was observed. Large brownfield/monorepo sufficiency remains unverified. |
| Native execution                     | **PARTIAL**                 | Two real primary execution cycles succeeded; no successful child prompt/execution cycle. The timed-out primary lacks a terminal native session outcome.                                                                             |
| Result handling/continuation         | **PARTIAL**                 | Parent native verification/acceptance and independent task correctness passed. A child result interpreted by the parent and post-child continuation were not observed.                                                              |
| Task-level correctness               | **PARTIAL** overall         | Runs 1–2 PASS independently; diagnostic FAIL by timeout.                                                                                                                                                                            |

**Generated child tuple: none.** The registered DIRECT task in run 2 has a precise
objective/context, exact artifact scope, preservation constraints and native
verifier inputs, but it is not evidence of child M/T composition. No serialized
or mocked child tuple is substituted for the missing runtime execution.

**Negative case:** the existing native core probe invoked the actual registered
delegate tool with `audit-unavailable/model` and verified explicit
`MODEL_UNAVAILABLE` rejection without a reserved attempt. It also executed actual
native leaf tools in an active test child and rejected out-of-scope edits, sensitive
reads/grep output, shell and nested delegation. These tests made zero model calls
and manually drove harness callbacks; they establish native contract rejection,
not model-generated negative-case judgment.

## Defects, minimal recommendations and remaining gaps

No independently reproduced **CRITICAL** core defect was found. No production fixes
or routing-policy changes were made from these isolated observations.

The diagnostic reproduced a validation limit: the existing timeout helper sends
process termination, after which telemetry retained `running`, native session
outcome was absent, and a suspended execution claim remained. The final assistant
was aborted and the CLI process stopped; the runner correctly rejected task success
and retained incomplete usage. Native resumable shutdown is intentional behavior;
these observations do not prove that the provider failed or that routing is broken.
A minimal future evaluation correction would request native interruption and allow
a bounded terminal-record flush before process termination, with a deterministic
regression. It is outside the authorized critical-only implementation scope here.
Also, generic report strings mention paired/DIRECT restriction methodology even
for these SELECTIVE-only trials; actual `protocol.json` confirms
`directRestrictionEnforced:false`. Those labels were not used as execution evidence.

Next evidence needed is one completed real model-generated delegation: registered
bounded task and routing reason, native child/model dispatch, effective tool set and
denials, task-specific delivered I/C with traceable sources, child outcome and
parent verification/continuation. An autonomous DELEGATE choice needs a separate
unforced trial. Provider responsiveness should be checked under a newly authorized
bounded replay before interpreting the timed-out diagnostic. Configured GitHub
Copilot models, multi-model adaptation, provider cancellation completion, large
repositories, monorepos and routing superiority remain unverified.

**Final assessment:** AOrchestra demonstrably selects and completes DIRECT work
without forced delegation restrictions on these tasks. This budget did not establish
the complete autonomous child-composition/execution/result-processing chain.
Optimization or architectural redesign is not justified by these three trials.

## Delegation proof reconciliation and timeout correction, 2026-10-14

This follow-up rechecked the current dirty tree and archived native evidence.
**Phase 1 is complete; Phase 2 remains UNVERIFIED, pending fresh provider
authorization.** No provider inference was made in this follow-up. Phases 3–6
have not advanced to routing optimization or economics experiments. The timeout
correction below is an evaluation execution correction with deterministic evidence.

### 1. Delegation capability

HEAD remains `cb753315265aa98685645f0aa702806b8ae42b4d`. All six audit hashes
above match the starting files. Existing uncommitted changes were retained;
`work/core-delegation-validation/source-start.patch` and
`source-start-hashes.json` identify the follow-up baseline.

| Baseline component                         | Current evidence                                                                                                 | Remaining gap                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| DIRECT correctness                         | Archived successful localized repair and caller investigation; current regressions and native DIRECT probe pass  | Larger real-repository tasks                   |
| Contract admission/composition             | Current core/plugin tests cover M availability, selected T, scope, handoff, prompt bounds and structured reports | Model-generated executable contract            |
| Native child creation and leaf permissions | Current no-inference probe passes; manually driven hooks explicitly disclosed                                    | Actual child inference and effective request   |
| Prompt/wait/result lifecycle               | Existing controlled plugin tests cover dispatch, wait, cancellation, unknown outcome and unaccepted review       | Complete provider-backed child lifecycle       |
| Primary result consumption/acceptance      | Controlled tests enforce independent predicates and compatibility review                                         | Model continuation after a real child result   |
| Historical diagnostic timeout              | Native timestamps and missing terminal reproduced from preserved evidence                                        | Provider/model/transport cause remains UNKNOWN |

The native path remains registration → `aorchestra_delegate` admission → composed
prompt → native `session.create` with model/permissions → contract storage →
`session.prompt` → bounded `session.wait` → native context/outcome → parsed report
→ primary verification/acceptance. The context hook rejects missing selected tools,
filters child tools to selected leaf IDs and records native model dispatch.
Cancellation interrupts a created child; unknown terminal outcomes cannot grant
review. No runtime or delegation layer was added.

The reusable minimum is `brownfield-analysis-callers` in [the development
corpus](../eval/cases.json), delegating only the read-only configuration lookup.
Its independent oracle checks sorted caller/null-handling/default findings and
original regressions; only `findings.json` may change. Current native preflight
finds `opencode/mimo-v2.6-flash-free` with declared tools, resolves 20 primary and
8 worker steps, leaves delegation permissions enabled and confirms that baseline
behavior fails while regression/scope pass. Catalog presence is not provider health.

`work/core-delegation-validation/diagnostic-input.json` and
`prepared-diagnostic.json` contain the exact input, command, limits and acceptance
criteria. The primary must create its own contract and invoke delegation before
caller exploration, verify/accept the child's structured evidence, then consume it
and complete the artifact. The answer is absent from the prompt. This is protocol
A, forced delegation, run through SELECTIVE permissions; it is not an autonomous
SELECTIVE routing observation. No manually driven child can satisfy its PASS gate.

Proposed authorization: one primary run, equal selected primary/worker model,
20 primary steps, 8 child steps, one delegation/attempt, no repair or rerun,
180-second child timeout and 600-second CLI inference deadline, followed by at
most five seconds of direct-process cleanup grace. Native auxiliary requests can
occur and no hard dollar cap is enforced. Native `maxRepairs` accepts positive
integers only, so it is configured to 1 while the diagnostic forbids repairs;
any repair is a protocol violation. The previous three-run allowance is exhausted.
A zero native cost estimate does not authorize another call.

PASS additionally requires archived serialized registration/delegate inputs,
delivered child prompt and handoff/source fingerprint, actual child model
messages, effective tools/permissions, structured file-backed result, succeeded
native child outcome, primary receipt and acceptance, post-child continuation,
and passing runner-owned behavioral/regression/scope checks. Missing request or
continuation evidence remains UNVERIFIED even if the fixture result is correct.
The existing negative controls remain reusable: invalid M, missing T, invalid
scope, sensitive sources, oversized composed prompt, cancellation and unknown
outcome. Their deterministic/native evidence cannot replace successful inference.

### 2. Routing judgment

Observed autonomous decisions remain two successful DIRECT choices. Neither is
classified as a selection failure. The current policy permits independently
verifiable investigations and bounded lookup workers; delegation is not limited
to difficult tasks. DIRECT conditions include cohesive diagnosis/edit/test loops,
one known read and duplicated exploration. Workers lack shell, so instructions
keep shell-dependent reasoning with the parent.

The policy gives no quantitative estimate for search volume, tool-assisted
inference, context growth or handoff/synthesis overhead. It is plausible that a
model uses apparent difficulty as a proxy for exploration cost, or overextends
shell-related DIRECT guidance to an independent read-only slice. These are
hypotheses, not observed causes. The small caller fixture has no demonstrated
counterfactual delegation benefit. No routing instruction change meets the
required evidence gate. The diagnostic applies [writing-for-agents](https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md)
principles through ordered actions, explicit conditions and completion criteria;
production instructions remain unchanged.

### 3. Economics

No matched DIRECT versus completed DELEGATE comparison exists. Historical totals
109,976 and 116,370 are complete native workflow tokens for successful DIRECT
trials, with zero native cost estimates; they establish no strategy advantage.
The timed-out trial lacks complete usage. Equal configured worker tiers establish
neither adaptive model capability nor heterogeneous-model savings.

| Required category                        | Existing reusable seam                                                                 | Delegation economics |
| ---------------------------------------- | -------------------------------------------------------------------------------------- | -------------------- |
| Single-symbol lookup                     | Core lookup contract tests; narrow slice of caller fixture, no standalone scored trial | INCONCLUSIVE         |
| Localized bug diagnosis                  | Cache, zero-default, missing-user and sorting fixtures                                 | INCONCLUSIVE         |
| Multi-file implementation discovery      | Pagination and shared-label fixtures; discovery is not separately scored               | INCONCLUSIVE         |
| Cross-module caller analysis             | `brownfield-analysis-callers`                                                          | INCONCLUSIVE         |
| Monorepo dependency investigation        | Existing project-aware verifier tests; no model investigation fixture                  | INCONCLUSIVE         |
| Documentation research                   | Context/provenance contract tests; no scored research fixture                          | INCONCLUSIVE         |
| Investigation followed by implementation | Existing repair/refactor fixtures; investigation handoff is not separately scored      | INCONCLUSIVE         |

After capability PASS, run protocol B as unmodified autonomous SELECTIVE and
protocol C as matched DIRECT versus explicitly exercised DELEGATE. The existing
runner's DIRECT/SELECTIVE labels must not substitute for observed strategy.
Reuse covered fixtures first; add independent expected outputs only for uncovered
categories. Freeze source, model/settings, initial files and oracles; count all
failed/retried attempts and primary plus child usage. Review actual tool steps,
repeated exploration versus independent verification, handoff, continuation and
latency from trajectories. Heterogeneous model tiers need a separately authorized
experiment. No additional fixture or economic run is justified before Phase 2 PASS.

### 4. Failure attribution

| Finding                                         | Classification                             | Evidence                                                                                                                          | Root cause                                                                            | Resolution                                                                                     |
| ----------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Historical pre-delegation delay                 | INCONCLUSIVE                               | Session `ses_ec6850a43ffeZl7wWeGa0IGB1V`, fourth assistant step 504.142 s, 25,688 reasoning tokens; shell runtimes 170/126/279 ms | Long interval precedes tool execution; provider/model/transport contributions UNKNOWN | Preserve unknowns; one bounded diagnostic needs authorization                                  |
| Timeout bypasses native interruption handler    | EXECUTION_GAP in evaluation shutdown       | Original helper loses terminal marker in provider-free regression; actual 2.0.28 CLI installs SIGINT interruption handler         | Helper sends SIGTERM instead of requesting native interruption                        | SIGINT followed by bounded SIGKILL fallback; locally ADOPT, provider terminal flush UNVERIFIED |
| No successful model-generated child             | INCONCLUSIVE                               | Historical budget exhausted with zero children; current probe makes no inference                                                  | Missing execution evidence, not demonstrated absent capability                        | Prepared protocol A; await authorization                                                       |
| Autonomous DIRECT may conceal useful delegation | INCONCLUSIVE; no established SELECTION_GAP | Two independently correct DIRECT runs; no completed counterfactual                                                                | Benefit and model decision cause unmeasured                                           | Keep policy; evaluate only after capability proof                                              |

This uses the [coupled-evolution failure diagnosis and acceptance approach](https://arxiv.org/html/2610.17740v1#S3.S2): establish executable capabilities, locate the earliest unsupported action,
and regression-check a provisional intervention. COMPOSITION_GAP and
EXECUTION_GAP are this repository's extensions. The [original AOrchestra
architecture](https://arxiv.org/html/2602.03786v2#S3) supplies the dynamic I/C/T/M
contract, not proof of this adaptation's effectiveness.

### 5. Corrections

- `scripts/runtime.ts`: send SIGINT on timeout, permit five seconds for native
  interruption/flush, then SIGKILL a directly owned process still alive. Clear both
  timers on close/error; retain `CLI_TIMEOUT` and streamed stdout.
- `tests/eval.test.ts`: execute provider-free native-shaped fixtures for graceful
  interruption and ignored-SIGINT fallback. Both fail against the frozen original
  helper and pass after correction. Tests use the actual executable to avoid PATH
  shims swallowing signals; POSIX signal cases are skipped on Windows.
- `docs/benchmark.md` and `docs/reference.md`: document deadline/grace and remaining
  provider/platform/process-tree limits. This report records reconciliation and
  the pending proof rather than replacing historical results.

The predefined gate and rollback target are in
`work/core-delegation-validation/timeout-evidence-gate.md`. **ADOPT locally**:
218 tests passed, 1,592 assertions; typecheck and evaluation corpus validation
passed. Native repository smoke on OpenCode 2.0.28 passed after the code change,
with zero model calls. The unchanged delegation core probe also passed with zero
model calls. Existing DIRECT/admission/acceptance regressions remain green.
Provider terminal flush, Windows graceful handling, executable wrappers and
inherited pipes/process-tree cleanup remain unverified. SIGKILL fallback does not
prove cancellation of remote provider work. No effectiveness claim follows from
these tests. No model-backed rerun was made.

### 6. Final verdicts

| Component                     | Verdict    | Boundary                                                                                       |
| ----------------------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| DIRECT correctness            | PASS       | Two small historical fixtures, independently checked; deterministic regressions retained       |
| Delegation capability         | UNVERIFIED | No complete real-model child chain                                                             |
| Autonomous strategy selection | PARTIAL    | Successful DIRECT observed; useful autonomous DELEGATE unobserved                              |
| M selection                   | PARTIAL    | Primary dispatch and catalog admission verified; child execution/multi-model choice unverified |
| T effectiveness               | PARTIAL    | Native controls pass; model-created child effective request unverified                         |
| I adequacy                    | PARTIAL    | Serialized task composition passes; real child completion unverified                           |
| C sufficiency                 | PARTIAL    | Handoff/provenance transport passes; real child and monorepo sufficiency unverified            |
| Native child execution        | UNVERIFIED | Native creation/leaf tests do not establish child inference                                    |
| Parent continuation           | UNVERIFIED | Post-child model continuation not observed                                                     |
| Routing economics             | UNVERIFIED | No matched complete-cost delegated comparison                                                  |

### 7. Next action

Obtain authorization for the prepared single bounded forced-delegation diagnostic,
then execute and archive the actual child contract/request/result and parent
continuation. If it does not PASS, diagnose the first demonstrated blocker before
selection or economics work. No new routing policy is introduced.

## Authorized single delegation diagnostic, 2026-10-14

**Diagnostic verdict: FAIL. Delegation capability: UNVERIFIED.** Exactly one
provider-backed CLI diagnostic was launched with the approved prepared input.
It reached a real model-generated registration and delegate-tool invocation, but
malformed arguments were rejected before child admission. No child executed, no
child result was returned, and no post-child parent continuation was observed.
The authorization is now exhausted. No production routing or contract code was
changed and no second CLI run was launched.

### Approved profile and execution evidence

Before inference, the prepared manifest/input hash and isolated snapshot were
checked against the current working tree. The task input hash remained
`01d2c6c538cfe50830b688e2230152431732a3eece24d3d3c1068448a1e96a3c`.
Both primary and every worker tier use `opencode/mimo-v2.6-flash-free`.
Native preflight confirmed catalog presence, declared tool support, 20 primary
steps, 8 child steps and unchanged SELECTIVE permissions. Plugin budgets were
one delegation, one reserved attempt and 180,000 ms child timeout; the runner
retained its 600,000 ms CLI deadline and five-second cleanup grace. The prepared
protocol prohibits repairs/reruns; its previously disclosed native maxRepairs=1
setting was unchanged. Provider health was not inferred from catalog presence.

A read-only HTTP request/response observation hook was added only to the isolated
snapshot. It records cloned request JSON, model/session/agent/kind and response
status without changing requests or consuming responses. Authentication headers
and URL queries are excluded. Snapshot typecheck passed before execution. The
observer diff/source hashes are archived, and the task input and configuration
were unchanged. This observation code is not part of production routing.

| Measurement                                    | Observed value                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Native primary session                         | `ses_ec642f088ffe8O4HJxWVIrpI2N`                                                                     |
| Runtime                                        | OpenCode 2.0.28, pinned plugin/client 2.0.26                                                         |
| Actual primary dispatch                        | `opencode/mimo-v2.6-flash-free#default`, 7 steps                                                     |
| Provider requests                              | 7 primary, 1 auxiliary title; all 8 HTTP response statuses 200                                       |
| Child sessions / child requests                | 0 / 0                                                                                                |
| Delegate-tool invocations                      | **2 rejected calls: protocol violation**                                                             |
| Admitted delegations / reserved child attempts | 0 / 0                                                                                                |
| Repairs / additional CLI runs                  | 0 / 0                                                                                                |
| Runner duration                                | 187.260 seconds; stopped before timeout                                                              |
| Native terminal / CLI exit                     | `interrupted` / 130                                                                                  |
| Independent acceptance                         | Behavior FAIL: `findings.json` absent; original regression and scope PASS                            |
| Source changes                                 | None in fixture or production execution/routing files                                                |
| Observed usage                                 | 73,080 recorded tokens, native cost estimate 0; incomplete coverage, no complete workflow-cost claim |

### Earliest observable failure and attribution

Step 3 registered `config-zero-lookup`: read-only analysis, lookup mode, no
write paths, a structured candidate-source handoff for `config.js`, preservation
constraints and a native read verifier. This proves that the primary generated
registration fields, not that the eventual child contract was valid or adequate.

Step 4 invoked `aorchestra_delegate` with fast tier and a bounded lookup reason,
but `tools` was the string `"[\"read\", \"grep\", \"glob\"]"` and
`handoff` was a JSON-encoded string. The actual provider request's tool schema
requires `tools` to be an array and `handoff` to be an object. The call's string
handoff overrides the correctly structured handoff on registration. Native
execution rejected it with **`HANDOFF_SOURCES_INVALID`** before reservation or
child creation. This is the earliest observed blocker: a **COMPOSITION_GAP at
the native invocation boundary**. Raw provider response bodies were not captured,
so whether the model emitted these string values or a decoder transformed them
is not established. The correct delivered schema rules out a claim that the
provider was shown string types for these fields.

The primary then requested task status and made a second delegate call, omitting
its handoff override but retaining string-valued tools. `validateTools` treats
that malformed string as an iterable and reports **`DUPLICATE_TOOLS`** rather than
an array-type error. This error describes validation behavior, not a successful
second child attempt. Both calls failed before native child execution.

The second invocation violates the approved one-call/no-retry diagnostic. The
observer did not interrupt promptly enough after the first rejection to prevent
it. SIGINT was then sent to the CLI; native session interruption and telemetry
terminal were observed. No repair, second CLI attempt, provider rerun or further
inference was initiated by the operator. The runner's `policyPassed=true` means
ordinary SELECTIVE permissions were respected; it does **not** certify this
stricter diagnostic protocol, whose independent verdict is **FAIL**.

A further unexecuted I issue is visible in the registration: it asks for
`STATUS: SUCCESS or FAILURE`, whereas the worker parser accepts COMPLETE,
PARTIAL or BLOCKED. No child received that instruction, so a result-parser failure
was not reproduced and is not substituted for the earlier invocation blocker.

### M/T/I/C and continuation boundaries

| Component                      | Evidence and verdict                                                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M                              | Primary dispatch matches the approved provider/model. Fast tier was requested, but no effective child model exists: child M UNVERIFIED.                                          |
| T                              | Intended read/grep/glob is visible as malformed string input; provider schema is correct. No child request/permissions/tool operations exist: effective child T UNVERIFIED.      |
| I                              | Actual registration instruction archived; no synthesized child prompt or delivered child instruction. Adequacy UNVERIFIED, with the status-vocabulary inconsistency noted above. |
| C                              | Actual structured registered handoff/context archived; delegate override had the wrong type. No delivered child context/source fingerprint: sufficiency UNVERIFIED.              |
| Native child execution         | No child session or provider request. UNVERIFIED; not a reproduced failure of executing an admitted valid contract.                                                              |
| Parent continuation            | Status and another rejected invocation followed failure, but no child result consumption, verification/acceptance or final artifact. Required continuation UNVERIFIED.           |
| Autonomous routing / economics | Forced diagnostic supplies no autonomous-selection or matched-cost evidence. UNVERIFIED.                                                                                         |

### Evidence archive and next action

The durable archive is `work/core-delegation-validation/`:

- `authorization-check.json`, `authorized-attempt.json` and `protocol-stop.json`:
  checked limits, single-run ownership, consumed authorization and interruption.
- `diagnostic-input.json`, `prepared-diagnostic-authorized.json`,
  `authorized-start.patch` and `authorized-start-hashes.json`: approved input and
  preserved source baseline.
- `provider-requests.jsonl`, `effective-delegate-schema.json` and
  `observer-manifest.json`: actual serialized request schema/content, HTTP status
  and isolated observation source hashes; no raw response bodies.
- `native-evidence.json`, `serialized-tool-calls.json`, `final-task-state.json`
  and `execution-assessment.json`: exact native calls, outcomes and independent
  diagnostic classification.
- `authorized-run/`: runner report, metrics, trajectory, protocol, workspace and
  consistent SQLite snapshot. Historical temporary paths are preserved in raw
  records; archived paths retain the same run layout.

No further provider execution is authorized. The next supported work is a
zero-inference reproduction of malformed nested arguments and result-vocabulary
composition against the existing plugin tests, including a diagnostic call-count
stop gate before any separately authorized replay. Do not optimize routing or
claim delegation effectiveness from this failed capability diagnostic.

## Delegation tool contract usability audit, 2026-10-14

**Deterministic interface correction: PASS. Model-dependent delegation reliability:
UNVERIFIED.** Both exact archived calls were replayed against the original plugin,
then against the corrected implementation. No provider-backed inference ran and
DIRECT/DELEGATE selection conditions were unchanged. Existing uncommitted work
was preserved; this audit's baseline and check logs are in
`work/delegation-contract-audit/`.

### 1. Exact failure mechanism and archived arguments

The reusable [regression fixture](../tests/fixtures/delegation-contract.json)
copies the original registration and both call inputs exactly, including their
native message IDs. The first call supplies tools as the string
`"[\"read\", \"grep\", \"glob\"]"` and handoff as a JSON-encoded
string. That explicit override replaces the task's valid structured handoff.
`validateHandoff` checks `.sources`, sees undefined on the string, and originally
reports HANDOFF_SOURCES_INVALID. The second call omits handoff and recovers the
stored object, but its unchanged string tools passes into `new Set(tools)`.
That iterates characters rather than tool IDs; repeated characters produce the
original DUPLICATE_TOOLS error. Neither call reaches reservation or child creation.

The actual archived provider-facing schema declares tools as an array with
uniqueItems, handoff as an object, and taskId/model/tools/routingEvidence as
required. It does not declare those fields as strings. OpenCode parses the outer
tool-call JSON; embedded JSON text remains a string rather than receiving an
implicit second decode. The original raw provider responses were not captured,
so the component that first generated the string values remains UNKNOWN.

A reproduced native acceptance issue explains how malformed shapes reach the
harness. The inspected OpenCode 2.0.28 tool runtime compiles raw JSON schemas
with Effect's default pattern policy, catches conversion failures and passes the
raw input through when no codec exists. Converting the exact archived schema
with installed Effect 4.0.0-rc.112 fails on
`schema.oneOf[0].properties.taskId.pattern`. This is a codec compatibility gap,
not proof that oneOf or JSON arrays caused model generation failure. The harness
now validates the delegation boundary explicitly while retaining the provider
schema, patterns and existing native execution path.

### 2. Schema and instruction findings

| Finding                                                   | Classification and evidence                                                                                                                      | Correction                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Nested JSON strings despite array/object schema           | Observed invocation shape mismatch; earliest rejection reproduced from both exact native payloads; origin before native argument history UNKNOWN | Explicit type guards; retain structured-only input                                                          |
| Raw schema codec fails on pattern                         | Native validation compatibility gap; exact conversion failure plus 2.0.28 pass-through fallback source                                           | Validate required/optional delegation fields in the existing callback; retain patterns and strict schema    |
| String tools produces DUPLICATE_TOOLS                     | Harness error-specificity defect: character uniqueness check precedes an array guard                                                             | TOOLS_ARRAY_REQUIRED before item/uniqueness/catalog checks                                                  |
| String handoff produces generic sources error             | Harness feedback defect: sources inspected before object guard                                                                                   | HANDOFF_OBJECT_REQUIRED with object/array guidance and registered-handoff fallback                          |
| Explicit null override falls back silently                | Type-validation gap at nullish fallback; new regression covers supplied null                                                                     | Reuse stored handoff only when the override is undefined; null is rejected                                  |
| Minimal type guidance and no compact delegate example     | Interface usability weakness; provider schema was correct but field descriptions did not explain structured values                               | Typed field descriptions and a valid one-tool example on the actual registered tool                         |
| Generated instruction asks for SUCCESS/FAILURE            | Unexecuted composition inconsistency with COMPLETE/PARTIAL/BLOCKED parser; no actual child parser failure                                        | State the established worker result vocabulary in the tool description and primary handoff guidance         |
| Primary made a second invalid call in one-call diagnostic | Observed authorization-protocol violation; no admitted attempts were charged                                                                     | Clarify that validation feedback grants no retry authorization; admitted-attempt budget semantics unchanged |

Descriptions preserve the existing lookup/synthesis tiers, native leaf-tool
selection and worker shell denial. The compact example assumes an already
registered lookup task with a valid handoff; the controlled recovery test confirms
that omitting handoff reuses its stored structured value. The handoff instruction
uses the tool description as its example pointer rather than duplicating examples
in always-loaded instructions. [Writing-for-agents](https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md)
informed the positive typed guidance, conditional recovery and explicit result
criteria. These are instruction changes, not model behavior guarantees.

### 3. Minimal changes and recovery behavior

- [Core validation](../lib/core.ts) requires a real tools array, non-empty string
  IDs, declared size bounds and uniqueness before native catalog/permission checks.
  Handoff requires an object, all four bounded arrays, structured source entries
  with ref/status/revision, allowed fields and unique evidence-array entries.
  Errors retain relevant existing codes and add field paths/expected shapes.
- [Delegation registration](../plugins/aorchestra.ts) validates root/group shape,
  required taskId/model/routingEvidence and typed optional fields before native
  lookup, rejects unknown fields, and preserves atomic group admission. The
  handoff override is validated as supplied, and registration validates every
  supplied handoff, including null/false. Existing model, dependency, scope,
  tools, retry, budget, native permissions and acceptance gates remain in place.
- [Primary instructions](../instructions/aorchestra.md) clarify structured inputs,
  stored handoff reuse, authorized correction under the same task ID and the
  established result vocabulary. Routing conditions and model-tier policy remain
  unchanged. [The reference](reference.md#task-contracts-and-verification) records
  the typed example and error/recovery contract.

Malformed strings are rejected, not normalized. This avoids interpreting a
second representation across source-provenance, tool-selection and permission
boundaries. A caller can explicitly supply a corrected array/object under the
same task ID when another call is authorized. A rejected call mutates neither
state nor attempt budget; it requires no repair transition. A failed admitted
execution still follows the existing repair/retry and acceptance workflow.

### 4. Regression coverage and native verification

Seven initial regressions failed against the original implementation, including
separate exact replays producing HANDOFF_SOURCES_INVALID and DUPLICATE_TOOLS.
A further registration regression failed for explicit null/false handoff values
before its truthiness guard was corrected. After correction, nine added tests cover those replays, corrected structured
recovery, required/optional delegation fields, group atomicity, native-facing
schema guidance, malformed tool elements and source/handoff shapes. The existing
oversize-handoff test now uses distinct entries to exercise its size bound
independently of the schema's uniqueness requirement.

| Check                                       | Observed result                    |
| ------------------------------------------- | ---------------------------------- |
| Focused core/plugin behavior suite          | 94 PASS, 0 FAIL, 764 assertions    |
| Complete package test script                | 227 PASS, 0 FAIL, 1,685 assertions |
| Typecheck and evaluation corpus             | PASS                               |
| Native repository smoke, OpenCode 2.0.28    | PASS, modelCalls=0                 |
| Extended native core probe, OpenCode 2.0.28 | PASS, modelCalls=0                 |

The core probe inspects the actual registered delegate schema/types/descriptions,
replays both malformed archived calls without state changes or native child-create
calls, and supplies a corrected typed payload that reaches MODEL_UNAVAILABLE
before reservation. Its model is deliberately unavailable, so inference never
starts. Existing real native read/edit/search, sensitive-source, out-of-scope,
shell/nesting denial and DIRECT acceptance checks remain passing. Probe callbacks
are manually driven: this is native registration/validation evidence, not an
inference-driven delegate dispatch. Controlled plugin recovery creates one mock
child, preserves handoff/deny-by-default permissions and returns unaccepted review;
it does not prove model execution or semantic acceptance.

### 5. Remaining uncertainty and verdict

The correction is **ADOPT for deterministic contract safety and feedback**. The
predefined regression gate and rollback boundaries are archived in
`work/delegation-contract-audit/evidence-gate.md`. Real-model comprehension,
argument generation, recovery discipline, child report adequacy and successful
parent continuation remain **UNVERIFIED**. Native schema conversion behavior on
other runtime versions was not certified, and upstream native codec fallback was
not changed. The harness continues to count admitted attempts rather than invalid
tool invocations; a future one-call diagnostic needs an enforced external stop
condition to prevent a model from retrying before an observer reacts.

No provider replay is authorized by this audit. Passing deterministic checks
establishes clear structured representation, strict rejection and controlled
recovery; it does not establish complete real-model delegation success.

## Delegation foundation preparation, 2026-10-14

**Final verdict: BLOCKED pending fresh provider authorization.** No inference ran.
Current executable contracts were reconciled and tested again; no complete
model-driven child or parent continuation is claimed. The earlier authorization
was consumed by its single diagnostic and does not authorize this prepared proof.

### Existing path and current evidence

| Stage                         | Existing implementation                                                                                                                                   | Current evidence and remaining boundary                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary task registration     | `aorchestra_task`, `registerTask`, stored handoff and ledger                                                                                              | Typed registration and archived malformed-call regressions pass; historical model registration remains historical evidence.                                                              |
| Delegate invocation/admission | Registered `aorchestra_delegate`, scalar/type/tool/model/scope/provenance gates, atomic reservation                                                       | Corrected structured input reuses the task/handoff; malformed strings fail before reservation. Native proof probe reaches deliberately unavailable model admission.                      |
| M                             | Configured tier → parsed native model reference → catalog/variant/tool-support checks                                                                     | Model-resolution tests pass; prepared `opencode/mimo-v2.6-flash-free` is currently in the native catalog with tool support. Provider health and actual child dispatch remain UNVERIFIED. |
| T                             | `validateTools`, deny-first `permissionRules`, effective-context filtering and tool/path hooks                                                            | Native read/edit/search and denial checks pass; one selected `read` tool is sufficient for the new lookup. Actual model-facing child tool use remains UNVERIFIED.                        |
| I                             | Task instruction and preservation/completion criteria synthesized into a bounded prompt                                                                   | Exact prompt delivery and oversize rejection tests pass; worker vocabulary remains COMPLETE/PARTIAL/BLOCKED. Adequacy with a real child remains UNVERIFIED.                              |
| C                             | Task context, stored structured handoff, source fingerprint and accepted dependencies                                                                     | Prompt/context/provenance regressions pass. Model comprehension and source sufficiency remain UNVERIFIED.                                                                                |
| Native child                  | `ctx.session.create` → saved active contract → `prompt` → bounded `wait` → native outcome                                                                 | Native session configuration and controlled lifecycle tests pass. Successful provider-backed execution remains UNVERIFIED.                                                               |
| Result                        | `parseResult`, succeeded native outcome and current attempt required before review                                                                        | Structured-result, cancellation, unknown outcome, revocation and acceptance tests pass. Controlled results are not real-model evidence.                                                  |
| Parent continuation           | Delegate tool returns report/child metadata; task status exposes pending verifiers; primary explicitly accepts with fresh checks and compatibility review | Controlled delegated acceptance and native DIRECT acceptance pass. Real parent consumption and independent output acceptance remain UNVERIFIED.                                          |

The public schema still represents `tools` as a unique array and `handoff` as an
object; the compact native tool example omits handoff and reuses registration.
Both exact archived malformed calls retain actionable errors. Existing strict
permissions, sensitive-source/provenance checks and acceptance boundaries remain
in place. No production executor, routing, telemetry or instruction was changed.

### Minimal proof and enforceable limits

[`prepare-delegation-proof.ts`](../scripts/prepare-delegation-proof.ts) reuses
`brownfield-analysis-callers`, retaining its initial files and original regression.
Only its diagnostic prompt and runner-owned assertion change: the child reads
`config.js`; the primary verifies/accepts the lookup and writes one sorted settings
array in `findings.json`. The expected array is outside the model-visible workspace
and prompt. The primary constructs the instruction/context/handoff for one
registered `analysisMode: lookup` task, then delegates with a typed `read` array
and stored handoff. This is forced capability validation, not autonomous selection.

Prepared manifest: `work/delegation-foundation/prepared/prepared-diagnostic.json`.
Preflight, source hashes, archived rejected preparation, red/green regressions and
check logs are under `work/delegation-foundation/`. The manifest records the exact
snapshot and command; the runtime workspace is outside this repository to preserve
native configuration discovery without inheriting this repository's project profile.

| Proposed budget                     | Limit and enforcement                                                                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider/model                      | `opencode/mimo-v2.6-flash-free`; identical primary and all worker tier mappings; catalog/tool support verified, health unknown                            |
| CLI runs                            | One existing smoke runner invocation, one selected case, repeat=1; no operator rerun authorized                                                           |
| Primary/child steps                 | 20 / 8, checked against effective native agents                                                                                                           |
| Provider sends                      | At most 20 primary + 8 child HTTP requests; persisted request guard counts before network dispatch                                                        |
| Auxiliary inference                 | Zero; evaluation title hook supplies a fixed title, other auxiliary sends are denied; automatic compaction disabled                                       |
| Delegation invocation               | One callback may enter production admission; persisted gate counts before validation, including rejections; subsequent callbacks are blocked and recorded |
| Admitted delegations/child attempts | 1 / 1 through unchanged native harness budgets; group calls denied by the fixture                                                                         |
| Repairs/retries                     | Zero; failed/rejected delegation blocks later context, native provider retry decision is false, replacement lookups and repair/recovery denied            |
| Child timeout                       | 180 seconds through existing cancellation/wait path                                                                                                       |
| CLI timeout/cleanup grace           | 600 / 5 seconds through existing SIGINT then direct-process SIGKILL helper                                                                                |

The evaluation-only [fixture wrapper](../tests/fixtures/delegation-proof/index.ts)
records exact registration/call arguments, admission results, child creation/model/
permissions, prompt/context, native session observations, full returned child
context, effective tool schemas and provider request JSON/response status. Headers,
URL queries and raw provider response bodies are excluded. Native trajectory and
attempt DB remain authoritative for final outcomes and primary continuation;
`work/delegation-foundation/collect-native-evidence.ts` reuses the earlier read-only
native family/message/instruction collector. Runtime output must be copied into the
manifest's archive location after the attempt, with a consistent DB backup.

After successful delegation the parent schema removes the delegate tool, allowing
verification/output continuation. The wrapper also rejects already queued second
calls before production admission. A model may still emit multiple calls in one
response: archive that protocol violation; blocking an extra call is not proof the
model generated exactly one. Any first-call rejection prevents the next model
request without relying on an observer's reaction time. Invocation attempts and
admitted attempts remain distinct, and validation feedback grants no retry.

A PASS separately requires the model-generated invocation, valid admitted tuple,
actual child request/model, effective tools/permissions, delivered I/C, succeeded
structured child result, parent consumption/continuation, accepted lookup, and
runner-owned behavior/original-regression/scope checks. Correct output alone or
manually invoked probe callbacks cannot establish PASS. Native estimate zero does
not authorize unlimited inference. In-flight provider behavior, raw response origin,
process-tree cleanup and actual task effectiveness retain their earlier uncertainty.

### Reproduced defects and bounded corrections

The diagnosis separates missing capabilities from unused capabilities using
[the coupled-evolution methodology](https://arxiv.org/abs/2610.17740).
COMPOSITION_GAP and EXECUTION_GAP here are local diagnostic adaptations.

| Finding                                                | Classification                              | Reproduction / earliest cause                                                                                                                      | Correction and rollback boundary                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One-call diagnostic allowed a second rejected call     | EXECUTION_GAP in evaluation enforcement     | Exact archived replay with passthrough gate returns the second array-type error; admitted-attempt budgets exclude rejected invocations             | Evaluation-only persisted wrapper counts before admission, halts after failure and blocks further calls; remove wrapper/tests to roll back. Production budgets remain unchanged. |
| Prepared workspace inherited 30/24-step source profile | COMPOSITION_GAP in diagnostic configuration | Native preflight in the repository subtree reports 30/24 despite prepared 20/8; its initial readiness predicate failed to compare effective agents | Runtime workspace moved to a fresh external directory; failing preflight regression now rejects mismatched steps/missing wrapper. Roll back preparation/checker additions only.  |
| No observed complete child cycle                       | INCONCLUSIVE                                | No new inference; prior malformed arguments prevented child admission                                                                              | Prepared authorized proof is the next evidence step, not a production defect or selection failure.                                                                               |

The predefined gate is `work/delegation-foundation/evidence-gate.md`. Two red
regressions were observed before their respective fixes; six new tests cover
rejection counting, successful controlled continuation, simultaneous calls/reload,
groups/repairs/replacement lookups, provider-request quotas/retry denial and
preflight readiness. Historical malformed-call and native scope/provenance tests
are reused. The wrapper never decodes alternative string representations or
changes production contract acceptance.

Checks on the current tree: **233 tests PASS, 1,714 assertions**; typecheck and
corpus checks PASS; repository native smoke, extended core probe and diagnostic
registration probe PASS on OpenCode 2.0.28, all with modelCalls=0. Native probe
callbacks are manually driven; complete child inference and parent continuation
remain UNVERIFIED. Corrections are ADOPT for deterministic diagnostic enforcement;
real-model foundation is BLOCKED, autonomous routing/economics UNVERIFIED.

Next smallest action: fresh authorization for exactly the manifest's single
bounded diagnostic, followed by evidence collection and independent acceptance.

## Minimal architecture foundation reconciliation, 2026-10-14

The [minimal architecture review](core-orchestration-audit.md#minimal-architecture-review-2026-10-14)
retains the existing delegation path. No provider-backed run was authorized or
launched. Model-driven child execution and parent continuation remain
**UNVERIFIED**; autonomous selection and comparative economics remain
**INCONCLUSIVE**.

The original `work/delegation-foundation/prepared/prepared-diagnostic.json` was
inspected without dispatch. All archived `source-hashes.json` entries matched its
copied harness, and SHA-256 of the serialized fixture matched `fixtureSHA256`.
Its recorded preflight was ready with zero model calls. Four entries differed
from the current checkout before this review's edits: `eval/cases.json` and
`opencode.json` intentionally specialize the proof, while `package.json` and
`scripts/prepare-delegation-proof.ts` also belong to an older source snapshot.
Historical readiness is not current provider health. The original archive was
preserved; it cannot establish the behavior of the simplified source.

A fresh no-inference preparation is stored at
[`work/delegation-foundation/simplified-prepared/prepared-diagnostic.json`](../work/delegation-foundation/simplified-prepared/prepared-diagnostic.json).
It uses an external isolated workspace, OpenCode 2.0.28, the active evaluation
wrapper, effective primary/child steps 20/8 and a catalog-listed tool-capable
`opencode/mimo-v2.6-flash-free`. Preflight is ready, original fixture regression
and scope pass, and the target behavioral assertion fails before implementation
as expected. No prompt was sent and `modelCalls` is zero.

The protocol is unchanged: one primary run, one delegate invocation/admission,
one child attempt, 20/8 primary/child steps, 180-second child timeout,
600-second CLI timeout plus five-second cleanup grace, zero repairs, reruns,
provider retries or auxiliary inference, at most 28 primary/child request sends.
The manifest is **BLOCKED_AWAITING_FRESH_AUTHORIZATION**. The separate proposed
six-attempt routing comparison is not covered by this protocol or past approval.

Current controlled tests cover stored handoff delivery, structured report parsing,
partial results returned as unaccepted observations, primary continuation/acceptance,
atomic groups, cancellation and stale evidence. Native no-inference probes verify
registered typed arguments, child session configuration/permissions, real leaf
execution and negative admission controls. The remaining provider-backed evidence
is exactly a model-generated valid delegate call, actual selected child M/T and
delivered I/C, succeeded native child outcome with file-backed report, parent
consumption, fresh native checks, explicit acceptance and continued artifact
completion under the independent oracle. No deterministic test substitutes for
those observations.
