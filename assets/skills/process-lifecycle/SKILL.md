---
name: process-lifecycle
description: "Own long-lived, detached, native, server, MCP, or otherwise risky process trees with bounded cancellation and cleanup. Use only when an ordinary foreground command cannot provide sufficient lifecycle ownership."
compatibility: ChatGPT Skills, Codex, OpenCode
metadata:
  version: "0.8.0"
---

# Process Lifecycle

This is an optional Governed specialist skill, not a default wrapper for ordinary foreground tests and builds. Use normal command execution when the host already provides bounded ownership and the command cannot outlive it. When a process may detach, survive cancellation, or control native descendants, prompt instructions are not process isolation and explicit ownership is required.

## Execution

1. For repository verification on Windows, use `workspace-template verify`; the native executable assigns the suspended child to a kill-on-close Job Object before resuming it. Read the [Windows Job Object contract](references/windows-job-object.md) when native descendant ownership is material.
2. For an unsupported long-lived command, require a qualified host process-ownership provider. The package does not silently fall back to package-authored scripts.
3. On normal exit, interruption, timeout, agent cancellation, or coordinator shutdown:
   - request graceful termination for the whole tree;
   - wait a bounded grace period;
   - force-kill remaining owned descendants;
   - close pipes and wait/reap;
   - verify process identity before killing to avoid PID reuse;
   - record the bounded cleanup evidence.
4. Completion requires zero live owned descendants. If ownership cannot be established, return `INSUFFICIENT_EVIDENCE` or replan; do not generate a wrapper or lease campaign.

## Safety

Never kill processes by executable name alone. Kill only a matching lease identity and its descendants. Do not use blanket `killall node`, `taskkill /IM python.exe`, or equivalent.

For high-fanout stress tests, add cgroup/container/PID-namespace or Windows Job Object resource limits through a qualified provider.
