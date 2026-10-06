# Adaptive Delivery

Adaptive Delivery chooses the lightest workflow that safely delivers the requested outcome.

Use **Direct** for ordinary features, fixes, refactors, and bounded investigations. It creates no methodology artifacts. Use **Ticketed** when work spans sessions or contains several independently valuable vertical slices; keep one compact outcome plan and one current ticket. Use **Governed** only for irreversible operations, credentials or security authority, financial authority, destructive migrations, introducing or changing native process ownership, or production external effects. Governed work adds a frozen contract, state record, independent review, and authority receipts. Reusing an existing qualified process owner for a bounded test can stay Direct or Ticketed; retain ownership and zero-descendant cleanup evidence without generating another wrapper or receipt campaign.

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

## Proportionate verification

During ordinary iterations, execute the exact new or changed public scenario, its affected regressions, and relevant static checks. For a new native fixture, execute real startup and reporting before expensive aggregates. Compilation proves compilation only; setup failures do not demonstrate the intended behavior's RED or GREEN. Correct or classify fixture setup before expanding the checks.

Run full verification at repository-declared acceptance, integration, authority, or release boundaries, and whenever impact cannot be bounded. The repository's mandatory gates remain mandatory. When covered inputs change, mark the prior broad result stale for those inputs and continue eligible focused work. Refresh broad evidence when next required or claimed at the applicable boundary, rather than automatically after every small repair. Investigate new concerns with the smallest checks that can bound impact; unknown impact requires full verification. The `tdd`, `execute-delivery`, `verify`, `review-change`, and `integrate-wave` skills share this rule.

Keep component evidence, deferred gates, and full acceptance separate. A focused pass cannot prove full acceptance, and a visible gap cannot waive a mandatory gate. An unavailable external gate defers or replans the acceptance scope it blocks. When the repository contract permits independently eligible local work, continue that work with the unmet parent requirement, concrete blocker, and resumption condition visible. Do not claim parent `PASS` or acceptance, silently reduce its criteria, or reset repair counters because a component can proceed. Review evidence never grants authority to publish or perform another consequential action.

## Current summary and scoped authorization

Direct work keeps its current summary in the conversation and creates no process artifact. Ticketed and Governed work update the one declared current-work item. Aim for about 4 KiB or 60 lines as a soft budget; justify essential exceptions, preserve historical evidence through links, and create no size validator. Keep the active scope and exact candidate identity, settled authorization and its actor/action/target/scope limits, passed checks with covered inputs and evidence links, remaining acceptance gaps, any blocker and resumption condition, and the next exact action or command.

After interruption or context refresh, confirm the current item against canonical repository or issue state before resuming the exact next action. Replace superseded status in the current item and link the preserved history. Settled authorization and preferences persist within their stated scope; do not ask the same question again. Ask again when a relevant change of action, target, scope, candidate, or authority exceeds that authorization, or a separate confirmation is explicitly required. A candidate update alone does not revoke broad local edit/test authorization. Separately required candidate decisions, sealed apply confirmations, signing, publication, tags, pushes, and registry actions retain their own gates. A review pass cannot provide these confirmations.

The package's `delivery-loop/evals/evals.json` contains combined instruction cases covering bounded repair, fixture setup failure, unknown impact, mandatory full gates, qualified owner reuse, exact recovery, scoped authorization, stale summaries, and eligible local work with visible external gaps. These follow the existing skill evaluation format; they add no validator framework.

## Package-owned methodology

Consumers do not receive copied generic skill, schema, baseline, prompt, or validator trees. Use `workspace-template skills list` to discover embedded methodology and `workspace-template skills show <name>` to retrieve exact instructions and bundled resources. Updating the dependency updates the skill source; sealed `upgrade` migrates only thin consumer state.

Codex, OpenCode, and repository owners select available models, agents, permissions, skills, and capabilities. Adaptive Delivery routes work; it does not select a model or materialize host-agent definitions.
