# Migration rules

- `master-prompt.md` remains preserved; generated `master-plan.md` points to it as source authority.
- `validation.md` and `verification.md` are both accepted.
- Tracking parents are marked `executable: false` when they contain no direct public outcome.
- Deep legacy IDs are stored in `legacy_ids`; future tickets should use stable flat IDs.
- Missing dependencies are warnings, not invented edges.
- A dependency inferred from prose is marked `inferred: true` in the report.
- Existing evidence is indexed, never rewritten.
