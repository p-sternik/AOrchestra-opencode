# Brownfield evaluation baseline

This benchmark measures verified correctness, native whole-workflow cost and
usage, CLI duration, delegation count and scope violations. It changes no production
routing or acceptance behavior. Provider-backed runs are opt-in; deterministic
checks make no model calls.

## Corpus and independent acceptance

The version-1 fixture format is retained. [Development cases](../eval/cases.json)
contain three original smoke tasks and six additional brownfield tasks.
[Holdout cases](../eval/holdout.json) contain four additional tasks, selected only
with `--split=holdout`. Keep holdout outcomes out of instruction/policy tuning;
public holdouts are a procedural separation, not secret or contamination-proof data.

| Split       | Added cases                                                                             | Coverage                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Development | Cache, pagination, greeting options, label refactoring, caller/config analysis, sorting | Local bugs, cross-module consumers, positional API compatibility, conventions, preserved behavior, independent read-only investigations |
| Holdout     | CSV escaping, inventory consumers, immutable update, read/write analysis                | Serialization, cross-module consistency, mutation contracts, independent read-only investigations                                       |

Fixtures are synthetic ES modules using Node's standard library, without framework
or runtime dependencies. Each has existing regression tests and explicit exact
allowed paths; analysis cases permit only a findings artifact, keeping sources
read-only. Prompts state requirements without repair code. Oracle assertions are
executed by Node from runner-owned data after inference and never written into the
workspace or prompt. They test both changed and preserved behavior independently
of agent tests. Refactoring additionally checks shared-module imports and removal
of duplicated normalization, a deliberately narrow structural acceptance rule.
[Corpus tests](../tests/eval-corpus.test.ts) verify baseline rejection, a scoped
reference repair, preserved existing tests and rejection even when agent tests
are removed. Reference repairs stay outside evaluation workspaces.

