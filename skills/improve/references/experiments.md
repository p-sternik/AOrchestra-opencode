# Reviewing an improvement experiment

Specify one falsifiable hypothesis per experiment and the smallest candidate change.
For example: a named redundant inspection can be removed while preserving verified
success and reducing cost per verified success by a predeclared threshold. Identify
the observation that would refute it; fewer tool calls alone do not prove benefit.
Use development cases to formulate the change; reserve independent holdout cases
for assessment. Do not tune on holdout outcomes.

Before execution, record in the proposal or existing review document:

- Baseline and candidate commit IDs, exact candidate diff, target files and a
  rollback commit/revert plan. Prefer clean frozen checkouts; archive a dirty patch
  and its source fingerprint if a clean revision is unavailable.
- Identical case IDs, corpus bytes/hash, split, independent assertions and original
  regressions; compare the same strategy across revisions. DIRECT versus SELECTIVE
  is a separate axis. Never pool baseline DIRECT with candidate SELECTIVE as a
  revision effect.
- Runtime and dependency versions, observed main/worker model IDs, provider,
  permissions, budgets, timeouts, repetitions and stopping criteria. Freeze external
  native configuration; record redacted settings and explain every intentional
  difference. Configuration/source fingerprints can differ for the candidate or
  checkout paths; inspect those differences rather than treating hashes as proof
  of matched conditions.
- Primary metric and numeric benefit threshold, acceptable correctness criteria,
  zero scope violations, minimum coverage and sample requirements. Define these
  before results; retain failed, blocked, interrupted and missing trials.

A mechanical correction needs a focused regression and relevant existing checks.
An instruction/routing improvement needs matched baseline/candidate tasks with
independent behavior, regression and scope assertions, counting failed and blocked
runs as well as successes. Use repetitions where variability matters. Define
success criteria before observing results: verified success must not decline,
scope violations must be zero, and any cost/time target needs an explicit threshold.
Observe delegation frequency rather than treating fewer delegations as success.

Existing checkout commands:

```sh
bun run eval:check
bun run eval:run -- --phase=smoke --strategy=both --case=legacy-zero-default --repeat=1 --output-dir=work/eval-smoke
bun run eval:run -- --phase=benchmark --strategy=both --repeat=3 --smoke-report=work/eval-smoke/report.json --output-dir=work/eval-development
```

The `eval:run` commands invoke paid/provider-backed models and require explicit
authorization covering the runs. Benchmark repetitions require a matched successful fixture
smoke for both protocols. Paired order alternates across repetitions; DIRECT has
native session delegation denies, while SELECTIVE retains normal routing. The corpus contains three smoke cases and ten synthetic brownfield cases in
separate development/holdout files; see the [benchmark methodology](../../../docs/benchmark.md).
It does not establish representative real-repository performance. DIRECT versus selective compares strategies; it does not by
itself compare baseline and candidate harness revisions. Evaluate each revision
under matched conditions. The runner now reconciles native whole-workflow usage
and reports measurement coverage; see the [evaluation reference](../../../docs/reference.md#validation-and-evaluation).
Do not claim cost savings when cost counters, correlation or lifecycle coverage are incomplete.

Run the commands from each frozen checkout into separate fresh output directories.
Each revision needs its own matched smoke report: a baseline smoke cannot satisfy
the readiness gate for a changed candidate fingerprint. Preserve `report.json`, `attempts.json`, protocol
records and relevant native references for both revisions. Inspect the expected
case/repetition matrix for missing trials before comparing per-strategy outcomes.
The runner alternates strategy order within a revision; it does not pair revisions
or control time effects between separate runs. Predeclare revision order and report
provider/cache or machine-load differences as confounders. Cross-revision matching
and the decision remain a review procedure, not an automated runner feature.

Report verified successes/attempts, independent behavior/regression/scope outcomes,
cost and token coverage, missing lifecycle/correlation evidence and per-case
variability for each revision and strategy. Cost per verified success is the cost
of **all** attempts divided by verified successes, available only with complete
cost, correlation and lifecycle coverage and at least one success. Token categories
have separate coverage; missing tokens do not invalidate otherwise complete cost.
Do not substitute the partial observed-cost sum for total cost.

Recommend **ADOPT** only when predefined criteria are met with adequate coverage,
**REJECT** for a demonstrated regression or adequately measured unmet benefit, and
**INCONCLUSIVE** for insufficient samples, uncontrolled comparisons or missing
measurements. State the decisive results and unresolved alternatives. On ADOPT,
identify the reviewed candidate, rollback trigger and exact revert target; on
REJECT retain the baseline; on INCONCLUSIVE retain it and name the next evidence
needed. Never automatically change prompts, permissions or routing from a report.
