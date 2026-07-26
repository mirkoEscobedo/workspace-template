# Ticket UPG-002 — Managed substrate reconciliation

## Public outcome

An upgrade plan accurately reconciles package-owned configuration, presets,
policies, scripts, schemas, harness roles, and workspace metadata while
preserving workspace identity and user-owned state.

## Required behavior

- Recover and preserve mode, timestamp, settings, features, agents, modules,
  active/local presets, role IDs, and overrides.
- Render active built-ins from the incoming package catalog.
- Preserve structured harness overrides and custom instruction ownership.
- Update managed-files to version 3 without losing settings.
- Restore missing owned artifacts and remove obsolete owned artifacts safely.
- Exclude product and durable-memory paths.

## Acceptance criteria

- [ ] Generated and adopted contexts retain distinct semantics.
- [ ] Installed stale built-ins cannot drive incoming routing.
- [ ] Managed drift is never overwritten through generator identity alone.
- [ ] Durable docs remain byte-identical and user-owned.
