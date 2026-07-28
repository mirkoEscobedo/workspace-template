---
name: tdd
description: "Implement behavior changes through a vertical red-green-refactor loop at public seams, with independent expectations, boundary-only mocks, test-placement checks, and architecture budgets. Use for feature and bug implementation."
compatibility: ChatGPT Skills, Codex, OpenCode
metadata:
  version: "2.0.0"
---

# Test-Driven Development

## Core invariant

One observable behavior at a time:

```text
RED for the intended reason → minimum GREEN → optional refactor while GREEN
```

Do not bulk-write all tests before implementation.

## Before the first test

1. Read the ticket contract and identify the public seam.
2. Name the behavior in domain language.
3. Choose an expected value independent of the production implementation.
4. Inspect the target test file with `test-topology`. A locked file cannot grow.
5. Identify the exact L1 command and the expected RED reason.

## Cycle

1. Write one behavior-focused test through a public interface.
2. Run it and confirm it fails for the missing or broken behavior, not setup noise.
3. Implement the smallest production change that can pass.
4. Run the exact test to GREEN.
5. Run the smallest affected set needed to detect local regression.
6. Record the cycle in the implementation report.
7. Repeat for the next behavior.

After every two or three cycles, ask:

- Did the fixture or setup become larger than the behavior?
- Did a second behavior family enter this file?
- Is a helper duplicating production logic?
- Is the file crossing a warning, split, or lock threshold?
- Should the next test start in a behavior-oriented module?

## Test rules

- Test observable behavior, not private calls or internal ordering.
- Prefer real internal collaborators; mock only external or nondeterministic boundaries.
- Verify through the public interface where possible.
- One test may contain several assertions when they describe one coherent public outcome.
- Do not calculate the expected result with the same algorithm as production.
- Keep scenario builders declarative; move orchestration mechanics into support modules.

## Refactor

Refactor only while relevant tests are green. Favor deep modules, clear ownership, and behavior-oriented test modules. Run tests after each refactor step.

## Completion

The TDD portion is complete when every required behavior has meaningful RED/GREEN evidence, targeted regression checks pass, and the test topology did not worsen.

See `references/` for examples, mocking boundaries, deep modules, independent oracles, and test placement.
