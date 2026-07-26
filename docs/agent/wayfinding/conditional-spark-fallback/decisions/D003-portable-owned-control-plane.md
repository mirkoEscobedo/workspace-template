# D003 — Portable owned control plane

## Question

What runtime and process-ownership boundary may launch the OpenCode fallback?

## Context

Generated workspaces require an offline-capable runner on Windows and POSIX.
The package already requires Node 24 and includes Python lifecycle helpers, but
Python cannot be assumed as the primary generated runtime.

## Options considered

### Python-only lifecycle

This adds an avoidable runtime prerequisite to the primary path.

### Node 24 primary with Python compatibility fallback

This matches the package engine while preserving existing environments and
doctor behavior.

## Decision

Use Node 24 as the primary generated control plane and retain Python as a
fallback where the Node hook cannot run. Generated hooks prefer Node; doctor
treats Python as optional and validates the available path.

Every attempt creates a durable lease before it is accepted as started. The
lease records run, ticket, and agent IDs; PID and process-start identity;
command digest; validated working directory; start time and deadline; platform
ownership handle; final state; and remaining descendants.

The Node control plane must explicitly normalize both durable schemas already
present in the repository: the Python lifecycle's `snake_case` fields and
`UpgradeVerificationRunner`'s `camelCase` fields. The normalized form is
versioned. Unknown, ambiguous, mixed-conflicting, or identity-less records fail
closed; migration never guesses process identity or ownership.

- POSIX launches the command in a dedicated process group/session, sends
  bounded TERM then KILL to that owned group, closes pipes, waits/reaps, checks
  start identities, and verifies zero descendants.
- Windows uses a Job Object with kill-on-close. A PowerShell/PInvoke host
  receives an encoded argument array and never interpolates an executable,
  argument, path, packet, or instruction into a command string.

Timeout, cancellation, normal exit, spawn error, broker failure, and
coordinator stop all close the same ownership boundary. No process is killed
by executable name.

## Consequences

- The Node control plane is a reusable generated artifact and a source-package
  asset.
- Existing Python lifecycle support remains compatible rather than mandatory.
- Ticket completion and live proof require zero owned descendants and zero
  open leases.

## Evidence

- User-approved Node/Windows/POSIX lifecycle contract.
- `package.json` (`node >=24`)
- `.agents/skills/process-lifecycle/SKILL.md`
- `.agents/skills/process-lifecycle/references/windows-job-object.md`
- `src/process-utils.js`
- `assets/configs/codex/hooks.json`

## Newly visible work

- Implement and fake-test the control plane in FBK-002.
- Distribute and doctor it in FBK-005.
