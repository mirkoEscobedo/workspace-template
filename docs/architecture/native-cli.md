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

## Verification records and declared coverage

Every `verify` result reports the actual `scope`, attempted `steps`, total `durationMs`, and `coverage`. Each attempted command records its program, exact arguments, repository-relative working directory, `passed`, and `durationMs`, including nonzero exits, timeouts, and launch errors. Both clocks use monotonic elapsed time. Step duration includes launch, execution, bounded output drainage, and owned-process cleanup. Total duration includes discovery, selection, reporting, and input-identity observation; it excludes CLI argument parsing and final JSON serialization. Concurrent step durations may sum to more than total wall time. Durations measure this invocation and make no performance claim.

The top-level `verdict` and exit status retain their meaning for the selected commands. A root or module `PASS` does not establish repository acceptance. In a mixed Cargo/package repository, the default root command still runs Cargo format and test; it does not infer that `npm run check`, strict Clippy, or another repository gate ran. No prose in `AGENTS.md`, scripts, or output is parsed into acceptance obligations.

A repository may declare exact required command identities in `.agentic/project.json` under `overrides.workspace.verificationCoverage`:

```json
{
  "completeGate": true,
  "requirements": [
    {
      "id": "repository-check",
      "commands": [
        { "program": "npm.cmd", "args": ["run", "check"], "cwd": "." }
      ]
    }
  ]
}
```

This declaration records obligations; it does not schedule commands. Use the existing discovered root topology or structured workspace command overrides to execute the repository-owned gate. Each requirement and command is reported as `passed`, `failed`, or `notRun`. Matching uses the exact program, arguments, and working-directory strings. Any failed execution of a matching command keeps its requirement failed; a missing command remains `notRun`. `coverage.requiredChecksComplete` means every command in every declared requirement succeeded, including qualified cleanup. `completeGate` records the repository's explicit assertion that the declaration covers its full gate. A declaration with `completeGate: false` covers only its stated subset even if all those checks pass.

`coverage.verdict` is `PASS`, `FAIL`, or `INSUFFICIENT_EVIDENCE` for those declared requirements, separately from the selected-command verdict. Without a declaration, coverage is `undeclared`, required checks remain incomplete, and coverage is `INSUFFICIENT_EVIDENCE`. Malformed declarations are rejected before launch. IDs must be unique and 1 through 128 UTF-8 bytes; declarations permit 1 through 128 requirements, at most 128 total commands, and at most 128 arguments per command. Working directories must remain repository-relative. `coverage.authority` is always `verification-evidence-only`: no result closes an issue, grants human acceptance, or authorizes signing, publication, a release, or changes to a consumer branch.

For a lightweight efficiency comparison, retain each existing JSON command record alongside the task, source baseline, environment/toolchain constraints, assertions, required gates, and cold/warm build state. Alternate the order of several matched pairs covering an ordinary repair, a fixture/setup defect, and an interrupted run. Measure time to a meaningful failure separately from setup failure and compilation; then measure affected success, repeated unchanged verification, total required acceptance, interventions, repeated authorization requests, coordination artifacts, and recovery accuracy. Report individual outcomes and medians, with unavailable host inference cost labeled unavailable. Keep equal assertions, acceptance obligations, and authority boundaries; record missing defects, leftover owned processes, or incorrect recovery as failures. A small pilot is directional evidence. These records introduce neither a benchmark coordinator nor caching or a speed claim.

## Focused checks using existing overrides

The current interface can keep a focused native fixture beside a full root verification without a new check-selection API. In a Cargo workspace, configure `overrides.workspace.commands` for the observed member ID:

```json
{
  "rust:crates/component": [
    { "program": "cargo", "args": ["test", "-p", "component", "--test", "focused"], "cwd": "." }
  ]
}
```

`verify <root> --scope module --module rust:crates/component` runs that fixture and selected transitive dependents. `verify <root>` still runs the default Cargo format and test aggregate. The public `focused_verification` qualification uses a synthetic native package with one focused behavior and a separate aggregate marker: the focused invocation leaves the marker absent, then the root invocation executes it. Unknown modules are rejected before either command starts. This proves coexistence for the qualified pattern, so no named-check API was added. Repositories whose full gate also requires Clippy or other checks must explicitly configure those commands and coverage; the default Cargo aggregate is not their complete gate. An override replaces a module's discovered command list, so `--scope all` uses those replacements rather than restoring the defaults.

## Tested input identity

`graphFingerprint` remains topology identity. Optional `overrides.workspace.verificationInputs` declares a versioned input policy:

```json
{
  "version": 1,
  "files": ["Cargo.toml", "Cargo.lock", "crates/component/src/lib.rs", "crates/component/tests/focused.rs"],
  "programs": ["cargo", "rustc"],
  "environment": ["RUSTUP_TOOLCHAIN", "RUSTFLAGS"],
  "serviceConstraints": []
}
```

