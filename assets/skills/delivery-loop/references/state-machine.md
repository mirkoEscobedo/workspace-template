# Adaptive Delivery state machine

The normal path is:

`INTAKE -> ROUTED -> PLANNED -> IMPLEMENTING -> VERIFYING -> REVIEWING -> ACCEPTED`

Failure transitions:

- A concrete verification or review defect enters `DIAGNOSING`.
- A correctness claim that cannot be established statically enters `INSPECTING`.
- A supported, new falsifiable hypothesis may enter `REPAIRING`, then returns to `VERIFYING`.
- False assumptions, material scope change, infeasibility, unavailable required evidence, repeated hypotheses, and exhausted repair budget enter `REPLANNING`.
- Replanning terminates with exactly one of `REDIRECTED`, `DEFERRED`, or `ABORTED`. A redirected outcome starts a fresh run; it does not silently reset the current run's counters.

Limits are exact:

- at most two semantic repair rounds per outcome;
- at most one unchanged rerun, and only when explicitly classified as potentially flaky;
- no second repair for the same hypothesis;
- infrastructure and external-service failures are not implementation defects;
- no automatic successor work to extend an exhausted budget.

The reviewer returns `PASS`, `FAIL`, or `INSUFFICIENT_EVIDENCE` and a permitted next transition. Only `PASS` may enter `ACCEPTED`.
