---
name: improve
description: "Analyze AOrchestra execution reports and propose evidence-backed harness improvements when explicitly requested."
metadata:
  opencode/autoinvoke: false
---

# AOrchestra Improve

Review AOrchestra diagnostics on explicit request. Produce at most three actionable
proposals, or state **insufficient data** and identify the missing evidence.
Ordinary programming tasks do not invoke this workflow.

## Evidence and diagnosis

Use the supplied Markdown report or version-1 metrics export. If collection is
requested, establish the project and native database first; do not assume that the
current directory produced an unidentified report. From a harness checkout use:

```sh
bun run report -- --project=/absolute/project --output=/path/report.md --export=/path/metrics.json
bun run report -- --input=/path/metrics.json --output=/path/offline-report.md
```

Outside the checkout use the installed `aorchestra report` command with the same
options. Collection and offline rendering make no model calls. Keep generated
artifacts outside tracked files. A supplied report can be analyzed without running
the command again. Read [references/diagnosis.md](references/diagnosis.md) before
interpreting coverage, cost or recurring signals.

Locate the relevant harness implementation, instructions and nearest tests for
each finding. Use the installed bundle for its version or a matching source
checkout; do not treat a different revision as the implementation that generated
the report. Keep observations separate from hypotheses. Native trajectories may
resolve ambiguity when available, but do not copy prompts, arguments, raw errors
or credentials into proposals. Cite session/run references and source locations.

Rank findings by evidence and likely impact, not by delegation count. Repeated
inspection does not establish unnecessary work. If the report alone cannot show
why an operation repeated, propose targeted trajectory review before a policy
change. Unknown costs cannot establish savings. The three-run report threshold is
a descriptive heuristic, not statistical significance.

## Proposals

Return each proposal using these fields (a documented output contract, not a
runtime schema):

```ts
interface ImprovementProposal {
  observation: string;
  evidence: string[];
  hypothesis: string;
  confidence: 'low' | 'medium' | 'high';
  targetFiles: string[];
  proposedChange: string;
  expectedBenefit: string;
  potentialRegression: string;
  validation: { method: string; successCriteria: string[] };
}
```

Evidence must support the observation; confidence describes the hypothesis and
must explain unresolved alternatives. Prefer the smallest change to an existing
mechanism. Do not fill three slots when fewer findings are supported. For zero or
insufficient observations, explain what to collect rather than inventing an
optimization. Read [references/experiments.md](references/experiments.md) when
defining validation for a behavior or instruction change.

Finish with data coverage, proposals and remaining gaps. Do not modify harness
code, instructions, permissions or model policy. Do not run paid evaluation or
create an experiment registry as part of this skill. Proposals require separate
review and implementation authorization.
