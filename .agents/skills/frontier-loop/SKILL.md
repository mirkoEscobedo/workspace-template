---
name: frontier-loop
description: "Route local-first agentic software work into Wayfinder planning, master-plan compilation, continuous Frontier execution, ticket retrofit, or docs retrofit. Use when the user asks to plan, ticket, execute, or migrate a repository with the Frontier Loop method."
compatibility: ChatGPT Skills, Codex, OpenCode
metadata:
  version: "0.6.0"
---

# Frontier Loop Router

Frontier Loop has one execution workflow. It is driven by local repository files and the current coordinator conversation; GitHub issues, webhooks, background watchers, and event-driven dispatch are optional integrations, never prerequisites.

## Route

1. **The destination is ambiguous or material decisions can still change the route.** Use `wayfinder`.
2. **A goal, design, or resolved Wayfinder map is ready to become executable tickets.** Use `compile-master-plan`.
3. **A local ticket pack should be executed continuously.** Use `execute-frontier`.
4. **Existing master prompts and ticket folders need Wayfinder recovery, contracts, risk lanes, policies, and a frontier.** Use `retrofit-ticket-pack`.
5. **An existing `docs/` folder needs the durable agent documentation shape.** Use `retrofit-agent-docs`.
6. **A single ticket is already selected.** Use `ticket-implementer`, then `ticket-review`, and `repair-ticket` only for failed axes.

## Normal flow

```text
Wayfinder -> Compile Master Plan -> Execute Frontier -> Integrate Wave
```

The same conversation may remain the coordinator from planning through execution. Fresh subagents are role-isolated workers, not separate project owners and not event listeners.

## Non-negotiable invariants

- Serial authority: one coordinator owns scope, scheduling, status transitions, landing order, commits, and human gates.
- Parallel evidence: independent exploration and review may run concurrently.
- Bounded mutation: writers have frozen contracts, declared write sets, and conflict keys.
- Git determines the real diff; agent summaries are evidence claims, not authority.
- Existing semantics are never silently rewritten by a retrofit.
- No ticket completes while owned child processes, unexplained changes, architecture-budget regressions, or required review failures remain.
- After continuous execution starts, do not ask whether to continue between ordinary tickets. Stop only for a declared human gate, a genuine blocker, an unsafe authority expansion, or completion.

Read `references/mode-selection.md` when planning and execution boundaries are unclear.
