# Ticket UPG-004 — Atomic apply and recovery

## Public outcome

Bare `upgrade` and `--apply-plan` atomically apply the exact sealed substrate,
roll back failures, and recover interrupted same-plan transactions.

## Required behavior

- Direct upgrade persists its internal plan under the transaction directory.
- Apply revalidates integrity, package/catalog hashes, approvals, Git state,
  and target fingerprints.
- Full workspace verification passes before any mutation.
- Proposed state validates in staging.
- Exact target paths have a durable backup.
- Ownership manifests and locks write last.
- Doctor, routing, projections, leases, and full verification pass afterward.
- Failure restores the exact pre-upgrade state.
- Reapplying an interrupted plan recovers then restarts; dry-run only reports.

## Acceptance criteria

- [ ] Stale, tampered, replayed, and broadened plans fail before writes.
- [ ] Injected failures restore files, directories, and absent paths.
- [ ] Verification mutations outside the reviewed boundary are rejected.
- [ ] Journal and report describe recovery and rollback exactly.
