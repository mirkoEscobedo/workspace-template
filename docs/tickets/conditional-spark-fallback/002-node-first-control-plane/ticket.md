# Ticket FBK-002 — Node-first fallback control plane

## Context

The fallback needs one durable routing circuit and one owned process boundary
on Node 24, while remaining compatible with existing Python and upgrade lease
records.

## Depends on

- FBK-001.

## Public outcome

The generated Node control plane persists fail-closed route/lease state and
owns every child through POSIX process groups or a Windows Job Object.

## Required behavior

- Define versioned routing state keyed by active preset fingerprint.
- Normalize Python `snake_case` and UpgradeVerificationRunner `camelCase`
  leases; reject unknown, conflicting, or identity-less records.
- Persist the complete lease before accepting a spawn.
- Use bounded POSIX TERM/KILL/wait/reap and Windows Job kill-on-close.
- Pass Windows argv as encoded data to a PowerShell/PInvoke host; never build
  an interpolated command string.
- Prefer Node hooks; retain Python fallback.
- Add a Node ticket-pack validator equivalent to the Python validator and run
  it against both `workspace-upgrade` and `conditional-spark-fallback`.
- Add `assets/scripts/check_architecture_budgets.mjs` with Python parity for
  valid reports, invalid YAML, invalid lock rules, warnings, output files,
  exit status, and intentional `--capture-baseline`; run it against both tracks.
- Own the package hook source `assets/configs/codex/hooks.json`: make it
  Node-first with an explicit tested Python compatibility fallback. Do not
  materialize the current repository's `.codex/hooks.json` until FBK-005.
- Prove all terminal paths close descendants and leases.

## Invariants

- One route transition per run.
- Identity verification precedes cleanup.
- No kill-by-name and no growth in `src/process-utils.js`.
- Active preset remains baseline `sol-only`.

## Out of scope

- OpenCode argv and semantic prompts.
- Live model calls.

## Acceptance criteria

- [ ] Both lease schemas normalize to the same canonical record.
- [ ] Unsafe/unknown state fails before spawn or kill.
- [ ] Native Windows and POSIX process-tree tests prove zero descendants.
- [ ] Node primary and Python fallback are both represented truthfully.
- [ ] Node validators and architecture checkers match Python behavior and pass
      both repository tracks.
- [ ] Generated hook-source tests prove Node-first selection and Python
      fallback without changing the current repository hook.

## Stop conditions

- Any stop condition in `contract.yaml`.
