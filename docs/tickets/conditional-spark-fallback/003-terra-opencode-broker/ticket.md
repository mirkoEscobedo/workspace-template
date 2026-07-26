# Ticket FBK-003 — Terra OpenCode broker

## Context

The native Terra agent may transport a frozen packet to OpenCode, but it must
not become a semantic agent or general command proxy.

## Depends on

- FBK-002.

## Public outcome

One collision-safe Terra/medium broker launches one fresh, owned
OpenCode Spark/xhigh semantic-role attempt through a fixed argv.

## Required behavior

- Accept only policy-derived eligible role, validated root, root-contained
  frozen packets, identities, and deadline.
- Resolve the OpenCode role from active routing and validate Spark/xhigh.
- Build the exact argv in D004 with a fixed broker instruction.
- Resolve Windows/POSIX executable forms without a shell.
- Disable update/share and reject auto, continue, session, share, dumps,
  arbitrary flags/models/agents/instructions, and unsafe paths.
- Stop on every broker failure; never retry or reuse a session.

## Invariants

- Terra transports; the Spark semantic agent works.
- Same scheduling slot and writer/read-only permissions are preserved.
- Ordinary tests use fake OpenCode only.

## Out of scope

- Refusal classification and live authentication.
- Session continuation or retry.

## Acceptance criteria

- [ ] Fake OpenCode observes the exact argv and fixed instruction.
- [ ] Injection/path/flag/model/role negative cases fail before spawn.
- [ ] One fresh process and one attempt are proved.
- [ ] Every failure closes descendants and leases.

## Stop conditions

- Any stop condition in `contract.yaml`.
