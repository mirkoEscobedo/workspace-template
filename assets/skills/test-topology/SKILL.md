---
name: test-topology
description: "Use when test or production files need architecture-budget auditing, megafile no-growth locks, behavior-oriented placement, or a behavior-preserving decomposition plan."
compatibility: ChatGPT Skills, Codex, OpenCode
metadata:
  version: "0.6.1"
---

# Test Topology

## Before adding tests

1. Measure the target file, case count, fixture/support size, runtime, and recent touch frequency when available.
2. Read `policies/architecture-budgets.yaml` or the supplied budget file.
3. If the file is locked, do not add LOC. Create a new behavior-oriented module or perform a dedicated decomposition.
4. If the patch adds a new behavior family, place it in a new module even below the hard threshold.
5. Keep scenario data declarative and extract reusable environment drivers into `support/`.

## Megafile intervention

When a locked file repeatedly blocks work:

1. Freeze behavior and capture targeted checks.
2. Identify stable behavior families and shared support mechanics.
3. Move tests without changing assertions or production behavior.
4. Run targeted checks after each move.
5. Remove duplication only after relocation is green.
6. Update the baseline and unlock only when the new modules fit policy.

## Deterministic check

Run:

```bash
python scripts/check_architecture_budgets.py --root <repo> --config <budget.yaml>
```

Use `--capture-baseline` to create or refresh a baseline intentionally. Baseline changes require review; they are not an automatic way around a violation.
