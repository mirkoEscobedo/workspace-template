# Process Policy

Every spawned command has a run/ticket/agent lease. Completion requires zero owned descendants and zero open leases.

## Platform ownership

- POSIX: new session/process group, TERM grace, KILL, wait/reap.
- Windows: Job Object with kill-on-close; process-tree fallback only when necessary.

## Project-specific commands

UNRESOLVED.
