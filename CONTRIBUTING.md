# Contributing and releases

Keep changes small, reuse existing patterns and add tests that demonstrate changed
behavior. Installation is in [README.md](README.md); the full check commands are
in the [technical reference](docs/reference.md#validation-and-evaluation). Native
smoke checks accept stable OpenCode >=2.0.26 <3.0.0 (tested runtimes: 2.0.26 and 2.0.27);
model evaluation is opt-in and can incur provider costs.

Run `npm run format` before submitting changes and `npm run format:check` to check
formatting without writing files. Prettier is pinned in development dependencies;
CI checks formatting once on Linux. Dependencies, generated output and
local credentials are excluded through `.prettierignore` and `.gitignore`.
`CHANGELOG.md` is excluded from Prettier because Release Please generates its
entries; release PRs still run formatting checks for source and other documentation.
Keep formatting-only changes in a separate commit from behavior changes when
possible. Formatting supplements typecheck and behavioral tests.
Markdown keeps double-quoted front matter because the bundled skill loader reads
description values as JSON strings.

## Commit messages

Use English Conventional Commits and retain the prefix in squash-merge titles:

```text
fix: preserve verifier freshness after an edit
feat: add a bounded repository index
perf: avoid redundant snapshot hashing
docs: clarify installation on Windows
feat!: change the task contract schema
```

`fix` bumps patch; `feat` bumps minor. Breaking changes bump minor while below
1.0.0, and major at/above 1.0.0. The visible changelog sections configured in this
repository also allow documentation, refactoring, test and CI changes to produce
a patch release PR. Ordinary Git history records every commit regardless.

## Automatic releases

1. Ordinary PRs run Validate on Windows and Linux. Updated PRs cancel their
   obsolete checks. Checkouts use the event's immutable SHA; reusable validation
   can supply another exact SHA. Standalone Validate does not run on main pushes.
2. Merge changes into `main`. Ordinary pushes start validation directly, skipping
   the continuation-only evidence lookup job. Release owns main validation and then creates or
   updates a Release Please PR. Generated release titles and commits include
   `[skip ci]`, suppressing the redundant approval-required PR workflow.
3. Release explicitly calls reusable validation for the generated PR's immutable
   head SHA on Windows and Linux, then automatically squash-merges that exact
   revision. The skip marker does not suppress this workflow call. Failed checks
   or a changed revision prevent the merge. Only the same-repository Release Please
   PR targeting main, authored by github-actions[bot] and labeled
   `autorelease: pending`, is eligible. Ordinary PRs still require normal review.
4. After merging, the workflow explicitly dispatches Release on main with the
   source run, validated PR SHA and resulting merge SHA. It reuses validation only
   when the event SHA equals that merge SHA, the source Release run completed
   successfully, and its validation artifact records an identical Git tree.
   The evidence lookup job records the inherited receipt using its existing checkout.
   Different content or unavailable evidence runs the full matrix again. Release
   then creates a plain numeric tag (for example `0.2.3`) and a GitHub Release.
   GITHUB_TOKEN merges do not trigger push workflows, so this dispatch is required.
5. npm publication requires validation evidence for the exact tagged commit and
   tree. It can use the current run or a successful prior Release run, including
   a tag-only retry. Missing or expired evidence triggers full reusable validation
   of the tag's resolved SHA. Publication checks that the tag still identifies
   that SHA, checks the version and real package archive, and compares registry
   integrity before publishing. Dependency installation, typecheck, behavior tests and consumer package tests
   are not repeated in the publication job. The source-only package is packed
   without dependencies or lifecycle scripts.

Reusable validation stores a small SHA/tree artifact only after the entire
Linux/Windows matrix succeeds. Artifacts include repository, run and attempt
identity and are retained for 90 days. Identical post-merge content gets a new
receipt for its merge SHA. Failed/cancelled runs, other workflows, other branches
and fork repositories cannot supply reusable evidence. Manual continuation inputs
select evidence; they never authorize skipping checks on their own.
Formatting, typecheck, corpus, Python helper and version checks run once on Linux
Node 24. Behavior tests and consumer package checks run on two lanes: Windows
Node 22 (the supported floor) and Linux Node 24/npm 12 (the publication toolchain).
Bun is pinned identically in both lanes; Linux Node 22 is no longer a separate lane.
Dependency installs prefer the existing npm download cache and skip audit/funding
requests. A cache miss still performs the locked install.

Reusable validation has separate concurrency groups for each caller run/ref;
release stages cannot cancel one another. Release executions remain serialized,
with running executions protected from cancellation. A manual `publish_tag` retry
skips main validation and Release Please entirely and retries only the requested
existing tag. It reuses successful validation when available, otherwise validates
that tag with the full matrix. It must be dispatched from main.

The generated skip marker is limited to release commits. A branch rule requiring
standalone PR checks that the marker skips would leave the release PR pending and
prevent its merge. This automation does not change or bypass repository rules;
review check requirements before enabling such rules. See GitHub's
[skip behavior](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs).

No additional token secret is required. The repository must allow GitHub Actions
to create pull requests and allow squash merges. Existing branch protection and
review requirements remain enforced by GitHub; requirements for a human review
can prevent automatic release PR merging. Write permissions are scoped to the
release and merge jobs; only the merge job receives actions: write for dispatch.
Run Release through Actions' **Run workflow** when you need to retry after fixing
an infrastructure failure. Do not edit an existing released tag or manually bump
the version during normal development. Telemetry imports package.json so there
is no second runtime version string to update.

README uses npm and CI badges. The npm badge reflects registry publication;
compatibility and published-versus-main feature notes are verified separately.
The tested OpenCode version stays explicit and changes
only after compatibility validation. README content bundled in a published npm
archive remains the documentation for that release; publishing a new release does
not rewrite older archives.

The initial 0.2.2 release is bootstrapped manually. Earlier local 0.2.0/0.2.1
iterations are recorded as context in its changelog, not invented historical tags.

## Packaging and distribution

`npm run pack:check` packs a real archive, installs it with production dependencies,
imports the server plugin, renders the packaged TUI sidebar and runs CLI help on
Windows/Linux CI. The fresh consumer is outside the checkout, with production
dependencies only and no project tsconfig or Solid JSX preload. The package ships its
TypeScript entrypoint for the Bun-based OpenCode host, instructions and skill;
the Node CLI shim invokes Bun. No install lifecycle scripts are required.

Stable distribution uses npm/npx with an exact installed version. GitHub main
distribution remains an explicit development channel through Git package specifiers.
The setup CLI pins the plugin to the CLI version or a main Git commit and delegates
downloading to native OpenCode plugin add. Registry publication is a separate operation after
an appropriate Release Please version is merged and npm authentication is available:

```sh
npm run pack:check
npm publish --access public
```

No npm token is stored in this repository or release workflow. Automatic npm
publication uses the publish-npm job in release.yml and requires the package owner's
Trusted Publisher configuration plus NPM_PUBLISH_ENABLED=true. In the package's
npm settings, configure `p-sternik/AOrchestra-opencode`, workflow `release.yml`,
without a GitHub environment, and enable direct publishing. Check
`npm view aorchestra-opencode-v2 version`
for the latest published version; describe a new version as published only after
confirming its registry upload. Retries verify registry archive integrity
against the exact release tag before skipping an existing version.

Compare releases:

```sh
git fetch --tags
git diff 0.2.2..0.2.3
git log --oneline 0.2.2..0.2.3
```

To inspect a released harness, check out its tag. Retain backups of native
OpenCode state before testing compatibility across releases; a code checkout
does not roll back storage or changes made to a target repository.
