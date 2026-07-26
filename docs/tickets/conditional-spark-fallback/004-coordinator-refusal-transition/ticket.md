# Ticket FBK-004 — Coordinator refusal transition

## Context

Fallback is safe only when routing is selected once, before any native child
starts, from a narrowly categorized model refusal.

## Depends on

- FBK-003.

## Public outcome

Generated coordinators lock each run to native or broker mode from the first
eligible native Spark attempt and stop truthfully on every forbidden case.

## Required behavior

- Attempt the first eligible semantic role natively once.
- Lock native mode on any child identity/start evidence.
- Open broker mode only for approved pre-start model refusal with no identity.
- Persist verbatim and normalized refusal before broker spawn.
- Preserve semantic role, slot, permissions, writer limit, and fresh reviewer
  sessions.
- Stop on all semantic/tool/test/review/cancel/auth/timeout/nonzero/second-route
  failures.
- Project these rules into generated coordinator and scheduling instructions.

## Invariants

- Coordinator/planner are never eligible.
- No fallback after child start and no second route transition.
- State is keyed by exact preset fingerprint.
- Implementation remains under baseline `sol-only`.

## Out of scope

- Retrying work or activating `sol-codex`.
- Live model calls.

## Acceptance criteria

- [ ] Allowed refusal categories produce one persisted broker transition.
- [ ] Child identity and every forbidden category produce zero broker attempts.
- [ ] Writer/reviewer scheduling behavior remains exact.
- [ ] Generated instructions match executable state behavior.

## Stop conditions

- Any stop condition in `contract.yaml`.
