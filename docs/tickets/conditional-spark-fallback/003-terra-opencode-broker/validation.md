# Validation — FBK-003

## Spec and authority

- Confirm exact role set, argv, model, variant, fixed instruction, one-attempt
  budget, and terminal failures.

## Code and test

- Inspect the pure argv/path validator and fake executable tests.
- Confirm writer and reviewer permissions are derived from the semantic role.

## Operations and security

- Confirm no shell interpolation, environment/credential dump, update, share,
  continuation, session reuse, external packet, or second attempt is possible.
- Confirm process cleanup evidence is exact.
- Run the FBK-002 package-asset Node validator and architecture checker against
  both ticket tracks; installed `.agentic` copies are not yet available.

## Pass conditions

All independent lenses, focused commands, fake OpenCode native checks,
architecture budgets, and zero-process/lease gates pass.

## Fail conditions

Fail on caller-controlled argv/instruction authority, unsafe path acceptance,
role-permission drift, retry/session reuse, or any leaked child.
