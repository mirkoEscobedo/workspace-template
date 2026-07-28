# Workspace Upgrade Master Plan

## Goal

Provide one seamless, atomic `workspace-template upgrade` workflow for both
generated and adopted repositories.

## Goal completion contract

- Bare `upgrade` plans and applies the running package's agentic substrate.
- `--dry-run` is zero-write and shows the exact preview.
- `--plan-out [path]` saves without applying and auto-generates a stable path
  when omitted.
- `--apply-plan` applies only the exact reviewed plan.
- Workspace origin, product files, durable memory, repository-owned skills,
  presets, and harness overrides are preserved by their declared ownership
  policies.
- The complete operation is atomic, recoverable, verified before and after,
  and idempotent.
- The packed tarball proves the public contract.

## Source and authority

1. Current user decisions.
2. `docs/agent/wayfinding/workspace-upgrade/`.
3. Repository `AGENTS.md`, agentic profile, and policies.
4. Existing CLI, plan, ownership, skill, preset, projection, checkpoint, and
   verification behavior.

## Locked decisions

- Incoming assets come from the running package without network discovery.
- Bare upgrade applies; dry-run previews; plan-out persists; apply-plan replays.
- Upgrade owns only the agentic substrate.
- Mode, timestamps, active preset, feature choices, and workspace state persist.
- One transaction owns all components; no partial mode.
- Full workspace verification runs before and after mutation.
- All schema generations currently accepted by doctor remain supported.

## Out of scope

- Product source/test refresh, dependencies, manifests, lockfiles, README, CI,
  deployment, Git initialization, commit, push, publish, and deployment.
- Rewriting durable agent docs, tickets, decisions, evidence, or migrations.
- Registry lookup or automatic installation.

## Human authority gates

- None for local implementation and verification.
- Push, pull request, publish, deployment, and release version changes remain
  separate human gates.

## Frontier execution policy

Run `execute-frontier` from local repository files. Use one writer, independent
read-only review, targeted repair, and serial landing. Do not ask between
ordinary tickets. Record exact Git diff and verification evidence.

This dogfood track executes on `agent-preset/sol-sol`, based on
`7342d9c5b868a64cfbd2c23e3bfda5722fff9de2`.

## Verification and architecture policies

See `policies/`. New upgrade behavior belongs in focused modules and tests;
do not grow adoption or preset tests into upgrade megafiles.

## Milestones

1. Pure public preview and installed-context recovery.
2. Complete managed-artifact, preset, skill, and projection planning.
3. Atomic apply, rollback, recovery, and full verification.
4. Legacy/workspace compatibility and packed distribution proof.

## Ticket index

| ID | Title | Lane | Blocked by |
|---|---|---:|---|
| UPG-001 | Upgrade preview and immutable plan | 2 | — |
| UPG-002 | Managed substrate reconciliation | 2 | UPG-001 |
| UPG-003 | Skill and projection upgrade | 3 | UPG-002 |
| UPG-004 | Atomic apply and recovery | 3 | UPG-003 |
| UPG-005 | Legacy and workspace compatibility | 3 | UPG-004 |
| UPG-006 | Packed distribution contract | 2 | UPG-005 |

## Completion rule

Every ticket is committed or explicitly superseded; focused and full checks
pass on the final diff; packed smoke proves both workspace origins; process
leases are closed; architecture budgets do not regress; and dogfood evidence
records the actual routing and repairs.

## Stop and escalation rule

Stop for ambiguous provenance, an unsafe write-set expansion, a product-file
mutation, a semantic conflict between ownership policies, missing user
authority, unrecoverable rollback, repeated verification failure requiring a
new strategy, or a contradiction with the Wayfinder decisions.

## User-authorized baseline repair C amendment — 2026-07-26

UPG-004 is reopened and UPG-006 is blocked until fresh gates. The amendment
authorizes only the write set recorded in those two contracts for native
process ownership, mutex safety, signal cleanup, disposable-copy verification,
sealed verifier authority, truthful routing, and repository-local rollback
claims. Earlier implementation and review evidence remains historical evidence;
new RED/GREEN, review, and landing results must be appended.

External and network effects are not reversible. Default verification is
confined to a disposable repository copy; any portable limitation that leaves a
command able to reach external paths or the network requires explicit approval
sealed into the plan. Apply-time flags cannot add that approval.

## Baseline repair landing — 2026-07-26

Repairs D and E resolved the reopened review findings without rewriting the
historical evidence above. UPG-004 and UPG-006 are closed after fresh full,
package, packed-smoke, doctor, ticket, architecture, diff, lease, mutex, and
three-lens review gates passed. The workspace remained on the user-selected
`sol-only` preset throughout this baseline landing.
