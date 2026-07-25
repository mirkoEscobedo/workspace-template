# Ticket Tracks

Each track uses:

```text
<track>/
  master-plan.md
  track.yaml
  frontier.json
  current-sprint.md
  wayfinder-retrofit.md        # present on migrated tracks
  policies/
  NNN-<slug>/
    ticket.md
    contract.yaml
    validation.md
    evidence/
```

Run `execute-frontier` continuously from local files. It uses one writer by default, parallel read-only evidence where useful, independent review, targeted repair, and serial landing. No GitHub issue, webhook, or external scheduler is required.
