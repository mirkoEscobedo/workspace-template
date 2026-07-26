# D005 — Verification contract

## Question

What evidence is required before an upgrade transaction completes?

## Decision

Run dependency-aware full workspace verification before mutation and after
apply. Missing or unavailable required commands block before writes. A
post-upgrade failure restores the substrate.

Also require staged skill validation, projection preflight, preset consistency,
final doctor, no unexpected tracked mutations, zero owned descendants, and zero
open leases.

## Consequences

- A pre-existing broken checkout is distinguished from an upgrade regression.
- Upgrade is intentionally strict and may run the full gate twice.
- No setup or installation command is inferred.

## Evidence

- Explicit user decision requiring full verification.
- Existing `verifyWorkspace` dependency-aware state model.
