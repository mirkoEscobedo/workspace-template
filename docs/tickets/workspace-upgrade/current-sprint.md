# Current Sprint — Workspace Upgrade

## Closed — baseline repair D landed

- UPG-001 through UPG-006 are complete with no active or blocked ticket.
- The user-authorized implementation amendment
  `baseline-repair-d-2026-07-26` is the current repair identity. Repair E was
  evidence/test-topology reconciliation only; repair C remains historical.
- Fresh landing evidence on the final implementation tree:
  - `npm run check`: 156 passed, 0 failed.
  - `npm run pack:check`: passed.
  - `npm run test:packed`: passed under native Windows Job ownership.
  - specification/authority, code/test, and operations/security reviews: pass.
  - doctor and `git diff --check`: pass.
  - ticket-pack validation: 0 errors after closure.
  - architecture budget validation: 0 violations.
  - zero nonbaseline leases, zero mutex owners, zero retained tarballs or packed
    smoke sandboxes.

## Execution baseline

- Branch: `agent-preset/sol-sol`
- Base: `7342d9c5b868a64cfbd2c23e3bfda5722fff9de2`
- Active workspace preset: `sol-only` (explicit current user selection)
- Historical ticket-pack preset: `sol-codex`
- Default: one writer, serial landing
- Execution routing: GPT-5.6 Sol high acted as coordinator and repair writer.
  Independent specification, code/test, and operations/security review lenses
  passed. The intended Spark child never started: the first attempt used the
  wrong Codex model name and the reopened app then refused Spark before
  returning a child identity. That truthful limitation is superseded by the
  separately authorized fallback track; the historical GPT-5.3-Codex/high
  track policy is preserved.

## Integration

- Local integration commit message: `feat: add atomic agentic workspace upgrades`.
- Push, publish, deploy, release mutation, and remote writes remain out of
  scope.
