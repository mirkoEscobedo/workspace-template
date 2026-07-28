# Wayfinder Map — Dedicated Workspace Upgrade

## Destination

A workspace created or adopted by `workspace-template` can be upgraded to the
running package's complete agentic substrate with one atomic command, without
changing product files, durable planning memory, workspace origin, or
repository-owned customizations.

## Notes and constraints

- Base branch: `agent-presets`.
- Base commit: `7342d9c5b868a64cfbd2c23e3bfda5722fff9de2`.
- Dogfood branch: `agent-preset/sol-sol`.
- Active preset: `sol-codex`.
- The running package is the incoming catalog; upgrade performs no registry
  lookup, dependency installation, Git mutation, publish, or deployment.
- Planning and dry-run must be read-only except for an explicitly requested
  plan file.

## Decisions so far

- [D001 — Command lifecycle](decisions/D001-command-lifecycle.md) — Bare
  `upgrade` seals and applies; dry-run previews; plan-out persists for later
  exact application.
- [D002 — Ownership boundary](decisions/D002-upgrade-ownership-boundary.md) —
  Upgrade owns the agentic substrate and preserves product and durable memory.
- [D003 — Mode and preset preservation](decisions/D003-mode-and-preset-preservation.md)
  — Workspace origin and routing are preserved unless an explicit preset is
  selected.
- [D004 — Atomicity and recovery](decisions/D004-atomicity-and-recovery.md) —
  One compound transaction owns all changes and same-plan recovery.
- [D005 — Verification contract](decisions/D005-verification-contract.md) —
  Full workspace verification runs before and after mutation.
- [D006 — Compatibility floor](decisions/D006-compatibility-floor.md) — Every
  schema generation currently accepted by doctor remains upgradeable.

## Current frontier

All route-changing decisions are closed. Compile and execute the
`workspace-upgrade` ticket track.

## Fog

- None.

## Out of scope

- Updating application source, tests, manifests, lockfiles, README, CI, or
  deployment configuration.
- Rewriting durable `docs/agent/` or `docs/tickets/` content.
- Network version discovery, dependency installation, Git commits, push,
  publish, or deployment.
- Partial substrate upgrades.

## Exit criteria

- [x] The destination is stable.
- [x] No unresolved decision materially changes the route.
- [x] Remaining unknowns can become ticket stop conditions.
