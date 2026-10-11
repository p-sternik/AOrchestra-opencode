# Changelog

Release Please maintains future entries from Conventional Commits. Earlier local
iterations are described below for context; they are not historical Git tags.

## 0.2.2 (2026-10-11)

### Features

- Collect local execution metrics through native OpenCode hooks and events, including DIRECT executions.
- Export metadata and generate on-demand reports grouped by harness version and execution strategy.
- Distinguish runtime completion, observed verification, missing usage and incomplete execution records.
- Suggest evidence-linked improvement hypotheses without changing the active policy automatically.

### Repository and release tooling

- Publish the first repository baseline with English installation, architecture, validation and contribution documentation.
- Add Windows/Linux CI and automated version/changelog/release PR generation.
- Read the runtime harness version from package.json to keep telemetry aligned with releases.
- Keep test and evaluation scratch files inside the checkout; ship one current repo-context skill copy.

### Earlier local iterations included in this baseline

- **0.2.1:** bundled explicit-only repo-context skill, existing-pattern-first instructions and primary native-edit scope checks.
- **0.2.0:** native OpenCode V2 sessions and permissions, selective delegation, persisted contracts, bounded attempts and evidence-based acceptance.

### Validation limits

Mechanism tests and native smoke checks have passed locally. Real-model cost and
effectiveness benchmarks have not been run. This release makes no performance
claim against FoundationAgents/AOrchestra or other harnesses.
