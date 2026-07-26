# D006 — Dogfood activation and restart authority

## Question

In what order may this repository activate and live-prove the fallback?

## Context

The current session and repository are intentionally running `sol-only`.
Changing a preset rewrites agent configuration that the Codex App cannot
truthfully consume until it restarts.

## Options considered

### Activate early or run live proof before restart

This would contaminate the sol-only implementation evidence and could test
stale agent routing.

### Implement under sol-only, then activate, stop, restart, and prove

This separates implementation dogfood from live routing dogfood and preserves
the human authority boundary.

## Decision

FBK-001 through FBK-005 are implemented, independently reviewed, and serially
landed from base
`fe7e325958ff56eefa3bd97a54fabed58c845de6` while the active preset remains
`sol-only` with fingerprint
`793606dafbcd5571feb039beaad992c501952fe7a8d33a913a035653a10420b6`.

FBK-006 first reruns the required offline gates, then atomically activates
`sol-codex` through the reviewed preset plan/apply mechanism. Immediately after
activation it records the new fingerprint and restart-required state and must
stop before `opencode models` or any native/broker delegation.

A human restarts the Codex App and explicitly resumes the coordinator. Only
then may FBK-006:

1. confirm the active fingerprint and collision-safe broker discovery;
2. run `opencode models openai` and confirm
   `openai/gpt-5.3-codex-spark`;
3. capture the native Spark implementer pre-start refusal with no child
   identity;
4. run one brokered evidence-only fixture implementer and verify its expected
   marker/report, exact routing state, and no unexpected writes;
5. run one fresh brokered read-only reviewer and verify its report and no
   writes;
6. prove zero owned descendants and zero open leases.

The sole live input is frozen before restart at
`docs/tickets/conditional-spark-fallback/006-live-dogfood/evidence/live/packet.md`.
The implementer alone may write `implementer.marker` and
`implementer-report.json` in that directory. The reviewer session is read-only;
broker/coordinator capture alone may write `reviewer-report.json`. After
safe-component validation, the controller may write only
`.agent/runs/<run-id>/routing-state.json`,
`.agent/runs/<run-id>/attempts/implementer-1.json`, and
`.agent/runs/<run-id>/attempts/reviewer-code-1.json`.

The proof is bounded, evidence-only, and uses no production/release mutation.
Leave `sol-codex` active. A failed discovery, refusal-category mismatch,
unexpected native child identity, authentication error, timeout, nonzero exit,
unexpected write, second routing failure, or process leak stops without
rerouting or reverting the preset.

## Consequences

- This planning run itself is sol-only dogfood evidence.
- Reviewer passes cannot waive the restart.
- FBK-006 cannot complete on the activation side of the gate.

## Evidence

- User-approved dogfood sequence and acceptance proof.
- `.agentic/policies/model-routing.yaml`
- `.agentic/config.json`
- `docs/tickets/workspace-upgrade/current-sprint.md`

## Newly visible work

- Compile FBK-006 as a lane-3 ticket with a mandatory mid-ticket human gate.
