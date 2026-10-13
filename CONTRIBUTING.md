# Contributing and releases

Keep changes small, reuse existing patterns and add tests that demonstrate changed
behavior. Installation is in [README.md](README.md); the full check commands are
in the [technical reference](docs/reference.md#validation-and-evaluation). Native
smoke checks accept stable OpenCode >=2.0.26 <3.0.0 (tested runtimes: 2.0.26 and 2.0.27);
model evaluation is opt-in and can incur provider costs.

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

1. Merge changes into `main`. The Release workflow validates main on Windows and
   Linux, then creates or updates a Release Please PR.
2. The workflow validates the generated release PR's immutable head SHA on Windows
   and Linux, then automatically squash-merges that exact revision. Failed checks
   or a changed revision prevent the merge. Only the same-repository Release Please
   PR targeting main, authored by github-actions[bot] and labeled
   `autorelease: pending`, is eligible. Ordinary PRs still require normal review.
3. After merging, the workflow explicitly dispatches Release on main, validates
   main again and creates a plain numeric tag (for example `0.2.3`) and a GitHub
   Release. GITHUB_TOKEN merges do not trigger push workflows, so this dispatch
   is required. npm publication follows when configured.

No additional token secret is required. The repository must allow GitHub Actions
to create pull requests and allow squash merges. Existing branch protection and
review requirements remain enforced by GitHub; requirements for a human review
can prevent automatic release PR merging. Write permissions are scoped to the
release and merge jobs; only the merge job receives actions: write for dispatch.
Run Release through Actions' **Run workflow** when you need to retry after fixing
an infrastructure failure. Do not edit an existing released tag or manually bump
the version during normal development. Telemetry imports package.json so there
is no second runtime version string to update.

README uses dynamic npm and GitHub release badges rather than a second literal
harness version. The npm badge reflects registry publication; the GitHub badge
reflects release creation. The tested OpenCode version stays explicit and changes
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
Trusted Publisher configuration plus NPM_PUBLISH_ENABLED=true. Follow the
[publishing guide](docs/npm-publishing.md). Check `npm view aorchestra-opencode-v2 version`
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
