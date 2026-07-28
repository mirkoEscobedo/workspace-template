# Wayfinder Map — Declarative Conditional Spark Routing

## Destination

`workspace-template` owns a truthful declarative preset/routing contract and
the safe project-generation machinery that materializes it. FBK-001 is the
completed end of this track.

Runtime orchestration is external. Ultima owns refusal handling, route
selection, the control plane, broker execution, agent-process ownership,
OpenCode spawning, runtime state, activation sequencing, and live proof.
`workspace-template` integrates with that runtime through declarative
requirements; it does not implement the runtime here.

## Source and authority

1. The user's explicit ownership change dated 2026-07-28.
2. [D007 — Ultima runtime ownership](decisions/D007-ultima-runtime-ownership.md).
3. The retained FBK-001 contract and evidence.
4. `AGENTS.md`, `.agentic/profile.json`, and repository policies.
5. Historical D002–D006 records, only where they do not conflict with D007.

## Baseline facts and constraints

- FBK-001 landed in `86b716a4a56de448b9bd9265dc47c9b3f201539b`.
- `sol-only` remains active with fingerprint
  `793606dafbcd5571feb039beaad992c501952fe7a8d33a913a035653a10420b6`.
- FBK-001 retains the version-1-compatible optional fallback declaration,
  resolved model/role facts, collision-safe generated configuration, truthful
  state rendering, and atomic preset materialization.
- FBK-002 runtime work never entered the index or Git history.
- FBK-003 through FBK-006 were not started.
- No live models, preset activation, release mutation, push, publish, deploy,
  or other remote mutation is authorized.

## Decisions

- [D001 — Preset and truthful routing contract](decisions/D001-preset-and-truthful-routing-contract.md)
  — Retained and completed by FBK-001.
- [D002 — Run-scoped refusal transition](decisions/D002-run-scoped-refusal-transition.md)
  — Historical; superseded for this repository.
- [D003 — Portable owned control plane](decisions/D003-portable-owned-control-plane.md)
  — Historical; superseded for this repository.
- [D004 — Terra broker and fixed OpenCode invocation](decisions/D004-terra-broker-and-fixed-opencode-invocation.md)
  — Historical; superseded for this repository.
- [D005 — Offline compatibility and validation](decisions/D005-offline-compatibility-and-validation.md)
  — Declarative validation remains local; runtime distribution is superseded.
- [D006 — Dogfood activation and restart authority](decisions/D006-dogfood-activation-and-restart-authority.md)
  — Historical; no local activation or live proof remains.
- [D007 — Ultima runtime ownership](decisions/D007-ultima-runtime-ownership.md)
  — Current authority boundary.

## Current frontier

There is no executable local frontier. FBK-001 is closed; FBK-002 through
FBK-006 are superseded. Any future runtime work requires an Ultima-owned plan
or a separately approved integration contract.

## Fog

- The concrete Ultima repository/API handshake is not defined in this
  repository. It remains outside this closed track and must not be guessed.

## Out of scope

- A local Node fallback control plane.
- A local refusal circuit or runtime-routing state machine.
- Local broker execution or OpenCode spawning.
- Agent-process orchestration leases for the fallback runtime.
- Activating `sol-codex` or running live-model dogfood.
- Release, push, publish, deploy, or remote mutation.

## Human authority boundary

No runtime execution is authorized by this track. A future integration may
proceed only from an explicit Ultima interface and a separately reviewed
workspace-template integration contract.

## Exit criteria

- [x] FBK-001 remains landed with its tests and evidence.
- [x] FBK-002 uncommitted implementation and generated residue are removed.
- [x] FBK-002 through FBK-006 are durably marked superseded.
- [x] Current documentation points runtime orchestration to Ultima.
