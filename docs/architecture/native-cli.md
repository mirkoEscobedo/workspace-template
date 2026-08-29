# Native CLI architecture

workspace-template is a Windows x64 Rust executable distributed directly by the OS/architecture-specific `workspace-template-win32-x64` package. The command remains `workspace-template`. There is no JavaScript dispatcher, meta-package, fallback, downloader, lifecycle script, preset engine, or generated host-agent layer.

## Public command surface

- `instructions` returns the Adaptive Delivery state machine, limits, host-owned model policy, and embedded asset identity.
- `route` selects Direct, Ticketed, or Governed mode. It does not choose models or instantiate agents.
- `inspect` preserves its root detection fields and adds a versioned graph for Node/npm/pnpm, Cargo/Rust, Dart, Flutter, and polyglot workspaces. Stable module IDs, internal edges, manifest/toolchain/lock evidence, Git state, conflicts, and a canonical fingerprint are read-only.
- `doctor` checks schema-v2 project identity, platform artifact identity, executable and embedded-asset hashes, and capability availability.
- `verify` defaults to the root Flutter, Rust, npm, or pnpm topology. Optional module, affected, and all scopes select transitive dependents and schedule deterministic dependency levels with bounded concurrency, output, timeout, and native process containment.
- `debug providers` discovers host-owned debugger/runtime providers. `debug run` validates the v1 bounded-session schema and security policy; until a runtime adapter is qualified it returns `INSUFFICIENT_EVIDENCE` without launching a target.
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

On Windows, verification starts the root suspended, assigns it to a kill-on-close Job Object, resumes it, bounds output, and terminates the job on timeout or root completion. Cancellation closes the owning process and job, removing detached descendants.

Linux has an experimental process-group/PDEATHSIG runner and clean-runner compile/test lane. It is deliberately rejected by the public platform guard: process groups alone do not prove containment of session-escaping descendants. A subreaper/reaping design, full command parity, direct-package qualification, and zero-descendant evidence are still required before Linux is supported. macOS has no implementation until its containment feasibility gate passes.

The debug boundary does not bundle debuggers or SDKs. Attach endpoints must be loopback, consumer-owned targets detach by default, launch targets will be owned by the native supervisor, output and object traversal are bounded, and expression evaluation, memory writes, profiling, hot reload, and remote endpoints are excluded. Provider discovery is not provider qualification.

## Deliberately absent or deferred

`create` and portable scaffolding are permanently rejected; official ecosystem initializers own source scaffolding and sealed adoption owns only managed instructions, thin state, and ignore rules. Real CDB, GDB, LLDB, Node CDP, Dart DAP, and Flutter DAP session adapters remain deferred behind gated provider qualification. Non-Windows direct packages remain unpublished until command parity and process containment pass on native runners. Skill projection/synchronization, presets, tooling/package installation, copied-skill merging, retrofit writers, architecture alignment, restructuring, universal wrappers, and Frontier orchestration remain outside the portable product boundary.
