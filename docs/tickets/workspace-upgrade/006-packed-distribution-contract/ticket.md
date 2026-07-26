# Ticket UPG-006 — Packed distribution contract

## Public outcome

The packed package proves the complete generated/adopted upgrade lifecycle and
the user documentation describes the exact command and recovery contract.

## Required behavior

- Packed payload includes the upgrade runtime.
- Packed smoke proves dry-run, auto plan-out, direct apply, saved-plan apply,
  stale/tampered rejection, rollback, protected hashes, and no-op rerun.
- Help, README, usage, CLI architecture, changelog, and release notes agree.
- Dogfood evidence records branch/base, preset fingerprint, actual routing,
  ticket verification, reviews, repairs, and final outcome.

## Acceptance criteria

- [ ] `npm run pack:check` passes.
- [ ] `npm run test:packed` passes offline.
- [ ] `npm run check` passes on the exact final diff.
- [ ] No publish, push, deploy, or release bump occurs.
