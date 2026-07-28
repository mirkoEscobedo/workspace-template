---
name: retrofit-ticket-pack
description: "Use when an existing local master plan and ticket directory must be upgraded into a Wayfinder-aware Frontier Loop pack without renumbering or rewriting product semantics."
compatibility: ChatGPT Skills, Codex, OpenCode
metadata:
  version: "0.6.0"
---

# Retrofit Ticket Pack

## Safety model

Retrofit is additive by default. Existing ticket, validation, and master-plan text remains source authority. Do not silently correct, merge, reorder, or reinterpret it.

## Process

1. Scan the selected track for master plans, ticket directories, validation/verification files, evidence, and nested parent trackers.
2. Produce a dry-run migration report containing discovered IDs, inferred dependencies, risk lanes, review lenses, missing evidence, nested trackers, megafile/process-sensitive work, and every uncertain inference.
3. Recover a source-grounded Wayfinder migration map:
   - destination and source-authority ordering;
   - locked decisions, out-of-scope statements, and human gates explicitly present in source;
   - current implementation position;
   - migration decision frontier;
   - fog that requires human confirmation.
4. Preserve all original files. Create a Frontier wrapper plan only when no current `master-plan.md` exists.
5. Add `track.yaml`, policies, `contract.yaml` per ticket, `frontier.json`, `current-sprint.md`, `wayfinder-retrofit.md`, and `wayfinder-frontier.yaml`.
6. When the track is under `docs/tickets/`, also create `docs/agent/wayfinding/<track>-retrofit/` additively.
7. Keep legacy IDs as aliases. Do not rename ticket directories during the first retrofit.
8. Infer read/write sets conservatively. Mark `preflight_required: true` when uncertain.
9. Reconcile aggregate status fail-closed: a tracker cannot remain complete while any declared child is incomplete. Preserve the original status claim as migration provenance.
10. Validate missing blockers, cycles, tracker execution policy, and selectable Frontier work.
11. Review and close the Wayfinder migration decisions before autonomous execution.

## Deterministic helper

```bash
python scripts/retrofit_tickets.py docs/tickets/<track>          # dry run
python scripts/retrofit_tickets.py docs/tickets/<track> --apply  # additive apply

# When the current position is known but not retained in a journal:
python scripts/retrofit_tickets.py docs/tickets/<track> \
  --current-ticket 012 --current-status in_progress --apply

# Only when the asserted current position proves all transitive blockers passed:
python scripts/retrofit_tickets.py docs/tickets/<track> \
  --current-ticket 012 --trust-current-dependencies --apply
```

The helper automatically consumes retained `*execution-state*.jsonl` journals when present. `--status-overrides statuses.yaml` supplies an explicit reviewed status map when source prose and journals are insufficient. Use `--trust-current-dependencies` only as a deliberate operator assertion; the resulting migration warning must be reviewed.

Use `--no-wayfinder` only when another approved Wayfinder map already governs the track. Use `--force-generated` only to refresh unchanged files previously marked as generated. Original ticket and validation text is never overwritten.

## Completion

The retrofit passes when original semantics remain available, the recovered Wayfinder map makes uncertainty visible, every executable ticket has a contract, the graph validates, and `execute-frontier` can select the next local ticket without an external tracker.
