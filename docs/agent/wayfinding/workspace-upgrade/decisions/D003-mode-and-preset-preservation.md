# D003 — Mode and preset preservation

## Question

How should generated/adopted identity and active routing behave during upgrade?

## Decision

Preserve `generated` versus `adopted`, the original timestamp including
`null`, project, style, TDD, package manager, architecture policy, feature
flags, agent targets, workspace graph, role IDs, local presets, and known
overrides.

Preserve the active preset by default. Recover the legacy Sol
coordinator/planner and Codex worker split as `sol-codex`. An explicit
`--preset <id>` selects a different active preset within the same reviewed
upgrade plan.

Render built-in routing from the incoming package catalog before replacing the
installed built-in definitions.

## Consequences

- Re-adoption cannot serve as upgrade because it hardcodes adopted semantics.
- Generated starter source is never refreshed.
- Config/profile mode disagreement or ambiguous legacy identity blocks.

## Evidence

- `src/adoption-plan.js` hardcodes adopted mode.
- `src/presets/catalog.js` otherwise prefers installed built-ins.
