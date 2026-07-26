# D005 — Offline compatibility and validation

## Question

How is the fallback delivered without breaking existing workspaces or requiring
network access during generation and tests?

## Context

`workspace-template` creates, adopts, upgrades, and switches presets from
package-owned assets while preserving repository-owned configuration.

## Options considered

### Require migration to a new preset generation

This would reject existing preset files and violate current upgrade
compatibility.

### Add optional fields and package every control-plane asset

This preserves legacy inputs and keeps generated behavior deterministic.

## Decision

The preset schema and runtime validator accept existing version-1 presets with
no `fallbacks` key. Optional fallback metadata is strictly validated when
present. Create, adopt, upgrade, and preset plan/apply materialize the same
collision-safe broker and Node-first control-plane assets from the installed
package. User-owned collisions and invalid configuration are preserved or
reported through the existing partial/conflict policy; they are never silently
overwritten.

All ordinary tests use a fake OpenCode executable and frozen packets. Packed
smoke proves the package contains and can generate the fallback artifacts
without downloading dependencies, discovering models, authenticating, or
making a live model call.

Verification includes legacy presets, `sol-only` broker absence and unchanged
fingerprint, `sol-codex` truthful expanded routing, collision behavior,
forbidden arguments, root containment, one-attempt sessions, refusal
categories, circuit persistence, process cleanup, generated/adopted/upgrade
flows, and packed consumption.

## Consequences

- Python remains an optional fallback and doctor reports availability
  truthfully.
- No release bump, publish, push, deploy, or network fetch belongs to the
  distribution ticket.

## Evidence

- User-approved compatibility and packed-test requirements.
- `src/create.js`
- `src/adoption-plan.js`
- `src/upgrade/artifacts.js`
- `src/doctor.js`
- `scripts/packed-smoke.js`
- `test/presets.test.js`

## Newly visible work

- Complete offline distribution and packed proof in FBK-005.
