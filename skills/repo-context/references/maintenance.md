# Targeted maintenance

## Refresh scope

Read the existing index, affected explanation and applicable AGENTS.md. Inspect the actual diff plus current contents; a file rename, deletion, new entrypoint, changed consumer contract or changed verifier can invalidate links or behavior claims. Refresh the documents whose source dependencies or explained behavior are affected. An unrelated local edit does not require whole-repo mapping.

`check` compares recorded dependencies against current bytes and checks local Markdown targets. Optional recorded directory scopes also report added/removed files. Use its affected-document list as a starting point, not a semantic impact graph; additions outside those scopes and changed consumer behavior still need native code search.

For a shallow refresh, preserve language, source links, authors' notes and unresolved questions that still matter. Replace an inference with an observation only after new evidence. Remove obsolete entries when their replacements are known; retain a deprecation/compatibility note when clients still depend on old behavior.

## AGENTS.md merge

Identify which instruction file is active for the requested scope. Root and nested instruction files can have different owners and rules. Preserve filename case. The default helper finds root AGENTS.md or root agents.md, but a repository with both distinct files requires explicit selection after reading them.

Add a conditional pointer such as: “For an unfamiliar area or a cross-module change, start with the repository map, then read only the linked module/flow and verify its source references.” Add commands or special restrictions only when they are repository-specific and supported by evidence. A skill-owned block is navigation, not authority to run tools or override surrounding policy.

When an existing equivalent pointer exists outside the managed block, update it in place. The helper owns only its marked block and fails on malformed markers; it deliberately does not attempt semantic rewriting of the rest of AGENTS.md. For an authored paragraph update, use a focused normal edit and review the diff.

## Provenance

The optional registry `docs/agent-context/.state.json` stores document hashes, source hashes, relevant directory inventories, revision and verification time. Record a document after checking its content and sources. With no registry, `check` reports freshness as untracked; working links alone do not establish freshness.

`check` lists unrecorded Markdown documents under the selected docs directory as
`untracked_documents` and reports `partial` freshness when recorded and unrecorded
documents coexist. Exit zero means no detected hash/link issue; it does not mean
complete provenance or semantic verification. Root AGENTS.md is checked for links
without requiring a provenance record. Review nested policy files explicitly.

Examples:

```text
python <skill-dir>/scripts/repo_context.py index --root <repo> --focus billing --exclude generated
python <skill-dir>/scripts/repo_context.py record --root <repo> --document docs/agent-context/repo-map.md --source src/billing.py --scope src
python <skill-dir>/scripts/repo_context.py agents --root <repo> --map docs/agent-context/repo-map.md --language pl
python <skill-dir>/scripts/repo_context.py check --root <repo>
```

The inventory respects Git ignored files when available. It does not assume every directory named build/dist/coverage is generated. Explicit `--exclude` paths narrow the candidate inventory and show examples of omitted files. Scopes are optional: choose only directories whose additions matter to the documented area.

The index defaults to 100 files, 30 symbols per file and 256 KiB per inspected file;
`--focus` ranks paths, not semantic relevance. Oversized files remain visibly unread.
Known secret filenames/directories and aliases resolving to them are rejected, but
filename filtering cannot detect credentials embedded in ordinary source. Review
the selected paths and use `--exclude` for confirmed generated or sensitive content.
Index exclusions do not carry into recorded scope inventories: choose narrower
scopes or Git ignore rules when those inventories would include generated artifacts.

`record` accepts a custom `--docs-dir` for existing layouts. For an established provenance mechanism, use that one. Check no unresolved stale source, removed symbol or invalid local link remains hidden by a generic “verified” label. External URLs and heading anchors need manual checks when their validity matters; the helper validates local file targets only.

## Task handoff

For a particular change, return a small evidence slice: entrypoints, relevant callers, observed behavior, preservation constraints, verifier sources and remaining uncertainty. Avoid attaching every documentation file to the executor. Re-read code before editing because the map is a maintained cache, not the source of truth.
