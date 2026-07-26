# Ticket UPG-001 — Upgrade preview and immutable plan

## Context

The CLI has no upgrade command and current skill planning can mutate missing
baseline state.

## Public outcome

Users and agents can obtain a deterministic, sealed, zero-write upgrade preview
for an already-current managed workspace.

## Required behavior

- `upgrade .` is recognized as the direct-upgrade entry point.
- `upgrade . --dry-run` prints the exact plan and writes nothing.
- `upgrade . --plan-out [path]` saves without applying.
- Omitted plan-out paths use the version/plan-ID naming convention.
- A current workspace produces a successful no-op plan.
- Planning is pure even when legacy baseline artifacts are absent.

## Invariants

- Plan integrity and repository fingerprints use the common plan schema.
- The incoming source is the running package.
- No product or managed target file changes during preview.

## Acceptance criteria

- [ ] Focused argument tests cover the optional plan-out value.
- [ ] Dry-run hash snapshots prove zero target mutation.
- [ ] Auto path and printed apply instruction are stable.
- [ ] Current workspaces report `current`.

## Stop conditions

- Planning requires mutation to recover provenance.
- The public command cannot be kept compatible with existing argument parsing.
