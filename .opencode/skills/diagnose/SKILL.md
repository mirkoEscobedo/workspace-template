---
name: diagnose
description: Diagnose bugs, flaky tests, regressions, and performance problems through reproduction, minimization, hypotheses, instrumentation, root-cause tracing, and regression protection. Use before changing code when the cause is uncertain.
license: MIT
compatibility: Requires repository inspection and the project's diagnostic/test commands.
metadata:
  version: "1.0.0"
  mode: model-invoked
---

# Diagnose before fixing

## Procedure

1. Capture the observed behavior, expected behavior, environment, exact command, and first known bad scope.
2. Reproduce it reliably. If it is intermittent, record frequency and control time, concurrency, randomness, network, and data.
3. Reduce the reproduction to the smallest input and public seam that still fails.
4. Trace data and control flow from the symptom toward the earliest incorrect state. Do not patch the last visible exception without locating its source.
5. Form one falsifiable hypothesis. State what evidence would support and refute it.
6. Add the least invasive instrumentation or targeted experiment. Run it and update the hypothesis.
7. When root cause is supported, write a regression test that fails for the defect.
8. Make the smallest root-cause fix, observe green, and remove temporary instrumentation.
9. Search for sibling cases sharing the same cause, then run focused and full verification.

## Stop conditions

Escalate rather than loop indefinitely when retry/action thresholds are exceeded, access is missing, production data is required, or the next experiment is destructive or high-risk.

## Completion criterion

Diagnosis is complete when the root cause explains the symptom and evidence, the regression test fails before the fix and passes after it, and temporary diagnostic changes are removed.
