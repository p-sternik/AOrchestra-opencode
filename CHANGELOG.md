# Changelog

Release Please maintains future entries from Conventional Commits. Earlier local
iterations are described below for context; they are not historical Git tags.

## [0.5.0](https://github.com/p-sternik/AOrchestra-opencode/compare/0.4.3...0.5.0) (2026-10-12)


### Features

* add managed updates and sidebar version status ([#12](https://github.com/p-sternik/AOrchestra-opencode/issues/12)) ([60ff665](https://github.com/p-sternik/AOrchestra-opencode/commit/60ff665f224d7076fdeb6e0d6e0f8f5ec413c9d7))

## [0.4.3](https://github.com/p-sternik/AOrchestra-opencode/compare/0.4.2...0.4.3) (2026-10-12)


### Bug Fixes

* accept newer stable OpenCode V2 runtimes ([#10](https://github.com/p-sternik/AOrchestra-opencode/issues/10)) ([4afff9b](https://github.com/p-sternik/AOrchestra-opencode/commit/4afff9b1a8d377c9b792c1141b76f93339b6da67))

## [0.4.2](https://github.com/p-sternik/AOrchestra-opencode/compare/0.4.1...0.4.2) (2026-10-12)


### Documentation

* show published npm version dynamically ([#8](https://github.com/p-sternik/AOrchestra-opencode/issues/8)) ([0c8552e](https://github.com/p-sternik/AOrchestra-opencode/commit/0c8552ec8c574fe0a78ff2e093ff50973d80cffd))

## [0.4.1](https://github.com/p-sternik/AOrchestra-opencode/compare/0.4.0...0.4.1) (2026-10-12)


### Bug Fixes

* support npm 12 release archive metadata ([#6](https://github.com/p-sternik/AOrchestra-opencode/issues/6)) ([8ceb217](https://github.com/p-sternik/AOrchestra-opencode/commit/8ceb217acded5c887951edc63749dd0fac95d408))

## [0.4.0](https://github.com/p-sternik/AOrchestra-opencode/compare/0.3.0...0.4.0) (2026-10-12)


### Features

* add durable workflow and native verification controller ([#3](https://github.com/p-sternik/AOrchestra-opencode/issues/3)) ([f681e4a](https://github.com/p-sternik/AOrchestra-opencode/commit/f681e4aabe2862be1ad64c848485bd4d6bb42c15))
* improve release reliability and routine permissions ([#4](https://github.com/p-sternik/AOrchestra-opencode/issues/4)) ([41c5392](https://github.com/p-sternik/AOrchestra-opencode/commit/41c5392b8eca059037f3d3f7450d4170445b1c0a))


### Bug Fixes

* isolate harness agents and modernize release automation ([efec229](https://github.com/p-sternik/AOrchestra-opencode/commit/efec229e6acaa262a07610ebcaf828d172154e99))


### Continuous Integration

* automatically merge validated release PRs ([#5](https://github.com/p-sternik/AOrchestra-opencode/issues/5)) ([9a78bd1](https://github.com/p-sternik/AOrchestra-opencode/commit/9a78bd11a13966fc5fcfc2c75c6fe500e6d4881d))

## [0.3.0](https://github.com/p-sternik/AOrchestra-opencode/compare/0.2.2...0.3.0) (2026-10-11)


### ⚠ BREAKING CHANGES

* delegation requires a structured handoff on the task or call; fast analysis requires analysisMode lookup. Existing tasks can provide a handoff without changing their id.

### Features

* add installable plugin package and global setup CLI ([45db2f9](https://github.com/p-sternik/AOrchestra-opencode/commit/45db2f99d066136854edb285e951230438fc4eeb))


### Bug Fixes

* preserve provider sign-ins during model discovery ([2954c05](https://github.com/p-sternik/AOrchestra-opencode/commit/2954c056f3ba5d578b5d141fc548a8dc1230a2e6))
* require source handoffs and refine research routing ([dfdb157](https://github.com/p-sternik/AOrchestra-opencode/commit/dfdb157404dd5147ba1c69f59618a0aa6919efe3))
* support npm 12 Git installs and transient Windows cleanup locks ([2ac910a](https://github.com/p-sternik/AOrchestra-opencode/commit/2ac910a8e6afa334a3fa14d7edbbbe82fb5d7925))
* validate global installation and document configuration merging ([9c26e2a](https://github.com/p-sternik/AOrchestra-opencode/commit/9c26e2a0361cee43cc3b30e511a192e5a10a9f11))


### Documentation

* add agent-assisted setup and contributor instructions ([722eaa6](https://github.com/p-sternik/AOrchestra-opencode/commit/722eaa6460cf0f4a088465f955673a3b90aabeaf))
* clarify release behavior for documentation changes ([b6bc09a](https://github.com/p-sternik/AOrchestra-opencode/commit/b6bc09aa0a054edeee750461aa1e540e74348eb0))
* credit architectural sources and visualize the workflow ([c63a8e6](https://github.com/p-sternik/AOrchestra-opencode/commit/c63a8e6cc392b155c4cd734a211e5897149b74e0))
* normalize technical reference formatting ([1716ca0](https://github.com/p-sternik/AOrchestra-opencode/commit/1716ca0f610da7b3e9ea41727ea5b424b516156e))
* simplify onboarding and separate the technical reference ([e7df095](https://github.com/p-sternik/AOrchestra-opencode/commit/e7df0958b869bd2ad83f8b6d941de372695f161e))

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
