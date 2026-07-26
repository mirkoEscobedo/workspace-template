# Validation — FBK-006

## Spec and authority

- Confirm sol-only provenance for FBK-001–005, atomic activation, the human
  restart evidence, post-restart ordering, exact route, and final active state.
- A reviewer cannot waive or infer the restart.

## Code and test

- Re-run the exact final command set on the current diff.
- Compare implementer marker/report and reviewer report with independent
  expectations. Verify the implementer alone owns its two outputs, the
  reviewer session is fresh/read-only, and only broker/coordinator capture
  writes the reviewer report.

## Operations and security

- Inspect activation rollback/preconditions, verbatim/normalized refusal,
  absence of child identity, exact argv/routing state, allowed-write diff,
  process identities, descendants, and leases.
- Re-hash `evidence/live/packet.md`; validate `<run-id>` by safe-component
  rules; enumerate `.agent/runs/<run-id>` and prove its only files are
  `routing-state.json`, `attempts/implementer-1.json`, and
  `attempts/reviewer-code-1.json`.
- Enumerate `.agent/leases/` by the same run ID. Prove the only attempted lease
  paths are the three `--FBK-006--native-spark-implementer`,
  `--FBK-006--opencode-spark-implementer`, and
  `--FBK-006--opencode-spark-reviewer-code` names plus their `.final.json`
  counterparts.
- Confirm the three transient `.json` leases are absent at completion and each
  retained `.final.json` record states final outcome and remaining descendants.

## Pass conditions

All offline and post-restart native checks pass; three independent lenses pass;
evidence matches the exact diff/run; no unexpected writes or processes remain;
`sol-codex` is active.

## Fail conditions

Fail on proof before restart, stale fingerprint, missing model, child identity,
wrong refusal, auth/timeout/nonzero/malformed output, retry/second transition,
packet hash drift, invalid run ID, wrong role ownership, any extra live or
run-scoped file, any extra/missing lease path, retained transient lease,
nonterminal or incomplete final lease evidence, process leak, or active-state
mismatch.
