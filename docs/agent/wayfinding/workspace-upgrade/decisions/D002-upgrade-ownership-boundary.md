# D002 — Upgrade ownership boundary

## Question

Which repository state belongs to the unified upgrade transaction?

## Decision

Upgrade the complete package-owned agentic substrate: configuration and
profiles, schemas, policies, scripts, built-in presets, canonical skills,
baselines, locks, harness routing, role files, projections, workspace metadata,
managed instruction sections, and ownership manifests.

Preserve product files and durable planning memory. Locally editable skills use
three-way merge. Structured harness settings retain user-owned values. Local
presets remain repository-owned. Drift without trustworthy ownership blocks or
becomes a deterministic instruction proposal; it is never overwritten through
broad generator identity.

## Consequences

- `skills update`, preset activation, and re-adoption are not composed as
  separate mutation transactions.
- Durable docs are removed from package ownership when necessary but are not
  deleted or rewritten.
- No dependency, network, Git, publish, or deployment effect is authorized.

## Evidence

- Current ownership and merge seams in `src/adoption-plan.js`,
  `src/skills/`, `src/presets/`, and `src/sync.js`.
