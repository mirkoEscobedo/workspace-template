# D004 — Atomicity and recovery

## Question

How should a multi-component upgrade fail and recover?

## Decision

Use one atomic transaction with no partial mode. Validate and stage the complete
proposed substrate, back up the exact write set durably, apply ownership and
lock manifests last, and roll back every reviewed path on failure.

If interrupted, re-running the same `--apply-plan` restores the durable
pre-upgrade snapshot, revalidates, and restarts the exact reviewed transaction.
Dry-run never performs recovery; it reports `recovery-required`.

Risky skill behavior and skill removal require approvals recorded when the plan
is built. Apply-time flags cannot broaden a plan.

## Consequences

- Sequentially invoking adoption, skills, and preset applicators is forbidden.
- Journal and backup identity become part of the public recovery contract.
- An active unrelated transaction or open process lease blocks upgrade.

## Evidence

- Existing plan journal, checkpoint, rollback, and stale-plan infrastructure.
