# Ticket FBK-001 — Preset fallback contract and truthful routing

## Context

The active `sol-only` preset is the stable default. `sol-codex` needs an
optional, strictly validated refusal fallback and atomic preset activation
before any runtime fallback work can be trusted.

## Depends on

- None.

## Required context

- Wayfinder D001 and D006.
- Current preset schema/catalog/render/plan/apply code.
- Baseline `sol-only` fingerprint `793606…20b6`.

## Public outcome

`sol-codex` truthfully resolves Spark/xhigh semantic roles and a
collision-safe Terra/medium transport broker, while legacy presets and
`sol-only` remain compatible and broker-free.

## Required behavior

- Implement the exact optional fallback JSON from the master plan.
- Validate eligible roles, broker alias, delegate target, and target bindings.
- Expand config/profile/model-routing state with broker and OpenCode role facts.
- Preserve user-owned collisions and report partial routing truthfully.
- Make preset apply transactional: preflight all paths; update broker, expanded
  state, report, and managed manifest as one unit; commit the manifest last;
  restore exact prior bytes/absence on failure.
- Add focused RED/GREEN tests without growing locked legacy files. Amendment
  `fbk-001-preset-assertion-2026-07-26` permits only an LOC-neutral update of
  the obsolete `sol-codex` model/variant assertions in the locked 139-line
  `test/presets.test.js` and 380-line `test/adopt.test.js`.

## Invariants

- `sol-only` content, default, fingerprint, and broker absence do not change.
- Coordinator/planner remain Sol/high and ineligible.
- Broker is transport-only, not a semantic preset role.
- No activation of `sol-codex` in this ticket.

## Out of scope

- OpenCode launch and live proof.
- Coordinator refusal transition.
- Release or remote mutation.

## Acceptance criteria

- [ ] Legacy and `sol-only` cases pass unchanged.
- [ ] `sol-codex` resolves the exact models, variants, roles, and fallback.
- [ ] Collision allocation is deterministic and preserves user-owned agents.
- [ ] Failure injection proves exact rollback and truthful state.
- [ ] `test/presets.test.js` remains exactly 139 LOC after its assertion-only
      Spark/xhigh update.
- [ ] `test/adopt.test.js` remains exactly 380 LOC after its assertion-only
      Spark/xhigh update.
- [ ] Repository preset status remains the baseline `sol-only` fingerprint.

## Stop conditions

- Any stop condition in `contract.yaml`.
