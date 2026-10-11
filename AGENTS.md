# Working on AOrchestra

These instructions apply to development of this harness repository. When asked
to configure it for another project, follow [docs/setup-for-agents.md](docs/setup-for-agents.md).
Keep that project's own instructions and configuration.

## Changes

- Find the nearest existing implementation and test before choosing a design.
  Prefer a focused replacement, reuse or removal over a new layer or rewrite.
- Use native OpenCode sessions, permissions and storage. Match the API packages
  pinned in package.json; inspect installed types/source before using newer docs.
- Read [docs/reference.md](docs/reference.md) for changes to delegation, acceptance,
  permissions, snapshots or telemetry. Read [RESEARCH.md](RESEARCH.md) when revisiting
  architectural choices. Preserve the distinction between runtime success and
  semantic verification, and between missing usage and measured zero.
- Write documentation and user-facing messages in English. Keep details in linked
  references and update existing documentation when behavior changes.

## Verification

Use package.json scripts and the check commands in
[docs/reference.md](docs/reference.md#validation-and-evaluation). For code changes,
run typecheck and relevant behavior tests; for native API/configuration changes,
also run the no-inference smoke check. For documentation-only changes, check links,
code examples and the diff. Paid/model-backed evaluation is opt-in.

Finish with the observed results and remaining gaps. Consult
[VALIDATION.md](VALIDATION.md) before making effectiveness or isolation claims.

## Releases

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for Conventional Commits and Release Please.
Keep release tags immutable; normal development does not manually bump versions.
Runtime telemetry reads its version from package.json.
