# Ticket UPG-005 — Legacy and workspace compatibility

## Public outcome

Every managed workspace generation currently recognized by doctor upgrades
without changing origin, product files, durable memory, or module semantics.

## Required behavior

- Cover config 1–3, profile 1–2, managed-files 1–3, skill-lock 1–2, and
  workspace 1.
- Cover generated stacks, adopted/retrofit workspaces, monorepos, and non-Git.
- Recover legacy routing and trustworthy origin evidence conservatively.
- Reject ambiguous mode, future schema, invalid provenance, unsafe symlinks,
  dirty state without approval, active transactions, and leases.
- Strengthen doctor to require config/profile mode equality.
- Prove the second upgrade is a no-op.

## Acceptance criteria

- [ ] All protected product and durable paths are byte-identical.
- [ ] Generated and adopted modes remain distinct.
- [ ] Every supported legacy fixture passes doctor after upgrade.
- [ ] No-op reruns contain no content churn.
