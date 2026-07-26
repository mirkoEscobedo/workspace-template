# Validation — FBK-005

## Spec and authority

- Confirm all consumer modes receive the locked contract without activation,
  network, release, or remote side effects.

## Code and test

- Run exact create/adopt/upgrade/config/preset and packed suites.
- Compare installed Node validator/checker bytes with the FBK-002 package
  assets and run both tools against both ticket tracks.
- Inspect focused placement and locked-file no-growth.

## Operations and security

- Inject upgrade failures and compare exact prior bytes/absence, ownership
  manifests, local presets, drifted agents, and active fingerprint.
- Confirm fake OpenCode only, no auto-update/share, and zero descendants/leases.
- Confirm `.codex/hooks.json` is the reviewed Node-first generated source with
  the Python compatibility fallback intact.

## Pass conditions

Three independent lenses, full/packed/doctor/status commands, rollback checks,
architecture budgets, installed validator/checker parity and both-track runs,
current-hook materialization, and sol-only fingerprint evidence pass.

## Fail conditions

Fail on network/live calls, silent overwrite, non-atomic install, active broker,
fingerprint drift, missing/mismatched installed Node validator/checker,
Python-first or fallback-free current hooks, missing packed asset, or
release/remote mutation.
