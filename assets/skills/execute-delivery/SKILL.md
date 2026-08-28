---
name: execute-delivery
description: Execute one selected Adaptive Delivery outcome through implementation, verification, independent review, bounded diagnosis, and explicit termination. Use after delivery-loop has selected Direct, Ticketed, or Governed mode.
compatibility: ChatGPT Skills, Codex, OpenCode
metadata:
  version: "0.8.0"
---

# Execute Delivery

Keep one observable outcome active. Read the repository instructions, relevant product sources, acceptance criteria, and commands. In Direct mode, keep the plan in the current conversation and create no process files. In Ticketed or Governed mode, update only the declared compact current-work artifact.

1. Confirm the selected mode and acceptance criteria.
2. Implement the smallest vertical change through a public seam, using existing test and style policy.
3. Run focused verification, then the proportionate broader checks.
4. Invoke `review-change` against the exact diff and fresh evidence.
5. On a concrete failure, invoke `diagnose`. Invoke `repair-change` only with a new supported hypothesis and remaining repair budget.
6. On insufficient evidence, let the reviewer request the narrowest inspection capability.
7. On infeasibility, false assumptions, material scope change, repeated failure, or exhausted budget, terminate through explicit replanning. Do not create successor work to keep the same approach alive.

The executor coordinates transitions but cannot treat reviewer evidence as human authorization for destructive or external actions.
