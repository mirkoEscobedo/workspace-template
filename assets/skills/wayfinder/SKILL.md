---
name: wayfinder
description: Resolve a genuine product or architecture fork whose answer cannot be derived from current evidence and would materially change the destination or implementation route. Use only after its admission test passes; do not use for ordinary planning or implementation uncertainty.
compatibility: Codex, OpenCode, repository Agent Skills
metadata:
  version: "0.8.0"
  edition: "repository-modular"
---

# Wayfinder

Admit Wayfinder only when all are true:

1. a specific unresolved product or architecture choice exists;
2. repository evidence and current instructions do not resolve it;
3. plausible answers lead to materially different destinations, authority, data shapes, or implementation routes;
4. choosing by inference would be unsafe or waste substantial work.

Otherwise return to `delivery-loop`; ambiguity, unfamiliar code, or a failed implementation is not sufficient admission.

When admitted, inspect authoritative sources and produce the minimum durable decision memo containing the question, available evidence, alternatives, chosen decision or explicit human gate, consequences, and invalidated assumptions. Use the packaged [decision template](assets/decision-template.md) only when a durable memo is warranted. Do not create a decision frontier, ticket graph, implementation scripts, or automatic follow-up decisions. Stop after the material fork is resolved or handed to the user.

Wayfinder never implements, repairs, approves authority gates, or automatically invokes plan compilation.
