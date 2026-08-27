---
name: delivery-loop
description: Route and coordinate software delivery through Direct, Ticketed, or Governed mode with bounded repair and explicit redirection. Use when implementing, fixing, or resuming repository work; do not use for read-only explanation or review alone.
compatibility: ChatGPT Skills, Codex, OpenCode
metadata:
  version: "0.7.0"
---

# Adaptive Delivery

Select the lightest mode that safely delivers the requested outcome:

- **Direct** is the default for an ordinary bounded feature, fix, refactor, or investigation. Do not create methodology artifacts.
- **Ticketed** is for multi-session work or several independently valuable vertical outcomes. Keep one compact plan and one current ticket; do not generate a dependency graph unless the user asks for one.
- **Governed** is for irreversible actions, credentials or security authority, financial authority, destructive migrations, production external effects, or native process ownership. Ambiguity alone is not a Governed signal.

Use `execute-delivery` after choosing the mode. Use `wayfinder` only when a genuine product or architecture decision cannot be derived from available evidence and a wrong choice would materially change the outcome.

Never generate an executable validator, successor ticket, or decision file merely because a check failed. Read [references/state-machine.md](references/state-machine.md) when coordinating failures, repairs, inspection, or replanning.

## Completion

Finish when the requested outcome is accepted with fresh evidence, or return one explicit terminal result: redirected to a materially different route, deferred with a concrete blocker, or aborted. Do not hide incomplete evidence behind a passing summary.
