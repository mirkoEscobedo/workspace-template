# D002 — Run-scoped refusal transition

## Question

When may the coordinator change a run from native Spark delegation to the
Terra/OpenCode route?

## Context

A fallback after a child starts can duplicate writes, reviews, or integrations.
Uncategorized errors can also hide real semantic failures. The prior dogfood
attempt returned a model refusal before a child identity existed.

## Options considered

### Retry or fallback after any delegation failure

This is unsafe because the original child may have started or produced effects.

### Freeze one route from a pre-start first-role probe

This makes the transition observable, non-duplicating, and run-scoped.

## Decision

Each run starts with no selected delegated route and a closed circuit keyed by
the active preset fingerprint. On the first scheduled eligible semantic role:

1. make exactly one native Spark attempt;
2. if a child identity is returned, lock the run to native routing and never
   fallback in that run;
3. if and only if the attempt is categorized as
   `unsupported-model`, `unavailable-model`, or `refused-model`, occurs before
   child start, and returns no child identity, persist the verbatim refusal and
   normalized category, open the circuit, and lock the run to broker routing;
4. any other result stops.

The durable state is
`.agent/runs/<run-id>/routing-state.json`. It records the active preset ID and
fingerprint, circuit state, selected route, semantic role, native attempt,
verbatim refusal, normalized category, absence or presence of child identity,
broker attempts, timestamps, and terminal state. A fingerprint mismatch,
malformed/ambiguous state, or second route transition stops.

The broker occupies the same semantic role and scheduling slot as the refused
native child. It does not create concurrency. Writer roles remain the sole
writer; every reviewer uses a fresh read-only session.

Fallback is forbidden after any child identity or start signal and for tool,
test, review, cancellation, ordinary ticket, authentication, timeout,
nonzero-exit, or semantic failure. Broker refusal, authentication failure,
timeout, nonzero exit, or a second routing failure stops the run.

## Consequences

- There is no fallback loop and no second native probe after the circuit opens.
- A successful native first child prevents later opportunistic fallback.
- Routing evidence is reviewable and cannot cross preset fingerprints.

## Evidence

- User-approved state-machine and stop semantics.
- `docs/tickets/workspace-upgrade/current-sprint.md`
- `.agentic/policies/process.yaml`

## Newly visible work

- Implement durable routing state in FBK-002.
- Teach the coordinator transition in FBK-004.
