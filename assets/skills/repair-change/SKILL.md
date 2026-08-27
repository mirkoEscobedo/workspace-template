---
name: repair-change
description: Apply one bounded repair for a diagnosed implementation defect with a new falsifiable hypothesis and remaining repair budget. Use after review or verification fails; do not use for infrastructure failures, scope changes, or a third semantic attempt.
compatibility: ChatGPT Skills, Codex, OpenCode
metadata:
  version: "0.7.0"
---

# Repair Change

Before editing, require the concrete failure, root-cause evidence, a falsifiable hypothesis not used by an earlier repair, the affected acceptance criterion, and the current semantic-repair count.

Refuse repair and return to replanning when:

- two semantic repairs have already occurred;
- the hypothesis is missing or repeated;
- the failure is infrastructure, unavailable tooling, or an external blocker;
- the proposed fix changes the product decision, materially expands scope, or requires new authority.

Otherwise make the smallest root-cause repair, add or improve regression protection, run focused verification, and return to the executor. Do not create successor tickets, decision files, validators, or new attempts for yourself. The reviewer remains independent and must re-review affected claims.
