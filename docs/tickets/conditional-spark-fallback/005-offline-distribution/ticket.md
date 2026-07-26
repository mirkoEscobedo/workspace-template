# Ticket FBK-005 — Offline fallback distribution

## Context

The complete fallback must be package-owned, generated offline, and safely
installed into new and existing workspaces without activating it under
`sol-only`.

## Depends on

- FBK-004.

## Public outcome

Create, adopt, upgrade, doctor, preset switching, and the packed tarball deliver
the same fallback contract offline while preserving legacy and user-owned state.

## Required behavior

- Package preset, broker, control-plane, hook, instruction, and policy assets.
- Preserve `sol-only` default/broker absence and version-1 legacy presets.
- Upgrade atomically with exact rollback and preservation of active/local/
  user-owned/drifted/durable/product content.
- Prefer Node hooks and report Python as optional.
- Install the reviewed Node ticket validator and architecture-budget checker;
  run both installed tools against `workspace-upgrade` and
  `conditional-spark-fallback`.
- Materialize the reviewed Node-first hook source into this repository's
  `.codex/hooks.json` while retaining its Python compatibility fallback.
- Use fake OpenCode for ordinary and packed tests.
- Update this repository's inactive installed catalog/scripts/skills under
  baseline `sol-only` so FBK-006 can plan activation.
- Update user documentation without release/version mutation.

## Invariants

- Inactive `sol-codex` assets do not create an active broker.
- No network, auth, discovery, publish, push, or deploy.
- Locked legacy tests do not grow.

## Out of scope

- Live model calls and `sol-codex` activation.

## Acceptance criteria

- [ ] Generated and adopted fixtures receive equivalent assets.
- [ ] Upgrade and rollback preserve all ownership boundaries.
- [ ] Doctor is truthful with Node-only, Node+Python, and invalid setups.
- [ ] Packed fake proof passes offline.
- [ ] Installed `.agentic/scripts/validate_ticket_pack.mjs` and
      `.agentic/scripts/check_architecture_budgets.mjs` match package assets and
      pass both tracks.
- [ ] Current `.codex/hooks.json` is Node-first with Python fallback intact.
- [ ] Repository status remains baseline `sol-only`.

## Stop conditions

- Any stop condition in `contract.yaml`.
