# Changelog

All notable changes to this package are documented here.

## 0.7.0 — 2026-08-27

### Adaptive Delivery rescue

- Replaced Frontier/Wayfinder-as-default with Direct, Ticketed, and Governed
  routing. Direct is the default; Governed requires an enumerated
  high-consequence condition.
- Added an explicit delivery state machine with two semantic repair rounds, one
  classified flaky rerun, hypothesis-novelty enforcement, and terminal
  alternate-route, reduced-scope, defer, or abort outcomes.
- Added `delivery-loop`, `execute-delivery`, `review-change`, and
  `repair-change`. Legacy Frontier review/repair entry points remain as
  one-release deprecation shims.
- Made runtime debugging and interactive GUI inspection conditional read-only
  reviewer capabilities, with `INSUFFICIENT_EVIDENCE` when unavailable.
- Introduced configuration version 4 and profile version 3. Upgrades map older
  Frontier configurations to `execution.method: adaptive` and
  `execution.defaultMode: direct` through the sealed plan/apply transaction.
- Prohibited failure-driven generation of successor tickets, decision files,
  executable validators, and repair evidence trees.
- Preserved locally modified consumer skills with managed three-way upgrade
  behavior; legacy managed artifacts are removed only when unchanged from their
  recorded baseline.

## 0.6.1 — 2026-07-29

### Upgrade portability and preservation

- Preserved workspace-module commands during Windows upgrades and made generated
  workspace hashes insensitive to CRLF/LF materialization.
- Kept Git evidence available in disposable verification copies while excluding
  only planned or finalized operational artifacts from upgrade fingerprints.
- Preserved existing Codex and OpenCode host bundles through adoption and
  upgrades without weakening the default managed-projection behavior.

### Projection and contract safety

- Made disabled projection mode a successful zero-write operation for direct
  `sync` and skill updates; explicit requests for protected projection targets
  now fail before any write.
- Required every executable ticket contract to provide at least one nonblank
  exact verification command. Aggregate-only and historical records remain
  explicitly non-executable.
- Kept finalized process receipts as evidence while preventing them from making
  a clean workspace appear dirty; open leases remain completion blockers.

## 0.6.0 — 2026-07-24

### Frontier Loop workflow

- Replaced the former generic planning/implementation skill set with a local-file-based Frontier Loop.
- Added separate repository skills for Wayfinder planning, master-plan compilation, dependency-frontier execution, ticket implementation, independent review axes, targeted repair, neutral integration, test topology, process lifecycle, documentation retrofit, and ticket-pack retrofit.
- Preserved the useful executor → reviewer → repair-until-pass discipline while allowing read-only planning and review work to run concurrently and keeping one writer by default.
- Added risk lanes, conflict keys, expected write sets, verification levels, architecture budgets, authority gates, and stop/split conditions to ticket contracts.

### Models and harnesses

- Set GPT-5.6 Sol with high reasoning as the coordinator and planning default.
- Set `sol-only` as the default, using GPT-5.6 Sol high for every role, and
  retained the historical `sol-codex` split with GPT-5.3 Codex high for
  delegated engineering roles.
- Added project-local Codex custom-agent definitions, a three-child-agent cap, read-only reviewer/planner roles, write-limited implementation roles, and Stop/SubagentStop process-lease guards.
- Added equivalent OpenCode role prompts and permission boundaries.

### Safe adoption and durable plans

- Added first-class `adopt` and `retrofit` commands, separate from `create` and from `create --force`.
- Added one seamless `upgrade` command for generated and adopted workspaces:
  direct atomic apply, console/JSON dry-run, automatically named saved plans,
  exact saved-plan replay, managed-section preservation, three-way skill and
  projection reconciliation, sealed pre/post verification, durable transaction
  evidence, stale-plan rejection, and automatic rollback.
- Added read-only repository/workspace inspection, deterministic operation classification, persisted immutable plans, repository/file/Git fingerprints, stale-plan rejection, integrity checks, additive instruction proposals/managed blocks, idempotent apply, and adoption reports.
- Added durable `docs/agent/` state, architecture/test/process policies, local evidence directories, and migration of existing local ticket tracks into Frontier contracts without replacing their prose.
- Added workspace-aware adoption with scoped module metadata and nested instructions only where module policy materially differs.

### Advanced operations

- Added npm-family, Cargo, and Flutter/Dart workspace discovery with manifest-declared dependency edges, lockfile ownership, opaque-node preservation, affected-module selection, dependency-aware bounded-concurrency verification, and deterministic result ordering.
- Added explicit tooling plans and controlled native package-manager execution for npm, pnpm, Yarn, Bun, Cargo, and Flutter/Dart. Network, runtime dependencies, and lifecycle scripts require explicit authority. Reviewed mutation boundaries are validated and restored on failure where promised.
- Added project-owned skill baselines, incoming catalog/risk comparison, deterministic per-file three-way merging, atomic or explicit partial updates, removal/risky-tool gates, and projection synchronization.
- Added checkpointed, behavior-preserving source moves with conservative location-aware JavaScript/TypeScript/React, Rust, and Dart/Flutter reference rewrites. Dynamic/generated/ambiguous relationships fail closed.
- Added source-located architecture/effect assessment and bounded one-use-case alignment plans. Manual and configured-command executors operate one structured task at a time, while the CLI independently validates actual diffs, allowed paths, file/diff budgets, verification, nested-plan authority, and stop conditions.

### Operational safety and quality

- Added managed command leases, process-group/Windows Job Object ownership, deadlines, bounded output, and zero-descendant completion checks.
- Added architecture/test-file ratchets and megafile no-growth policies.
- Added dependency-free Python fallback parsing for all installed retrofit/budget scripts; PyYAML is no longer required.
- Expanded source tests to persisted-plan round trips, monorepo adoption, package-manager authority/rollback, skill-update merge/risk cases, checkpoint recovery, source restructuring, architecture alignment, Python fallback execution.
- Added an actual packed-tarball smoke test covering creation, adoption, workspace verification, offline local-package installation, mechanical restructuring, skill update inspection, and the manual alignment stop gate.

### Documentation and release

- Added a complete usage guide, Frontier/advanced-operation architecture guides, a self-contained HTML user guide, updated security and validation records, and the original retrofit program plan under `docs/plans/`.
- Package contents now include the release documentation.

## 0.1.0 — 2026-07-11

- Initial npm/npx project creator.
- Rust, TypeScript, JavaScript, React, and Flutter targets.
- `simple`, `functional-core`, and `clean` implementation profiles.
- `strict`, `pragmatic`, and `off` TDD modes.
- Generated `AGENTS.md`, machine-readable profile, dependency snapshot, and ten canonical local skills.
- Claude, Codex, Copilot, Cursor, OpenCode, and Gemini projections.
- `sync` and `doctor` commands with static skill validation and drift checks.
