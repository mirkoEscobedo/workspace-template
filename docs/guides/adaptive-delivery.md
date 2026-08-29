# Adaptive Delivery

Adaptive Delivery chooses the lightest workflow that safely delivers the requested outcome.

Use **Direct** for ordinary features, fixes, refactors, and bounded investigations. It creates no methodology artifacts. Use **Ticketed** when work spans sessions or contains several independently valuable vertical slices; keep one compact outcome plan and one current ticket. Use **Governed** only for irreversible operations, credentials or security authority, financial authority, destructive migrations, native process ownership, or production external effects. Governed work adds a frozen contract, state record, independent review, and authority receipts.

Ambiguity alone is not a Governed signal. Admit Wayfinder only when evidence cannot resolve a genuine product or architecture fork and choosing incorrectly would materially change the destination.

```text
INTAKE → ROUTED → PLANNED → IMPLEMENTING → VERIFYING → REVIEWING → ACCEPTED
                                          ↘ DIAGNOSING / INSPECTING
                                             → REPAIRING → VERIFYING
                                             → REPLANNING
                                                → alternate implementation
                                                → reduced scope
                                                → defer with blocker
                                                → abort
```

A concrete defect precedes diagnosis. Diagnosis states a falsifiable cause. A repair tests a new hypothesis, and one outcome receives at most two semantic repair rounds. An unchanged failing gate may be rerun once only when explicitly classified as potentially flaky. Repeating failure without new causal evidence replans immediately.

Review begins with acceptance criteria, the exact diff, deterministic tests, and static checks. Escalate to runtime or GUI evidence only when those sources cannot establish correctness. If a required capability is unavailable, return `INSUFFICIENT_EVIDENCE` with an alternate check or explicit manual obligation. Review is read-only and emits exactly `PASS`, `FAIL`, or `INSUFFICIENT_EVIDENCE` plus one permitted transition.

## Package-owned methodology

Consumers do not receive copied generic skill, schema, baseline, prompt, or validator trees. Use `workspace-template skills list` to discover embedded methodology and `workspace-template skills show <name>` to retrieve exact instructions and bundled resources. Updating the dependency updates the skill source; sealed `upgrade` migrates only thin consumer state.

Codex, OpenCode, and repository owners select available models, agents, permissions, skills, and capabilities. Adaptive Delivery routes work; it does not select a model or materialize host-agent definitions.
