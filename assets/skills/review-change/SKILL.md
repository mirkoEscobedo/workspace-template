---
name: review-change
description: Independently review a completed code change with a static-to-runtime evidence ladder and a read-only PASS, FAIL, or INSUFFICIENT_EVIDENCE verdict. Use after implementation and verification; do not use to repair the change.
compatibility: ChatGPT Skills, Codex, OpenCode
metadata:
  version: "0.8.0"
---

# Review Change

Use a fresh context when available. Review the acceptance criteria, exact diff, tests, verification output, and applicable authority boundaries. The implementer's explanation is context, not proof. Do not edit source or expand scope.

Start with deterministic evidence and source inspection. Escalate only when correctness cannot otherwise be established. Read [references/evidence-ladder.md](references/evidence-ladder.md) before requesting runtime or GUI inspection.

Return a report matching `assets/review-report.schema.json`:

- `PASS` only when the acceptance criteria are supported and no blocking or important finding remains;
- `FAIL` for a concrete defect, with a reproducible pass condition and next transition `DIAGNOSING`;
- `INSUFFICIENT_EVIDENCE` when a material claim remains unresolved, with next transition `INSPECTING` or `REPLANNING`.

Inspection evidence does not grant human authority. The reviewer never repairs code.
