# Validation — Ticket NNN

## Review package

Review the immutable ticket contract, ticket text, exact diff, implementation report, and verification evidence. Do not use the implementer's reasoning as proof.

## Required lenses

### Spec and authority

- Confirm every required public behavior and invariant.
- Confirm ordering and authority boundaries.
- Identify missing behavior, scope creep, or persistence before validation.

### Code and test architecture

- Confirm tests exercise public seams with independent expectations.
- Confirm architecture and megafile budgets did not worsen.
- Confirm no internal test helper duplicates production logic.

### Operations and security

Run only when the contract requires it.

## Verification commands

Use targeted checks first. Do not repeat a full suite solely because a reviewer started.

## Pass conditions

All required lenses pass, evidence matches the exact diff, budgets pass, and owned process count is zero.

## Fail conditions

Fail on missing behavior, wrong authority/order, unexplained scope, invalid evidence, architecture-budget regression, leaked processes, or a required native check that did not run.
