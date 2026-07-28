# D001 — Command lifecycle

## Question

How should preview, persisted review, and direct upgrade be exposed without
forcing users to invent plan names?

## Options considered

1. Preview by default and require a saved plan for every apply.
2. Apply by default with optional dry-run and persisted review.
3. Separate `upgrade plan` and `upgrade apply` subcommands.

## Decision

Use one option-driven command family:

```text
workspace-template upgrade .
workspace-template upgrade . --dry-run
workspace-template upgrade . --plan-out [path]
workspace-template upgrade . --apply-plan <path>
```

Bare `upgrade` seals and applies one atomic internal plan. `--dry-run` prints
the same preview without target writes. `--plan-out` saves without applying;
when no path is supplied it generates:

```text
.agentic/plans/upgrades/upgrade-<from>-to-<to>-<short-plan-id>.json
```

The output prints the saved path and exact apply command. Direct upgrade
retains its sealed plan under the ignored transaction directory for audit and
same-plan recovery.

## Consequences

- Ordinary upgrades are one command.
- Agents can inspect deterministic JSON with `--dry-run --json`.
- Review-first users receive a stable, automatically named plan.
- Only a persisted or internally sealed immutable plan reaches mutation.

## Evidence

- User decision in the coordinating conversation.
- Existing immutable plan machinery in `src/plans/`.
