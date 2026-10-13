# Context documents

Prefer the repository's established paths. With no convention, use `docs/agent-context/`. The index remains `repo-map.md`; the rest are on-demand explanations. Root AGENTS.md contains the route to the index, not a second architecture manual.

Adapt scope to the evidence. In a greenfield repository, record the available manifests,
instructions and requested intent; mark unimplemented modules, flows and checks unknown.
For brownfield or legacy code, trace existing consumers and compatibility tests before
describing a boundary; conflicting comments and implementations stay visible. In a
monorepo, identify workspace manifests and nested AGENTS.md, then map the requested
packages and confirmed cross-package consumers. A directory name alone proves neither
ownership nor a dependency. Use native search/LSP for relationships; do not add a
framework parser or graph engine without a reproducible gap in those tools.

## Index: repo-map.md

State scope, last verified date/revision, dirty-tree caveat and coverage in a compact provenance paragraph. Then provide a navigation table:

| Area               | Responsibility              | Entry / important symbols     | Consumers / tests     | Detail                          |
| ------------------ | --------------------------- | ----------------------------- | --------------------- | ------------------------------- |
| Actual module name | One concrete responsibility | Source link and stable symbol | Evidence-backed paths | Existing explanation, if useful |

Add a short “start here for…” list for common traced workflows. Technologies appear only where they help navigation, with manifest/config evidence. Rank selected entrypoints, frequently referenced interfaces and boundary modules ahead of implementation details. Confirm important relationships before explaining them. Include missing context explicitly instead of guessing ownership or calling an observed utility a domain boundary.

If a service has its own large map, link it from the root index. A map may contain incomplete or inferred relationships if they are labeled; it must not claim whole-repo coverage from a bounded sample.

## Architecture: architecture.md

Capture implemented module boundaries, dependency direction, persistence and external systems. A small Mermaid diagram helps only when its edges have evidence. Link ADRs explaining why a boundary exists. Separate observed structure, intended design and unresolved inconsistencies. Deployment topology requires deployment evidence; package layout is not enough.

## Domain: domain.md

Capture terms, important states and transitions, business invariants, compatibility expectations and data ownership. Cite implementation/tests separately from a human-confirmed rule. A repeated code pattern is not automatically business intent. Do not invent a domain glossary from class names. If business intent is unavailable, record the ambiguity and what evidence/person can resolve it.

## Verification: verification.md

For a task area, provide the source of the command, environment prerequisites, expected evidence and last observed execution result. Distinguish characterization/reproduction, regression, compatibility and broader checks. Record pre-existing failures so future agents do not attribute them to their patch. Identify gaps: mocked integrations, missing old-client coverage, flaky behavior, unavailable external systems. A command copied from a manifest remains “not run” until observed.

## Flow: flows/<real-flow>.md

Choose important behavior spanning boundaries. Trace trigger → entrypoint → domain decisions → persistence/external side effects → response/event/consumer. Include transaction boundaries, retries, failure behavior and ordering where confirmed. Cite the source at each consequential transition and the tests covering it. Use a sequence diagram only for a traced sequence; mark inferred branches directly.

## Module: modules/<actual-module>.md

Explain a difficult subsystem's public entrypoints, consumers, local conventions, legacy quirks, invariants and verification seams. Reference the domain/architecture explanation rather than repeating it. Create this file when the detail is useful beyond the current task.

## Evidence and source hierarchy

Use implementation and observed runtime behavior for what the system does, tests for behavior they cover, manifests for declared configuration, and ADRs/human input for intent. Contradictions stay visible until resolved. A source dependency recorded for freshness is not a substitute for the claim's source link and symbol.

## Design sources

[Aider repo map](https://aider.chat/docs/repomap.html) uses selected definitions/signatures and task-relevant ranking under a token budget. This skill adopts compact navigation and selective loading. Its standard-library helper has Python AST and conservative regex candidates, **not** Aider's Tree-sitter/reference graph/PageRank engine. No Aider source is copied and Aider is not a dependency.

[Evaluating AGENTS.md](https://arxiv.org/abs/2602.11988) found negative effects from unnecessary context requirements in the tested settings. It motivates keeping always-loaded policy short; it does not prove that every map or project-specific instruction hurts performance.

[OpenCode skills](https://opencode.ai/v2/docs/skills) loads SKILL.md and supporting references on demand. Use existing native read, grep, glob and LSP to confirm semantic relationships.
