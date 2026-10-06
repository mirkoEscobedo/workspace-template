---
name: delivery-loop
description: Route and coordinate software delivery through Direct, Ticketed, or Governed mode with bounded repair and explicit redirection. Use when implementing, fixing, or resuming repository work; do not use for read-only explanation or review alone.
compatibility: ChatGPT Skills, Codex, OpenCode
metadata:
  version: "0.8.0"
---

# Adaptive Delivery

Select the lightest mode that safely delivers the requested outcome:

- **Direct** is the default for an ordinary bounded feature, fix, refactor, or investigation. Do not create methodology artifacts.
- **Ticketed** is for multi-session work or several independently valuable vertical outcomes. Keep one compact plan and one current ticket; do not generate a dependency graph unless the user asks for one.
- **Governed** is for irreversible actions, credentials or security authority, financial authority, destructive migrations, production external effects, or introducing or changing native process ownership. Reusing an already qualified process owner for a bounded test does not alone select Governed or require a new wrapper, contract, or receipt campaign. Ownership and cleanup evidence remain required. Ambiguity alone is not a Governed signal.

Use `execute-delivery` after choosing the mode. Use `wayfinder` only when a genuine product or architecture decision cannot be derived from available evidence and a wrong choice would materially change the outcome.

Never generate an executable validator, successor ticket, or decision file merely because a check failed. Read [references/state-machine.md](references/state-machine.md) when coordinating failures, repairs, inspection, or replanning.

## Verification and resumption

During ordinary iterations, run the exact changed scenario, affected regressions, and relevant static checks. Execute new native fixtures through real startup and reporting before expensive aggregates. Full gates remain required at repository-declared acceptance, integration, authority, or release boundaries, or when impact cannot be bounded. Follow `verify`; keep component evidence, deferred gates, and full acceptance distinct. Continue eligible independent work with a visible external gap only when the repository contract permits it.

In Direct mode, keep the current summary in the conversation and create no process artifact. In Ticketed or Governed mode, update the one declared current-work artifact. Aim for about 4 KiB or 60 lines as a soft budget; justify an exception when essential recovery facts need more space. Link historical evidence and preserve it rather than appending transcripts or creating a size validator. Keep only current facts:

- active scope and exact candidate identity;
- settled authorization and its actor, action, target, and scope limits;
- passed checks with covered inputs and evidence links;
- remaining acceptance gaps, including deferred external gates;
- a concrete blocker and resumption condition, if any;
- the next exact action or command.

On interruption or context refresh, read this current summary and confirm it against canonical repository or issue state before resuming the next action. Replace superseded status in the current summary and link the preserved history. Honor settled authorization and preferences within their stated scope without repeating the question. Ask again only when a relevant change of action, target, scope, candidate, or authority exceeds the recorded authorization, or a separate confirmation is explicitly required. A candidate update alone does not revoke broad local edit/test authorization; recheck its limits. Candidate decisions, sealed apply confirmations, and separately authorized signing, publication, tags, pushes, or registry changes retain their own required gates; review evidence is never authorization.

The [delivery evaluations](evals/evals.json) include combined instruction scenarios for verification, ownership, interruption, and authority. They are evaluation cases, not a new executable validator.

## Completion

Finish when the requested outcome is accepted with fresh evidence, or return one explicit terminal result: redirected to a materially different route, deferred with a concrete blocker, or aborted. Do not hide incomplete evidence behind a passing summary.
