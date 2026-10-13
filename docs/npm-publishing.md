# Automatic npm publication

GitHub Actions validates and packages the release; npm hosts the resulting archive.
The plugin ships TypeScript for the Bun-based OpenCode host, so a separate JS build
is not required. CI runs typecheck, behavior tests and a production package install
on Node 22 Windows/Linux and on the publication toolchain (Node 24, npm 12.2.0,
Linux). Release archive checks accept both older array-shaped npm pack JSON and
npm 12 package-keyed output.

The publish job lives in **release.yml**, alongside Release Please. A separate
release-event workflow would not reliably run for releases created by GITHUB_TOKEN.
Publishing is gated by the repository variable NPM_PUBLISH_ENABLED and the
package owner's trusted publisher configuration. Verify both before a new release.

## 1. Confirm the existing package

The package is already available on npm. Confirm its latest published version and
owner access before configuring the trusted publisher:

```sh
npm view aorchestra-opencode-v2 version
```

Do not republish an existing version. Complete any npm owner sign-in or browser/OTP
prompts locally; never send credentials to an agent or commit them. The existing
package is `aorchestra-opencode-v2`.

## 2. Configure the trusted publisher on npm

Open the package's Settings → Trusted Publisher on npmjs.com and choose GitHub
Actions. Enter these exact values:

| Field             | Value                                            |
| ----------------- | ------------------------------------------------ |
| Organization/user | p-sternik                                        |
| Repository        | AOrchestra-opencode                              |
| Workflow filename | release.yml                                      |
| Environment       | Leave blank; this job uses no GitHub environment |
| Allowed operation | Enable direct npm publish                        |

Save. New configurations initially allow staged publishing; direct publishing must
be enabled for this workflow. npm requires the first successful trusted publish
within two days of creating the connection. If it expires, recreate it before
publishing the next version. See [official requirements](https://docs.npmjs.com/trusted-publishers/).

## 3. Enable the GitHub publish job

In the repository, open Settings → Secrets and variables → Actions → Variables.
Create a repository variable named **NPM_PUBLISH_ENABLED**, value **true**.
No NPM_TOKEN secret is required. The job uses a GitHub-hosted Ubuntu runner,
Node 24, npm 12.2.0 and id-token: write to authenticate through OIDC.

## 4. Publish the next version

Merge a Conventional Commit change into main. Release Please prepares the release
PR with `[skip ci]` in its generated title/commit, avoiding the redundant
approval-required PR workflow. Release still explicitly runs Windows/Linux
validation against the exact PR SHA before automatically merging it. The workflow
explicitly dispatches Release on main
because a GITHUB_TOKEN merge does not trigger push workflows. That run validates
main, creates the Git tag/GitHub Release, then validates and publishes that exact
tagged package. No manual release PR merge is needed. The first upload
of a new version validates the trusted publisher connection.

If dispatch fails after merging, run Release manually on main with publish_tag
blank to finish creating the release. To retry an npm upload, open
Actions → Release → Run workflow on main and supply an existing
numeric GitHub release tag in publish_tag. Dispatch from main. This retry skips
main validation, Release Please and release PR creation/merging; it checks only the
requested release/tag and its package. The job checks the release and version and
skips an already published npm version only when its registry integrity matches
the archive packed from that tag. A mismatch fails for investigation; immutable
versions and tags must not be replaced. Re-running 0.3.0 after a manual upload
does not validate OIDC, because no upload occurs; use a new release for that.

The publish job validates version consistency, packs an archive and publishes that
exact archive with provenance. GitHub tag/release success and npm publish success
are separate job results. A failed npm upload does not undo the GitHub release. Inspect the publish-npm job for
authentication/repository/workflow mismatches. Existing npm versions are immutable.

## Validation limits

The workflow and package tests can be checked without npm account access. Actual
OIDC publication requires the package owner's npm configuration and is not claimed
successful until an upload occurs. The first manually uploaded 0.3.0 package has
the README from its immutable Git tag; a later release includes these new docs.
