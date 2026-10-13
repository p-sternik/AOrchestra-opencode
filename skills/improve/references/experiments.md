# Reviewing an improvement experiment

Specify one hypothesis and the smallest candidate change. Identify the baseline
and candidate revisions, changed files, task cases, model/provider settings and
budgets. Use development cases to formulate the change; reserve independent holdout
cases for assessment. Do not tune on holdout outcomes.

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

The `eval:run` commands invoke paid/provider-backed models and require separate
explicit authorization. Benchmark repetitions require a matched successful fixture
smoke for both protocols. Paired order alternates across repetitions; DIRECT has
native session delegation denies, while SELECTIVE retains normal routing. The corpus contains three smoke cases and ten synthetic brownfield cases in
separate development/holdout files; see the [benchmark methodology](../../../docs/benchmark.md).
It does not establish representative real-repository performance. DIRECT versus selective compares strategies; it does not by
itself compare baseline and candidate harness revisions. Evaluate each revision
under matched conditions. The runner now reconciles native whole-workflow usage
and reports measurement coverage; see the [evaluation reference](../../../docs/reference.md#validation-and-evaluation).
Do not claim savings when counters, correlation or lifecycle coverage are incomplete.

Recommend **adopt** only when the predefined criteria are met with adequate
coverage, **reject** for a demonstrated regression or unmet benefit, and
**inconclusive** for insufficient samples, uncontrolled comparisons or missing
measurements. Keep uncertainty and per-trial outcomes visible. Adoption is a
reviewed versioned change with a rollback path, never an automatic skill action.
This PR does not add an experiment registry or execute these comparisons.
