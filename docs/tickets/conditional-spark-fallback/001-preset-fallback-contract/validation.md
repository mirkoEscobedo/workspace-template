# Validation — FBK-001

Review the immutable contract, ticket, exact diff, implementation report, and
fresh evidence. Do not use implementer reasoning as proof.

## Spec and authority

- Confirm the JSON key, seven eligible roles, Terra/medium broker, Spark/xhigh
  semantic routing, and expanded state are exact.
- Confirm `sol-only`, legacy inputs, and human/remote authority remain intact.

## Code and test

- Run the focused preset fallback RED/GREEN tests and preset/config regressions.
- Inspect collision and partial-state tests for independent expectations.
- Confirm locked files do not grow and new modules remain within budgets.

## Operations and security

- Inject failures at every transactional write boundary and compare prior bytes
  and absence.
- Confirm unowned/drifted files are preserved and the manifest commits last.
- Confirm zero owned descendants and leases.

## Pass conditions

All three lenses pass independently; native checks and contract commands pass;
evidence matches the exact diff; active routing is still baseline `sol-only`.

## Fail conditions

Fail on semantic drift, non-atomic apply, unowned overwrite, false routing
state, architecture regression, active-preset change, or leaked process state.
