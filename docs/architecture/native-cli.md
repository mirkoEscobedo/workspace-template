# Native CLI architecture

workspace-template is a Windows x64 Rust executable distributed as a dependency-owned npm artifact. It has no JavaScript fallback, downloader, lifecycle script, preset engine, or generated host-agent layer.

## Public command surface

- `instructions` returns the Adaptive Delivery state machine, limits, host-owned model policy, and embedded asset identity.
- `route` selects Direct, Ticketed, or Governed mode. It does not choose models or instantiate agents.
- `inspect` identifies one root project topology and thin-state presence without mutation.
- `doctor` checks schema-v2 project identity, platform artifact identity, executable and embedded-asset hashes, and capability availability.
- `verify` runs the root Flutter, Rust, npm, or pnpm topology with bounded output, timeout, and Windows Job Object containment.
- `adopt plan/apply` and `upgrade plan/apply` use content-hashed sealed plans, repository fingerprints, safe relative paths, staging, backup, rollback, stale-state rejection, and interrupted-transaction recovery.
- `skills list/show` exposes exact embedded package-owned methodology without copying it into consumers.
- `skills update` is non-mutating and directs callers to their package manager followed by sealed upgrade.
- `update status` compares the exact manifest dependency, lock resolution/integrity, installed package, running binary, and project-state artifact identity without writing.
- `help`, `--help`, `version`, and `--version` use the same JSON envelope as every command.

JSON is the only output format. `--json` explicitly selects that default and is recognized once for compatibility. Stable exits are 0 success, 1 failed/incomplete evidence, 2 stale plan, 3 conflict or unapproved downgrade, 64 usage/unsupported portable capability, 66 missing skill, and 69 unsupported platform.

## Assets, state, and updates

`assets/skills/inventory.json` declares the exact 13-skill set. The build embeds every product asset, and tests compare the complete on-disk and embedded inventories byte-for-byte.

Thin state schema v2 records package name, logical release version, source and release commits, embedded-asset and release-manifest hashes, and platform-keyed artifact identity. Package managers exclusively own manifests, resolution, installation, and lockfiles. Sealed upgrade owns project state, managed instruction/ignore blocks, and hash-safe retirement of old generated material.

## Process boundary

On Windows, verification starts the root suspended, assigns it to a kill-on-close Job Object, resumes it, bounds output, and terminates the job on timeout or root completion. Cancellation closes the owning process and job, removing detached descendants. Commands outside this topology require a host-owned process provider.

## Deliberately absent or deferred

Rich workspace-graph inspection, affected-module scheduling, scaffolding, Dart/Flutter and Node Inspector adapters, and non-Windows binaries are deferred pending evidence. The qualified Microsoft CDB path remains read-only and is discovered from a path-free qualification record plus host environment. Skill projection/synchronization, presets, tooling execution, copied-skill merging, retrofit writers, architecture alignment, restructuring, and Frontier orchestration are outside the portable product boundary.
