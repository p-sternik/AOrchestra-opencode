---
name: repo-context
description: "Create or update a repository map and AGENTS.md navigation when the user requests repository documentation or onboarding."
metadata:
  opencode/autoinvoke: false
---

# Repo Context

Maintain compact navigation to repository evidence on user request. Ordinary coding reads existing maps and searches current code directly; it does not start a documentation workflow. This is inspired by Aider's selective repo-map, not a reproduction of its ranking engine.

## Workflow

1. **Scope.** Identify the requested repository/subproject, documentation language, existing index and applicable root/nested AGENTS.md. Reuse established docs and ADRs. Done when the target and active conventions are known; a code change alone does not request a scaffold.
2. **Evidence.** Use native read/grep/glob and available LSP to find entrypoints, relevant implementations, callers and tests. The optional helper `scripts/repo_context.py index --root <repo> --focus <term>` supplies a bounded file/symbol index; regex candidates need source confirmation. Done when selected areas have sources and visible unknowns. Label claims observed, inferred or unknown; names/imports alone do not establish flows or business intent.
3. **Map.** Read [references/documents.md](references/documents.md) when choosing or creating a document. Start with one short repo-map.md, including verification pointers when they fit. Split substantial architecture/domain/flow details only when requested or useful beyond the index. Update by focused patches; preserve useful authored text and remove obsolete duplication. Done when factual entries point to current sources and unconfirmed interpretations are labeled, with no empty hierarchy.
4. **Navigation.** Read [references/maintenance.md](references/maintenance.md) for updates, freshness checks or AGENTS.md merging. Preserve authored policy and filename case; update an existing pointer instead of duplicating it. The optional `agents` helper updates only its marked block and supports `--language pl`. Done when the pointer works and surrounding instructions are preserved.
5. **Check.** Verify source links, claimed symbols and the relevant diff. Commands remain explicitly not run until observed. The optional `record` helper stores inspected source hashes and `--scope <directory>` inventories; `check` reports changed sources, added/removed scoped files and broken local links. Hashes do not verify semantics. Preserve existing provenance conventions. Done when checks pass or uncovered/stale areas are explicitly reported.

## Boundaries

Keep a short index and load details only for the task. Prefer existing patterns and exact replacements over regenerated documents. Context docs explain the project; they never grant permissions. Mapping does not authorize deployments, migrations or paid services. Keep secrets and customer records outside the map.

The helper uses Python standard library and is optional. Read its `--help` for arguments. It parses Python symbols with AST and uses candidates for other languages; native language tools establish consequential relationships.

Return created/updated paths, evidence coverage, preserved AGENTS.md policy and remaining unknowns. An AOrchestra handoff needs only relevant entrypoints/consumers, behaviors to preserve and suggested verifiers.
