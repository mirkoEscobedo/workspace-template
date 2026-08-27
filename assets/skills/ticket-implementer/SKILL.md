---
name: ticket-implementer
description: "Compatibility implementation role for one existing ticket or compact Ticketed/Governed outcome. Use only when a durable current item already exists; ordinary Direct work uses execute-delivery."
compatibility: ChatGPT Skills, Codex, OpenCode
metadata:
  version: "0.7.0"
---

# Ticket Implementer

## Input contract

Read the current outcome, relevant source decisions, base commit, and policies. Preserve legacy contracts as historical evidence. A compact 0.7 ticket is stable in intent and acceptance criteria, while expected files are a forecast; material scope changes return to replanning.

## Preflight

1. Confirm the public seam and current behavior.
2. Confirm expected scope. If the implementation requires a material expansion, stop before editing and replan.
3. Inspect target production and test files against architecture budgets.
4. Identify the fastest valid L0/L1/L2 commands.
5. Register a process lease for commands that may spawn descendants.

## Implementation

1. Use the `tdd` skill for behavior changes.
2. Add one public behavior test, prove RED for the intended reason, implement the minimum, and prove GREEN.
3. Repeat vertically. After every two or three cycles, run the test-placement check from `test-topology`.
4. Do not add behavior to a locked megafile. Extract a behavior-oriented module or stop for a decomposition ticket.
5. Refactor only while relevant tests are green.
6. Do not implement out-of-scope improvements, future tickets, or a newly discovered authority transition.

## Verification

- Run targeted checks during development.
- Before handoff, run the contract's implementer levels, architecture budget check, and process postcondition.
- Do not run L4 repeatedly unless the contract explicitly requires it.

## Handoff

Write a structured implementation report containing:

- status: `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED`;
- base and head identities;
- actual changed files from Git;
- behavior-by-behavior red/green evidence;
- commands, durations, and exit codes;
- architecture-budget result;
- owned-process result;
- assumptions, concerns, and invalidated contract fields.

Do not claim completion from memory or a prose summary. Git and evidence files are authoritative.
