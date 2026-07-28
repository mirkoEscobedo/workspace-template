# Ticket UPG-003 — Skill and projection upgrade

## Public outcome

The unified plan includes exact baseline-aware canonical skill merges and
conflict-safe harness projections without any planning-time mutation.

## Required behavior

- Inspect or plan legacy baseline recovery without writing.
- Plan the union of installed and incoming skills.
- Merge non-overlapping local and incoming changes.
- Add new skills automatically.
- Gate risky executable/tool changes and removals.
- Block locally edited removals and overlapping edits.
- Preflight projections from the staged merged canonical tree.

## Acceptance criteria

- [ ] Incoming baseline remains exact while local edits survive clean merges.
- [ ] Missing untrustworthy baseline blocks without creating files.
- [ ] Projection collisions block the entire plan.
- [ ] No partial mode exists.