This follows the behavioral validation motivation of
[SWE-bench](https://arxiv.org/abs/2310.06770), but these compact synthetic cases are
not SWE-bench instances or evidence of real-repository performance. Assertions
are independent checks, not a security sandbox against adversarial code.

## Matched execution

Run the deterministic checks before explicitly authorizing inference:

```sh
bun run typecheck
bun run test
bun run eval:check
npm run format:check
```

After separate authorization, run a paid fixture smoke with both strategies:

```sh
bun run eval:run -- --phase=smoke --strategy=both --case=legacy-zero-default --repeat=1 --output-dir=work/eval-smoke
```

A performance comparison requires a successful smoke for each protocol under the
same resolved settings and harness source fingerprint. After separate authorization:

```sh
bun run eval:run -- --phase=benchmark --strategy=both --repeat=3 --split=development --smoke-report=work/eval-smoke/report.json --output-dir=work/eval-development
```

Freeze the candidate before the separately authorized holdout assessment:

```sh
bun run eval:run -- --phase=benchmark --strategy=both --repeat=3 --split=holdout --smoke-report=work/eval-smoke/report.json --output-dir=work/eval-holdout
```

`--phase=benchmark` requires both strategies, at least two repetitions and
`--smoke-report`. With no phase flag, one repetition is smoke and multiple
repetitions are benchmark. `--case` selects one case for a bounded smoke or matched
comparison. The fixture smoke above invokes a provider; the native no-inference
smoke is a separate protocol/configuration check and cannot satisfy this gate.

Use a fresh output directory per experiment. Both strategies receive identical
case text, initial bytes, acceptance assertions and allowed paths in fresh
workspaces/databases. The runner pairs each case/repetition, runs DIRECT first on
odd repetitions and SELECTIVE first on even repetitions. It freezes the process
environment, checks native resolved agent/configuration fingerprints before
inference, and rejects changed harness source or settings. Explicit primary model,
timeouts, steps, token limits, repository permissions and bounded repair are shared.
`protocol.json` records the session, effective permissions and settings fingerprint;
`attempts.json` checkpoints every started attempt, including failures. Resolved
configuration is hashed rather than exporting potentially secret provider settings.

DIRECT starts the AOrchestra primary in a native session with appended explicit
denies for `aorchestra_delegate` and `subagent`, verified through native permission
evaluation before inference. The CLI resumes that same session; `--auto` does not
remove these denies. Normal discovery, editing, tests and workflow tools remain
available. Observed delegation calls or native descendants reject the attempt,
including failed or denied delegation requests. This retains AOrchestra overhead;
it is not a native OpenCode baseline. The delegation restriction is the sole
intentional permission difference between protocols.

SELECTIVE starts the same primary with its resolved permissions unchanged, using
normal routing, configured tiers, limits, handoffs and worker contracts. Delegation
is permitted, never required. A run without children remains classified SELECTIVE.
Parallel delegation must be evaluated separately; the repository's default
`maxConcurrentAnalyses` remains one. Global/project configuration files and production orchestration code remain
unchanged.

The repository profile currently selects `github-copilot/gpt-5.6-terra` for the
primary and balanced tier, `github-copilot/gpt-5.6-luna` for fast and
`github-copilot/gpt-5.6-sol` for strong. Reports record configured models and
observed native model dispatches, package version, Git revision/dirty status,
native runtime version, corpus/config/source hashes, resolved settings fingerprint,
repetitions, phase, strategy order, step limits and
harness budgets. Archive the source diff for a dirty revision and a redacted copy
of the native configuration sources for reproduction. Global native
configuration discovery remains enabled. Preflight fingerprints detect differences
between attempts; keep external configuration fixed during each running process
and verify observed model IDs before comparison.
Configured settings alone do not prove provider/model availability or identical
provider behavior.

Defaults are one repetition (use at least three for exploratory comparisons),
600 seconds per CLI attempt, 10 seconds for independent assertions, 30 primary
steps, 24 executor steps, eight delegations and two attempts per delegated task.
Session usage has no default hard token cap; explicit numeric limits remain
per-session safeguards. There is no whole-workflow dollar cap. Choose settings
and stopping criteria before inference; every attempted run, including failures,
timeouts and interruptions, remains in the report. Do not silently retry or drop
unfavorable trials. Run each harness revision with matched settings when evaluating
a candidate change; DIRECT vs SELECTIVE alone is not a revision comparison.

## Measurements and limitations

Verified success requires `executionConfirmed AND behaviorPassed AND
regressionPassed AND scopePassed AND policyPassed` and no execution error.
Original fixture `.test.js` sources run from runner-owned data through Node after
inference, independently of edited or deleted workspace tests. Behavioral and
regression results are recorded separately. Scope is measured after these checks. Usage completeness is reported separately.
Native reconciliation and token category semantics remain documented in the
[evaluation reference](reference.md#validation-and-evaluation). Unknown counters
stay `null`; measured zero stays zero. Workflow usage includes primary deltas and
fresh child usage, including failed workers. Observed cost/token sums show measured
run counts; partial sums are not cohort totals. `totalCostUSD` stays unknown until
the whole strategy cohort has complete cost coverage. Cost per verified success includes
all attempts and is unknown without complete cost counters, correlation and
lifecycle coverage or without successes. Token coverage is independent: known
complete costs can support the metric even when a token category is missing. Native costs are estimates, not invoices.

Duration is CLI wall time including startup, excluding reconciliation/assertions.
Delegation counts measure frequency, not isolated overhead time: the current
telemetry cannot attribute the counterfactual cost/time of delegation itself.
Inspect per-attempt duration, cost and child records together. Reports show every
case/repetition outcome, matched-pair SELECTIVE-minus-DIRECT differences, per-case
strategy summaries, ranges and sample standard deviations. Duplicate, unmatched
or settings-mismatched pairs cannot produce paired differences. Small-sample
variability remains descriptive.

Reports include category-level token coverage, tool activity, provider retries,
retry child executions, observed repair cycles, missing usage and incomplete
lifecycles. Repair counts come from cumulative workflow counters in native task
responses, not agent statements; missing/unparseable/incomplete tool history stays
unknown. Child retries count unique recorded children with attempt number above
one; rejected retry requests without a child are visible in tool activity/errors
and contribute their primary cost, but cannot be inferred as child executions.
Delegation evidence counts include attempted tool calls and known descendants;
group calls and child executions need not have the same count. The current native
history does not provide an invoice or counterfactual overhead measurement.

Threats to validity include tiny fixtures, one language, limited oracle coverage,
public holdout contamination, provider randomness/caching/rate limits, residual
time effects despite alternating paired order, within-attempt configuration drift, shared machine load,
and scope snapshots' documented exclusions. No superiority or cost-saving claim
follows from this small corpus or deterministic tests. Larger public repositories,
multiple providers and predeclared confidence/sample
criteria remain follow-up work. Do not tune on holdout outcomes.

Large-JSON regressions keep cumulative usage separate from context size and leave
truncation to OpenCode. The no-inference native smoke checks the pinned shell API's
bounded byte retrieval and continuation cursor for output above 1 MB. This does
not establish model-facing read/shell `tool_output` line truncation or successful
provider dispatch with a full context; those require additional native tool or
opt-in provider integration. No custom JSON parser or truncation layer is added.
