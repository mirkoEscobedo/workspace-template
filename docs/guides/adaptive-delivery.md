# Adaptive Delivery

Adaptive Delivery is the normal workspace-template workflow from version 0.7.
It minimizes process artifacts while retaining explicit evidence and stopping
rules where consequences justify them.

## Choose a mode

Use **Direct** for ordinary features, fixes, refactors, and bounded
investigations. Direct work records acceptance criteria, changes, verification,
review, and the final result in the normal development record. It creates no
ticket graph, validator program, or repair evidence tree.

Use **Ticketed** when work must survive several sessions or contains several
independently valuable vertical slices. Keep a compact outcome plan and one
current ticket. A completed or blocked ticket may be followed by another only
because the product plan requires it, never to gain more repair attempts.

Use **Governed** only for irreversible operations, credentials or security
boundaries, financial authority, destructive migrations, native process
ownership, or production external side effects. Governed work adds a frozen
acceptance contract, state record, independent review, and required authority
receipts.

Ambiguity does not imply Governed mode. Admit Wayfinder only when repository
evidence cannot resolve a genuine product or architecture choice and choosing
incorrectly would materially alter the outcome.

## Execute the state machine

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

A verification or review failure must identify a concrete defect before
diagnosis. Diagnosis states a falsifiable causal hypothesis. A repair must test
a new hypothesis and the same outcome receives no more than two semantic repair
rounds. An unchanged failing gate may be rerun once only when explicitly marked
potentially flaky. Repeating a failure without new causal evidence immediately
selects replanning.

Infrastructure and tool failures are not implementation defects. Replanning
must select exactly one terminal direction; it cannot generate a successor
ticket or decision solely to reset a budget.

## Review with minimum sufficient evidence

The reviewer begins with acceptance criteria, diff inspection, deterministic
tests, and static checks. Use `runtime-debug` only for runtime-state uncertainty,
wrong values, lifecycle or concurrency failures, crashes, hangs, or behavior
source and tests cannot explain. Use `interactive-gui` only when native GUI,
device, emulator, game, or desktop acceptance lacks a reliable structured
interface.

The reviewer remains read-only with respect to source. Record the reproducer,
test environment, relevant frames/variables or GUI actions, and sanitized
evidence. Convert a finding into a regression test before repair when practical.
If a required capability is unavailable, report `INSUFFICIENT_EVIDENCE` with an
alternate check or explicit manual obligation.

Every review emits exactly one of `PASS`, `FAIL`, or
`INSUFFICIENT_EVIDENCE`, plus the permitted next transition. Review never
repairs source or expands scope.

## Compatibility

`frontier-loop`, `execute-frontier`, `ticket-review`, and `repair-ticket` are
version-0.7 compatibility shims. They archive or read existing history, select
one current outcome, route to the adaptive skills, and emit deprecation
guidance. They do not continue a historical dependency graph.

