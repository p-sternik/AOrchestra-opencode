# Reading diagnostic evidence

Use the report's coverage and collection limits before ranking signals. An older
report may lack explicit coverage fields: inspect its version-1 export if supplied,
or mark coverage unknown. A truncated dataset remains partial after offline import.

- One run is a primary execution cycle, not necessarily one ticket. Separate
  harness versions; do not combine versions into an improvement claim.
- Observed terminal records include interrupted executions. Unfinished records,
  missing terminals and agent switches indicate observation gaps, not failures.
- Native success is runtime completion. Verified tracked acceptance requires the
  recorded task/verifier contract. Untracked DIRECT outcomes remain semantically
  unknown; zero tracked tasks does not mean the task failed.
- Workflow cost requires measured primary and every recorded child's cost. Failed
  children still incur usage. Missing usage remains unknown; measured zero is zero.
  The measured-record sum is not the total cost of records with unknown usage.
  Counters are estimates, not invoices, and cannot prove complete event collection.
- Any child makes a run delegated. This does not describe DIRECT work before
  delegation. Cohort differences are uncontrolled for task difficulty and selection.
- Identical inspection signatures can reflect necessary rereads after edits or
  independent verification. Only trajectory evidence can establish avoidable work.
- Provider retry decisions, task attempts and repair cycles are different signals.
  Inspect native references before classifying a task-level cause. Error categories
  are heuristic; a tool error does not establish semantic task failure.

Existing entrypoints are `lib/report.ts`, `scripts/report.ts`, `lib/telemetry.ts`,
`instructions/aorchestra.md` and their nearest tests. Consult the bundle's
`docs/reference.md` and `VALIDATION.md` before making effectiveness or isolation
claims. Synthetic smoke records are integration evidence, not productivity data.

For each observation cite session/run IDs, affected count and available denominator,
version, coverage limitations, and relevant implementation. Without sufficient
recurring evidence, recommend collection or a focused diagnostic check. Do not
interpret the absence of report hypotheses as evidence that the harness is optimal.
