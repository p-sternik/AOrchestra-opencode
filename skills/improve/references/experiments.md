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
bun run eval:run -- --strategy=both --repeat=3
```

The second command invokes paid/provider-backed models and requires a separate
explicit request. The three-case corpus is smoke coverage, not a representative
brownfield benchmark. DIRECT versus selective compares strategies; it does not by
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
