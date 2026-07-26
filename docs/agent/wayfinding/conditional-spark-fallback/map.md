# Wayfinder Map — Conditional Terra → OpenCode Spark Fallback

## Destination

`workspace-template` preserves `sol-only` as its product default and can
truthfully activate `sol-codex` as a native-first routing preset: the
coordinator and planner remain GPT-5.6 Sol/high, the seven delegated semantic
roles use GPT-5.3 Codex Spark/xhigh, and a run may switch to a generated
Terra/medium transport broker only when the first eligible native Spark probe
is refused before start and returns no child identity. The broker starts one
fresh, bounded OpenCode Spark session per attempt through an owned,
cross-platform control plane. Generated, adopted, upgraded, and packed
workspaces receive the same offline-capable contract.

The completed track includes a live dogfood proof. FBK-001 through FBK-005 are
implemented and reviewed while this repository remains on the current
`sol-only` fingerprint. FBK-006 atomically activates `sol-codex`, stops for a
human Codex App restart, and only after that restart runs bounded
evidence-only implementer and read-only reviewer proofs. The repository is
left on `sol-codex`.

## Source and authority

1. The user's approved “Conditional Terra → OpenCode Spark Fallback” plan and
   explicit compilation instructions dated 2026-07-26.
2. The decisions in this directory.
3. `AGENTS.md`, `.agentic/profile.json`, and `.agentic/policies/*.yaml`.
4. Current preset, rendering, process, generator, upgrade, doctor, and packed
   acceptance behavior at base commit
   `fe7e325958ff56eefa3bd97a54fabed58c845de6`.
5. Clearly labeled ticket preflight evidence. No inference may change the
   frozen route.

## Baseline facts and constraints

- The active baseline is `sol-only`, fingerprint
  `793606dafbcd5571feb039beaad992c501952fe7a8d33a913a035653a10420b6`.
- `sol-only` remains byte-for-byte semantically unchanged: it has no fallback
  metadata and generates no broker.
- `sol-codex` alone gains optional refusal-fallback metadata and broker
  materialization.
- Coordinator and planner are never eligible for fallback. The exact eligible
  set is `scout`, `implementer`, `reviewer-spec`, `reviewer-code`,
  `reviewer-ops`, `repairer`, and `integrator`.
- There is one writer and serial landing. Read-only evidence and the three
  independent review lenses may run separately, but no second writer is
  authorized.
- Every command has one owner. Completion requires zero owned descendants and
  zero open leases.
- No release/version bump, commit push, pull request, publish, deployment, or
  remote mutation is authorized.

## Decisions so far

- [D001 — Preset and truthful routing contract](decisions/D001-preset-and-truthful-routing-contract.md)
  — Keep `sol-only` unchanged; add an optional, validated fallback contract
  only to `sol-codex` and expand all durable routing state truthfully.
- [D002 — Run-scoped refusal transition](decisions/D002-run-scoped-refusal-transition.md)
  — Choose native or broker mode only from the first eligible native attempt;
  fallback requires a categorized pre-start refusal and no child identity.
- [D003 — Portable owned control plane](decisions/D003-portable-owned-control-plane.md)
  — Node 24 is primary, Python is fallback, and both platforms provide
  argument-safe whole-tree ownership with durable leases.
- [D004 — Terra broker and fixed OpenCode invocation](decisions/D004-terra-broker-and-fixed-opencode-invocation.md)
  — A collision-safe Terra/medium Codex agent transports one frozen packet to
  one fresh OpenCode Spark/xhigh semantic-role session.
- [D005 — Offline compatibility and validation](decisions/D005-offline-compatibility-and-validation.md)
  — Preserve legacy presets, generate the control plane offline, and prove
  create/adopt/upgrade/packed behavior with fakes.
- [D006 — Dogfood activation and restart authority](decisions/D006-dogfood-activation-and-restart-authority.md)
  — Implement under `sol-only`, atomically activate `sol-codex`, then stop
  until a human restarts the Codex App before any live proof.

## Current frontier

All route-changing decisions are closed in `frontier.yaml`. The executable
frontier is compiled at
`docs/tickets/conditional-spark-fallback/frontier.json`.

## Fog

None. Implementation-level discoveries are bounded by ticket preflight and
stop conditions; they may not change fallback authority, state shape, process
ownership, or the restart sequence.

## Out of scope

- Fallback on ordinary ticket failure, tool failure, test failure, review
  failure, cancellation, timeout after a native child starts, or any semantic
  failure.
- Fallback for coordinator or planner.
- More than one OpenCode attempt per broker attempt, OpenCode session reuse,
  automatic continuation, sharing, or credential/environment dumping.
- A general-purpose shell broker, arbitrary model selection, arbitrary packet
  paths, or arbitrary OpenCode flags.
- Broad process killing, executable-name killing, interpolated PowerShell
  command lines, or unverifiable descendant cleanup.
- Changing `sol-only`, changing the default preset, release mutation, push,
  publish, or deploy.

## Human authority boundary

FBK-006 must stop immediately after atomic `sol-codex` activation and before
model discovery or any live delegation. Only a human restart and explicit
resume after the Codex App reloads the new preset may open the post-restart
proof phase. Model/reviewer output cannot satisfy this gate.

## Exit criteria

- [x] The destination is stable and observable.
- [x] Architecture, authority, state shape, sequencing, and ticket boundaries
      are resolved.
- [x] Public seams, process postconditions, verification commands, and the
      mandatory restart gate are known.
- [x] Remaining implementation uncertainty is expressible as ticket preflight
      or stop conditions.
