# Current Sprint — Conditional Spark Fallback

## State

- Planning compiled from clean base
  `fe7e325958ff56eefa3bd97a54fabed58c845de6`.
- Branch: `agent-preset/sol-sol`.
- Active preset: `sol-only`.
- Active fingerprint:
  `793606dafbcd5571feb039beaad992c501952fe7a8d33a913a035653a10420b6`.
- This planner run is sol-only dogfood evidence.
- FBK-001 is ready. FBK-002 through FBK-006 are dependency-blocked.
- Writer limit: one. Landing: serial.

## Restart checkpoint

FBK-006 contains a mandatory mid-ticket checkpoint. After atomic
`sol-codex` activation, record the new active fingerprint and restart-required
state, then stop. Do not run `opencode models`, native Spark delegation, or
brokered proof until a human restarts the Codex App and explicitly resumes.

The live packet is frozen before that stop at
`006-live-dogfood/evidence/live/packet.md`. After restart, implementer output is
limited to `implementer.marker` and `implementer-report.json`; the reviewer is
read-only and broker/coordinator capture alone may write
`reviewer-report.json`. A safe-component `<run-id>` owns only
`routing-state.json`, `attempts/implementer-1.json`, and
`attempts/reviewer-code-1.json`.

## Prohibited track actions

No release/version bump, push, pull request, publish, deploy, or remote
mutation.