Files are explicit repository-relative paths, including dirty and untracked tested source, fixtures, scripts, manifests, locks, and relevant toolchain configuration. No recursive scan is performed. The policy accepts at most 4,096 file entries, 8 MiB per file and 32 MiB in total. Absolute paths, parent traversal, alternate streams, symlinks/junctions, generated directories, and protected credential paths are refused. Listed programs are resolved through explicit paths or PATH and identified by file content, with 128 entries, 128 MiB per program, and 256 MiB total. Program paths also refuse protected/generated locations and linked ancestors; Windows program files must be executable or batch entrypoints. Declare every executed program and relevant toolchain program. The running verification executable is also hashed. A shim or launcher identity does not establish all its runtime dependencies: repositories must declare relevant files/programs themselves and cannot infer a transitive tool closure from this record.

When a snapshot captures the configured command, the runner launches that exact path and records `resolvedProgram`. Each step also records `programImage`, queried from the actual suspended process after job assignment. A batch entrypoint launches an interpreter, so its interpreter (normally `cmd.exe`) must also be declared and hashed for qualification. An unavailable or undeclared image keeps identity unqualified. These paths and the observed image are part of the identity alongside the original command, arguments, module, and working directory. Explicit override roots and working directories are preflighted, and every finalized working directory is checked again before launch; a junction cannot redirect execution outside the repository.

Only explicitly listed noncredential settings from `CI`, `NODE_ENV`, `RUSTFLAGS`, `RUSTUP_TOOLCHAIN`, `CARGO_BUILD_TARGET`, `CARGO_PROFILE`, and `FLUTTER_BUILD_MODE` may affect environment identity. Values are hashed and never emitted. Do not place secret values in these settings or the declared inputs. Other environment names are rejected; the CLI does not capture the entire environment. Service constraints declare bounded `{ "id": "test-service", "revision": "snapshot-one" }` expectations, but the CLI has no service observer, so any such declaration keeps freshness unqualified.

`inputIdentity` is present for every scope. It records `schemaVersion`, `assurance: declared-inputs-only`, `qualified`, an optional `sha256`, reason, and limits. Before/after snapshots bind declared file/program bytes and settings to the actual executed command identities. A changed policy/input, missing or oversized input, undeclared executed program, unavailable external observation, or unqualified cleanup refuses freshness qualification; command execution outcome remains separate. Without a policy, checks still run and identity is explicitly unqualified. Malformed or unsafe policies are rejected before launch.

Equal before/after observations cannot prove that no transient change was made and reverted, nor that the input declaration is exhaustive. The record states these limitations and enables no caching, automatic acceptance, issue closure, signing, registry action, or check skipping. It identifies stable declared inputs; independent assertions, complete coverage, and any stronger continuous freshness requirement remain separate obligations.

## Process boundary

On Windows, verification starts the root suspended, assigns it to a kill-on-close Job Object, resumes it, bounds output, and terminates the job on timeout or root completion. Cancellation closes the owning process and job, removing detached descendants. Git graph discovery and affected-path selection use the same owned runner with a five-second command limit. Launch, timeout, cleanup uncertainty, or oversized Git output prevents that discovery/selection from qualifying; an ordinary Git failure in an unborn or non-Git directory remains unavailable Git metadata.

Result-producing commands retain the admitted job and bounded member-process handles, confirming their membership in that actual job. Cleanup shares a five-second deadline across capture, termination, and observation. `steps[].cleanup` records `qualified`, `outcome`, observed `activeProcesses`, `retainedProcesses`, `signaledProcesses`, monotonic `durationMs`, and an optional `error`. Qualification requires successful termination, actual zero accounting, signaled retained handles, and no uncovered admission gap across the terminal cut. Zero accounting alone can precede fully signaled process exit. Membership/retention, query, termination, or wait errors and timeout remain visible and cannot produce a passing step, even when the root exited successfully. The `processOwnership` label describes the mechanism separately. Hard cancellation or coordinator death can emit no final JSON; kill-on-close remains the containment boundary, and no terminal observation is invented after the owner dies.

Linux has an experimental process-group/PDEATHSIG runner and clean-runner compile/test lane. It is deliberately rejected by the public platform guard: process groups alone do not prove containment of session-escaping descendants. A subreaper/reaping design, full command parity, direct-package qualification, and zero-descendant evidence are still required before Linux is supported. macOS has no implementation until its containment feasibility gate passes.

The debug boundary does not bundle debuggers or SDKs. Attach endpoints must be loopback, consumer-owned targets detach by default, launch targets will be owned by the native supervisor, output and object traversal are bounded, and expression evaluation, memory writes, profiling, hot reload, and remote endpoints are excluded. Provider discovery is not provider qualification.

## Deliberately absent or deferred

`create` and portable scaffolding are permanently rejected; official ecosystem initializers own source scaffolding and sealed adoption owns only managed instructions, thin state, and ignore rules. Real CDB, GDB, LLDB, Node CDP, Dart DAP, and Flutter DAP session adapters remain deferred behind gated provider qualification. Non-Windows direct packages remain unpublished until command parity and process containment pass on native runners. Skill projection/synchronization, presets, tooling/package installation, copied-skill merging, retrofit writers, architecture alignment, restructuring, universal wrappers, and Frontier orchestration remain outside the portable product boundary.
