# Validation — FBK-002

## Review package

Review contract, ticket, exact diff, implementation report, focused tests, and
native process evidence independently.

## Spec and authority

- Confirm state fields, fingerprint keying, route-transition budget, and
  fail-closed schema rules.

## Code and test

- Confirm tests exercise public control-plane seams with independent process
  and state oracles.
- Compare Node ticket validator and architecture checker outputs/exit codes
  with Python for both valid tracks, invalid YAML, invalid lock rules, and
  intentional baseline capture.
- Confirm tests inspect the generated hook source and prove Node-first
  selection plus Python fallback; `.codex/hooks.json` must remain untouched.
- Confirm `src/process-utils.js` and locked tests did not grow.

## Operations and security

- Run native POSIX/Windows checks where available.
- Inspect argument-array transport, start-identity checks, TERM/KILL/Job close,
  wait/reap, lease finalization, and failure cleanup.
- Run both package-asset Node validators and checkers against
  `workspace-upgrade` and `conditional-spark-fallback`.

## Pass conditions

All lenses pass; schema fixtures, Node/Python parity matrix, both-track
validator/checker runs, generated-hook tests, native ownership checks,
architecture gates, and zero-process/lease postconditions pass on the exact
diff.

## Fail conditions

Fail on guessed identity, ambiguous schema acceptance, interpolated Windows
command input, validator/checker parity drift, invalid YAML/lock acceptance,
unreviewed baseline capture, Python-first hook rendering, current-repository
hook materialization, unowned kill, unverifiable descendants, or leaked leases.
