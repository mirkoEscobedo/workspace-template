---
name: process-lifecycle
description: "Own every spawned command with a durable process lease, whole-tree cancellation, bounded timeouts, resource limits, and a zero-descendant completion gate. Use for tests, servers, native tools, MCP processes, or harness cleanup."
compatibility: ChatGPT Skills, Codex, OpenCode
metadata:
  version: "0.6.0"
---

# Process Lifecycle

Prompt instructions are not process isolation. Every command that may outlive its shell must have an owner.

## Lease contract

Record `run_id`, `ticket_id`, `agent_id`, PID, process start identity, command digest, working directory, start time, deadline, and platform ownership handle under `.agent/leases/`.

## Execution

1. Spawn in a new process session/group on POSIX or a Job Object/process group on Windows.
2. Register the lease before accepting the command as started.
3. On normal exit, interruption, timeout, agent cancellation, or coordinator shutdown:
   - request graceful termination for the whole tree;
   - wait a bounded grace period;
   - force-kill remaining owned descendants;
   - close pipes and wait/reap;
   - verify process identity before killing to avoid PID reuse;
   - write final evidence and close the lease.
4. Ticket/subagent completion requires zero live owned descendants and zero open leases.

## Usage

Use the provided wrapper where practical:

```bash
python scripts/managed_command.py   --run-id run-123 --ticket-id T012 --agent-id implementer-1   --timeout 900 -- <command> <args>
```

Use `scripts/codex_stop_guard.py` with Codex `Stop` and `SubagentStop` hooks. It attempts cleanup and blocks completion once when owned processes remain.

## Safety

Never kill processes by executable name alone. Kill only a matching lease identity and its descendants. Do not use blanket `killall node`, `taskkill /IM python.exe`, or equivalent.

For high-fanout stress tests, add cgroup/container/PID-namespace or Windows Job Object resource limits; the Python wrapper is a baseline, not a substitute for OS-level quotas.
