# Contributing and releases

Keep changes small, reuse existing patterns and add tests that demonstrate changed
behavior. Installation is in [README.md](README.md); the full check commands are
in the [technical reference](docs/reference.md#validation-and-evaluation). Native
smoke checks require OpenCode 2.0.26; model evaluation is opt-in and can incur
provider costs.

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
2. Review the generated version, CHANGELOG.md, package.json, package-lock.json and
   `.release-please-manifest.json`. The same workflow explicitly validates the
   generated release branch; GITHUB_TOKEN-created PRs do not trigger normal PR CI.
3. Merge the release PR after checks pass. The next main workflow creates a plain
   numeric tag (for example `0.2.3`) and a GitHub Release.

No additional token secret is required. The repository must allow GitHub Actions
to create pull requests. Workflow permissions are scoped to the release job.
Run Release through Actions' **Run workflow** when you need to retry after fixing
an infrastructure failure. Do not edit an existing released tag or manually bump
the version during normal development. Telemetry imports package.json so there
is no second runtime version string to update.

The initial 0.2.2 release is bootstrapped manually. Earlier local 0.2.0/0.2.1
iterations are recorded as context in its changelog, not invented historical tags.

## Packaging and distribution

`npm run pack:check` packs a real archive, installs it with production dependencies,
imports the plugin and runs CLI help on Windows/Linux CI. The package ships its
TypeScript entrypoint for the Bun-based OpenCode host, instructions and skill;
the Node CLI shim invokes Bun. No install lifecycle scripts are required.

GitHub main distribution works through npm/npx Git package specifiers without npm
publication. The setup CLI pins the plugin to a Git commit and delegates downloading
to native OpenCode plugin add. Registry publication is a separate operation after
an appropriate Release Please version is merged and npm authentication is available:

```sh
npm run pack:check
npm publish --access public
```

No npm token is stored in this repository or release workflow. GitHub Releases do
not automatically publish npm packages. Update README distribution status only
after confirming the registry publication.

Compare releases:

```sh
git fetch --tags
git diff 0.2.2..0.2.3
git log --oneline 0.2.2..0.2.3
```

To inspect a released harness, check out its tag. Retain backups of native
OpenCode state before testing compatibility across releases; a code checkout
does not roll back storage or changes made to a target repository.
