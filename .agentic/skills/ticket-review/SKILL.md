---
name: ticket-review
description: "Use when one Frontier Loop ticket diff needs an independent read-only spec-authority, code-test, operations-security, or combined low-risk review grounded in the frozen contract and fresh evidence."
compatibility: ChatGPT Skills, Codex, OpenCode
metadata:
  version: "0.6.0"
---

# Ticket Review

## Independence

Use a fresh context when available. Consume the frozen contract, ticket, validation prompt, exact diff, implementation report, and evidence paths. Do not treat the implementer's explanation as proof and do not modify files.

## Lens: spec-authority

Check:

- every required behavior and acceptance criterion;
- invariant preservation;
- missing or partial behavior;
- scope creep;
- ordering of validation, persistence, approval, and apply;
- authority boundaries and required human gates;
- idempotency, restart, and stale-input behavior where specified.

## Lens: code-test

Check:

- public seams and independent expected values;
- tests that survive internal refactoring;
- hidden production logic in fixtures or mocks;
- duplication, shallow modules, and architecture-budget regressions;
- growth of locked or concentrated test files;
- error handling and observability appropriate to the ticket;
- actual diff versus write set and conflict keys.

## Lens: operations-security

Check:

- process-tree ownership, cancellation, timeouts, and zero-descendant postcondition;
- resource bounds and cleanup after failure;
- persistent state, migration, recovery, and replay;
- network/native boundary claims;
- sensitive data, credentials, redaction, and destructive effects.

## Combined lens

Use only for Lane 0 or a demonstrably tiny Lane 1 diff. Cover spec and code-test; add operations checks if the change spawns processes or changes persistent/external effects.

## Report

For each finding provide severity, lens, requirement/evidence reference, file and symbol/hunk, consequence, and a concrete pass condition. Distinguish:

- `BLOCKING`: correctness, scope, authority, safety, invalid evidence, or budget failure;
- `IMPORTANT`: maintainability or test defect that should be repaired before landing;
- `MINOR`: non-blocking improvement for the final ledger.

Return `PASS` only when the assigned lens has no blocking or important finding and required evidence is valid for the exact diff.
