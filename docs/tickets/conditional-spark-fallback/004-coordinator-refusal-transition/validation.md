# Validation — FBK-004

## Spec and authority

- Compare every transition and terminal category against D002.
- Confirm no model/reviewer output can widen authority.

## Code and test

- Exercise the state machine at public seams with independent child-identity,
  persisted-state, broker-attempt, and scheduling-slot expectations.
- Compare generated instructions with runtime behavior.

## Operations and security

- Confirm state persistence precedes spawn and all stop paths close leases and
  descendants.
- Confirm one writer and fresh read-only reviewer sessions.
- Run the FBK-002 package-asset Node validator and architecture checker against
  both ticket tracks; installed `.agentic` copies are not yet available.

## Pass conditions

All three independent lenses and exact tests pass; no forbidden case launches a
broker; baseline `sol-only` routing and process postconditions remain exact.

## Fail conditions

Fail on fallback after identity/start, uncategorized transition, second route,
permission/concurrency drift, stale state, or process leakage.
