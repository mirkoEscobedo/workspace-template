# Validation record — 0.6.1 candidate

**Candidate date:** 2026-07-29

**Package:** `workspace-template@0.6.1`

**Status:** local candidate; release-final evidence pending

## Candidate scope

The `0.6.1` candidate reconciles the Windows/LF upgrade-preservation chain with
the host-bundle boundary and adds two fail-closed safety repairs:

- disabled or preserved projections are an implicit zero-write
  `no-projection` operation, while explicitly targeting a protected projection
  is an error;
- executable ticket contracts require at least one nonblank exact verification
  command.

Finalized process receipts remain durable evidence but are excluded from
upgrade dirty-state inspection. Active leases and surviving owned descendants
remain blockers.

## Required release gates

The release coordinator must bind results to the exact candidate commit. Until
that binding is recorded, the following are requirements rather than completed
release claims:

| Gate | Command or proof | Candidate status |
|---|---|---|
| source/static/full Node checks | `npm run check` | pending exact-commit binding |
| publishable payload | `npm run pack:check` | pending exact-commit binding |
| installed tarball behavior | `npm run test:packed` | pending exact-commit binding |
| package/internal/CLI version agreement | package JSON, `PACKAGE_VERSION`, installed `--version` | pending exact-commit binding |
| disabled projection boundary | focused direct-sync and skills-update tests | pending exact-commit binding |
| managed projection compatibility | focused projection regression tests | pending exact-commit binding |
| executable ticket non-vacuity | Python validator/schema contract tests | pending exact-commit binding |
| process postcondition | zero open leases and zero owned descendants | pending exact-commit binding |
| source review | exact final diff review | pending |
| workspace-template dogfood | sync/doctor on the integrated checkout | pending |
| Ultima downstream | disabled projections, preserved product host bundles, Node/Python checks | pending |
| agent-cad downstream | enabled Codex/OpenCode projections and repaired Ticket 002 acceptance | pending |

Publication, tagging, pushing, remote mutation, and deployment are not part of
this candidate record.

## Packed-artifact contract

The packed smoke test must create a real tarball, install it into a clean local
consumer without a registry fetch, read the installed package metadata, and
compare the installed CLI version with that metadata. It must also exercise the
documented creation, adoption, upgrade, workspace, skill-update, tooling,
restructure, and bounded alignment paths.

The smoke test's version oracle comes from the packed `package.json`; it does
not embed a second hard-coded current release number.

## Downstream acceptance

Downstream verification is deliberately separate from source-package checks:

- Ultima must report disabled projections and preserved host bundles with zero
  host-projection writes.
- agent-cad must retain its intentionally enabled Codex and OpenCode
  projections.
- agent-cad Ticket 002 must pass its repaired, non-vacuous locked acceptance
  and process-lifecycle evidence requirements.

None of those downstream outcomes is claimed until the coordinator records
fresh evidence.

## Toolchain and capability boundaries

- Rust and Flutter/Dart structural generator coverage is not a substitute for
  running Cargo or Flutter/Dart commands where those toolchains are required.
- Native whole-tree upgrade verification currently relies on the Windows Job
  Object owner. POSIX upgrade verification fails closed before payload or lease
  creation when detached-session containment is unavailable.
- No live paid model is required by deterministic source or packed tests.
- Architecture assessment remains source-located heuristic evidence, not an
  automatic proof of semantic correctness.

The completed `0.6.0` release remains documented in
[`docs/releases/0.6.0.md`](releases/0.6.0.md); this file tracks the current
`0.6.1` candidate only.
