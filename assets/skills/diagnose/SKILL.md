---
name: diagnose
description: Diagnose a concrete failing check, runtime defect, flaky result, or external/tool failure and choose repair, inspection, or replanning. Use before changing code when cause is uncertain.
license: MIT
compatibility: Requires repository inspection and the project's diagnostic/test commands.
metadata:
  version: "1.1.0"
  mode: model-invoked
---

# Diagnose before fixing

Capture the expected and observed behavior, exact command or interaction, environment, and smallest reproducer. Classify the failure before proposing a code change:

- `implementation`: evidence points to product or test code;
- `flaky`: the same unchanged gate may be rerun once with a stated flake hypothesis;
- `infrastructure`: toolchain, containment, resource, or runner failure;
- `external-blocker`: missing service, credential, device, production data, or human authority;
- `insufficient-evidence`: the material claim needs targeted runtime or GUI inspection.

Trace to the earliest incorrect state and state one falsifiable hypothesis plus supporting and refuting observations. Request `runtime-debug` for hidden program state, concurrency, crashes, hangs, or lifecycle faults. Request `interactive-gui` only for native GUI/device behavior without a structured seam.

Return `REPAIRING` only for a new supported implementation hypothesis with fewer than two prior semantic repairs. Return `INSPECTING` when a narrow capability can resolve missing evidence. Return `REPLANNING` for infrastructure, external blockers, repeated hypotheses, exhausted budget, false assumptions, material scope change, or infeasibility.

Do not generate instrumentation scripts, successor tickets, or decision files to extend the attempt budget. Prefer a regression test before repair and remove temporary diagnostic changes.
