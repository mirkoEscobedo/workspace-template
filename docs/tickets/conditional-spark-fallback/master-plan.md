# Declarative Conditional Spark Routing Master Plan

## Goal

Preserve the completed FBK-001 declarative preset/routing contract and close
the local runtime-orchestration track at that boundary.

## Goal completion contract

- FBK-001 remains closed at commit
  `86b716a4a56de448b9bd9265dc47c9b3f201539b`, with its production files,
  focused tests, and evidence retained.
- Version-1 presets without fallback metadata remain valid and `sol-only`
  remains the active default.
- `sol-codex` may declare the reviewed optional conditional-routing
  requirements and materialize truthful generated configuration atomically.
- `workspace-template` makes no claim to execute that runtime declaration.
- FBK-002 through FBK-006 are superseded by Ultima-owned runtime
  orchestration.
- No Node fallback control plane, refusal circuit, runtime broker adapter,
  agent-process lease implementation, OpenCode spawn adapter, runtime-routing
  state machine, local activation, or live-model proof remains in this track.

## Source and authority

1. Explicit user direction dated 2026-07-28.
2. Wayfinder D007.
3. Retained FBK-001 contract and evidence.
4. Repository policy and current Git evidence.

Contract authority is `contract.yaml`. Superseded ticket contracts are
disposition records only and authorize no implementation.

## Ownership boundary

`workspace-template` owns project creation/adoption, methodology and skills,
declarative runtime requirements, validation, architecture budgets, safe
preset materialization, and integration with an external Ultima runtime.

Ultima owns runtime refusal handling, route selection, process ownership,
leases, broker execution, OpenCode spawning, runtime state, activation, and
live orchestration proof.

## Locked decisions

- Preserve FBK-001 behavior and evidence.
- Preserve `sol-only` as the active baseline and do not activate
  `sol-codex`.
- Retain FBK-001's generated broker-shaped configuration only as part of the
  declarative integration contract; it is not a local runtime implementation.
- Do not guess or implement the future Ultima integration seam.
- Keep all remote mutations and live-model operations out of this change.

## Out of scope

- Any local implementation of FBK-002 through FBK-006.
- Live model discovery, delegation, fallback, or dogfood.
- Release/version changes, push, pull request, publish, deploy, or remote
  mutation.

## Human gates

- A future runtime integration requires an explicit Ultima-owned interface and
  a separately approved contract.
- Remote mutation and release actions remain unauthorized.

## Frontier execution policy

The local frontier is closed. There is no ready or active ticket. Historical
ticket IDs are retained only to record their superseded disposition.

## Verification and architecture policies

See `policies/`. Verification protects FBK-001, the ticket-pack truth, current
public documentation, and architecture ratchets. It never runs or configures a
live model.

## Milestones

1. FBK-001 — declarative preset/routing contract: completed and retained.
2. FBK-002 through FBK-006 — local runtime orchestration: superseded by Ultima.

## Ticket index

| ID | Title | Status | Disposition |
|---|---|---|---|
| FBK-001 | Preset fallback contract and truthful routing | Closed | Retained |
| FBK-002 | Node-first fallback control plane | Superseded | Ultima runtime |
| FBK-003 | Terra OpenCode broker | Superseded | Ultima runtime |
| FBK-004 | Coordinator refusal transition | Superseded | Ultima runtime |
| FBK-005 | Offline fallback distribution | Superseded | Ultima runtime |
| FBK-006 | Sol-only and fallback live dogfood | Superseded | Ultima runtime |

## Completion rule

The track is complete when FBK-001 remains verified, FBK-002 implementation
residue is absent, FBK-002 through FBK-006 are marked superseded, public
ownership statements point runtime execution to Ultima, required local
verification passes, and the final worktree contains only explained changes.

## Stop and escalation rule

Stop on FBK-001 regression, active-preset drift, an attempt to add local
runtime orchestration, an undefined Ultima interface being treated as fact, a
live-model operation, or any release/remote mutation.
