---
name: verify
description: Gather fresh evidence that a coding change is complete by running focused and full checks, inspecting the diff, and reporting exact results and unverified items. Use before claiming a feature, fix, refactor, or review is done.
license: MIT
compatibility: Requires repository inspection and command execution.
metadata:
  version: "1.0.0"
  mode: model-invoked
---

# Verify before completion

Claims follow evidence, never the reverse.

## Procedure

1. Read the command table in the nearest `AGENTS.md` and inspect actual project scripts/tooling.
2. Run the most focused test that demonstrates the changed behavior.
3. Run the relevant static/type/analyzer check and linter.
4. Run the full verification command or the broadest feasible suite.
5. Inspect the final diff and status:
   - no unrelated or debug changes;
   - no secrets or sensitive fixtures;
   - lockfiles and generated files are expected;
   - public contracts/docs are synchronized;
   - no skipped tests, ignored diagnostics, or disabled controls were introduced without explanation.
6. For UI or integration behavior not covered automatically, perform the smallest reproducible manual check and record it.
7. Report each command, whether it passed, and the meaningful summary. Report tools or environments that were unavailable.

## Language

Use “verified” only for checks run in the current change state. Use “not run” or “not verified” for assumptions. Do not infer a full-suite pass from a focused test.

## Completion criterion

Verification is complete when fresh evidence covers the changed behavior and repository-wide quality gates, the final diff is inspected, and every gap is visible to the user.
