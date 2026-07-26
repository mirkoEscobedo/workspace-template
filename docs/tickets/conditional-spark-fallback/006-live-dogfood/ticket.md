# Ticket FBK-006 — Sol-only and fallback live dogfood

## Context

FBK-001 through FBK-005 must land under `sol-only`. Activation changes Codex
App routing and therefore creates a mandatory human restart boundary before
live proof.

## Depends on

- FBK-005.

## Public outcome

`sol-codex` is atomically activated and, only after a human App restart, a
bounded live native-refusal plus brokered implementer/reviewer proof passes;
`sol-codex` remains active.

## Pre-activation phase

- Verify exact sol-only fingerprint and independent review evidence for
  FBK-001 through FBK-005.
- Run the full offline acceptance commands.
- Build/review one immutable activation plan covering broker, expanded state,
  report, and managed manifest.
- Apply atomically with rollback/preconditions and preservation of unowned or
  drifted artifacts.
- Record the new fingerprint and restart-required checkpoint.

## Mandatory stop

Stop now. Do not run `opencode models`, native Spark, or brokered work. A human
must restart the Codex App and explicitly resume this coordinator.

## Post-restart phase

- Reconfirm active fingerprint and broker discovery.
- Confirm `opencode models openai` exposes
  `openai/gpt-5.3-codex-spark`.
- Verify the pre-restart frozen packet and hash at
  `evidence/live/packet.md`.
- Capture native Spark implementer pre-start refusal with no child identity.
- Run one brokered evidence-only fixture implementer. It alone may write
  `evidence/live/implementer.marker` and
  `evidence/live/implementer-report.json`.
- Run one fresh `reviewer-code` session. The reviewer itself is read-only; only
  broker/coordinator capture may write `evidence/live/reviewer-report.json`.
- Validate `<run-id>` by safe-component rules. The controller may write only
  `.agent/runs/<run-id>/routing-state.json`,
  `.agent/runs/<run-id>/attempts/implementer-1.json`, and
  `.agent/runs/<run-id>/attempts/reviewer-code-1.json`.
- Use only the fixed safe-component agent IDs `native-spark-implementer`,
  `opencode-spark-implementer`, and `opencode-spark-reviewer-code`. Their
  transient leases are exactly
  `.agent/leases/<run-id>--FBK-006--<agent-id>.json`; retained evidence uses
  the same three names ending `.final.json`.
- At completion remove all three transient lease files. Retain all three
  `.final.json` records with final outcome and remaining descendants. No other
  lease path is allowed.
- Verify final `sol-codex`, zero descendants, and zero leases.

## Invariants

- No proof before restart; no fallback after identity/start.
- The packet hash cannot change; implementer, reviewer, capture, and controller
  ownership is limited to the exact paths above.
- The lease owner IDs and six lease paths are exact. Transient leases are absent
  at completion; terminal `.final.json` evidence remains.
- No retries, production changes, release mutation, or remote action.
- Failed proof stops and remains truthful; it does not silently reroute/revert.

## Acceptance criteria

- [ ] Human restart gate is durably observed.
- [ ] Model discovery, native refusal, implementer, and reviewer evidence are
      exact.
- [ ] The implementer writes only its two files, the reviewer writes nothing,
      broker/coordinator capture writes only the reviewer report, and the
      controller writes only the three safe-run files.
- [ ] Only the six frozen lease paths are touched; all transient leases are
      removed and all three final records report outcome and remaining
      descendants.
- [ ] Final status is `sol-codex` with zero descendants/leases.

## Stop conditions

- Any stop condition in `contract.yaml`.
