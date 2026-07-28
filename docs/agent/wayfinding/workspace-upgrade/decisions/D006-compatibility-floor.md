# D006 — Compatibility floor

## Question

Which previously installed workspace generations must upgrade?

## Decision

Support every generation currently accepted by doctor:

- config versions 1–3;
- profile versions 1–2;
- managed-files versions 1–3;
- skills-lock versions 1–2;
- workspace version 1.

Recover missing mode only from one trustworthy signal such as exactly one
origin timestamp or an explicit legacy schema rule. Never infer origin from
application layout. Invalid or unknown future schema/provenance blocks with
guidance to use a compatible package or adopt an unmanaged repository.

The authoritative mode table is:

| Config mode | Profile mode | Origin timestamps | Result |
|---|---|---|---|
| same explicit value | same or absent | matching timestamp or neither | preserve explicit mode |
| different explicit values | any | any | block |
| exactly one explicit value | absent | matching timestamp or neither | preserve explicit mode |
| absent | absent | exactly one of `createdAt` / `adoptedAt`, including `null` | recover generated / adopted |
| absent | absent | neither or both timestamps | block as ambiguous |
| explicit value | any | opposite timestamp or both timestamps | block as contradictory |

Property presence, not timestamp truthiness, is authoritative. No application
layout, Git history, starter file, or package-manager clue may recover mode.

## Consequences

- Read-only baseline migration planning is required for legacy skills.
- Generated, adopted, retrofit-alias, monorepo, and non-Git fixtures are part
  of acceptance.

## Evidence

- Compatibility validation in `src/doctor.js`.
