---
name: repair-ticket
description: "Use when one Frontier Loop review axis failed and needs a bounded repair without weakening the ticket, tests, or immutable evidence; rerun only invalidated verification and request only affected re-review."
compatibility: ChatGPT Skills, Codex, OpenCode
metadata:
  version: "0.6.0"
---

# Repair Ticket

1. Read the original immutable ticket packet and every failed review report.
2. Classify findings by invalidated domain: behavior/authority, code-test architecture, operations-security, or evidence only.
3. Build one coherent repair plan. Do not dispatch one cold-start fixer per finding when the findings share context.
4. Reproduce each blocking defect where practical.
5. Apply the smallest correction that satisfies the original contract. Never weaken acceptance criteria, delete meaningful tests, rewrite prior evidence, or broaden authority.
6. Use vertical TDD for behavior changes. Keep architecture and process budgets in force.
7. Re-run covering L0–L2 checks and any higher level invalidated by the repair.
8. Append a repair report; do not overwrite the implementation report or initial review.
9. Re-run only affected review lenses, except when the repair changed shared behavior or authority—then invalidate all dependent lenses.

Stop and return to the coordinator when a finding conflicts with the contract, requires a new product decision, or expands the write/conflict set beyond its boundary.
