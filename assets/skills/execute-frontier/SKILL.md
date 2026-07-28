---
name: execute-frontier
description: "Continuously execute a local Frontier Loop ticket DAG from the current coordinator conversation. Uses dependency and conflict scheduling, role-isolated subagents when available, independent review, targeted repair, neutral integration, serial landing, and durable local evidence. No external issue tracker or event watcher is required."
compatibility: ChatGPT Skills, Codex, OpenCode
metadata:
  version: "0.6.0"
---

# Execute Frontier

Frontier is the default and only execution workflow. The coordinator reads local files, selects the next safe work, dispatches bounded roles when available, serially lands passed work, recomputes the frontier, and continues until completion or a real stop condition.

## Active role routing

Read `.agentic/policies/model-routing.yaml` before dispatching work. It records
the active versioned preset and the expanded model and reasoning assignment for
each role. Repository policy may change routing only through a reviewed preset
activation.

## Scheduler invariant

A ticket is runnable only when every blocker is complete, no active writer intersects its expected write set or conflict keys, and its risk policy permits concurrency.

```text
ready = status == ready
        AND all(blocked_by are committed, closed, or superseded)
        AND no active writer intersects write_set
        AND no active writer intersects conflict_keys
        AND required human gates are not pending
```

## Default topology

Start with:

- one coordinator in the current conversation;
- one write-capable implementation worker;
- up to two read-only scouts or reviewers;
- serial integration and commits.

Enable a second writer only after measured clean operation and only for Lane 0–2 tickets with disjoint write sets, disjoint conflict keys, isolated worktrees, and no shared schema, root manifest, generated registry, migration order, central fixture, or authority state machine.

Lane 3 always has one writer.

## Continuous local loop

1. Load `master-plan.md`, `track.yaml`, `frontier.json`, policies, the current Git state, and retained evidence. Conversation memory is useful context but is not canonical state.
2. Validate the ticket pack. When `frontier.json` is schema v2, run the updater declared by `track.yaml`; never use the generic schema-v1 `--write-frontier` path for that track.
3. Select the first ready ticket by declared priority unless the user explicitly selected another.
4. Run read-only preflight when the contract is uncertain, touches a locked file, or is Lane 2–3:
   - specification/authority lens;
   - architecture/test-topology lens;
   - operations/security lens when process, native, network, security, migration, or persistent-state behavior is involved.
5. Freeze the execution packet: ticket, contract, validation, relevant decisions, exact base commit, policies, and confirmed read/write/conflict sets.
6. Dispatch one `ticket-implementer`. The worker uses vertical public-interface TDD, does not broaden scope, does not commit unless explicitly authorized, and writes a structured implementation report.
7. Inspect Git independently. Actual files and symbols touched outrank the worker report. Unexpected shared scope invalidates concurrency assumptions.
8. Run the contract-required review lenses in fresh contexts. Reviewers receive the frozen contract, exact diff, and evidence—not the implementer's persuasive narrative.
9. On failure, dispatch `repair-ticket` only for the failed axes. Re-run every review whose domain the repair touched.
10. Send the passed candidate to the neutral integrator. It checks actual scope, review evidence, budgets, process leases, and landing verification; resolves only mechanical conflicts; then serially commits or cherry-picks.
11. Append evidence, update statuses and metrics, run the track-declared status-preserving updater, and immediately continue. For track 13 use `node docs/tickets/13-post-032-compiled-frontier/update-frontier.mjs --status ID=STATUS`. Do not ask whether to proceed between ordinary tickets.

## Compatibility fallback when subagents are unavailable

The coordinator may perform one ticket sequentially, but must preserve role boundaries on disk:

1. complete implementation and write `implementation.json`;
2. clear the implementation checklist;
3. re-read only the contract, validation, exact diff, and evidence;
4. write each initial review report before repairing anything;
5. repair only after findings are frozen.

Use a fresh reviewer for Lane 3 whenever the harness supports one.

## Conflict handling

- Mechanical conflict: the integrator may resolve it while preserving both contracts.
- Semantic conflict: stop the candidates and return to Wayfinder or planning; workers do not negotiate a new design.
- Unexpected shared file or conflict key: invalidate the wave and serialize.
- Megafile lock: dispatch `test-topology` decomposition before accepting growth.

## Stop conditions

Stop only when:

- a contract human gate is reached;
- required authority expands beyond the approved plan;
- a prerequisite is absent or contradictory;
- the safe write set cannot be bounded;
- verification remains unrecoverable after changing the repair strategy;
- the track is complete.

A reviewer pass is evidence, not human approval.

## Completion

Every required ticket is serially landed, superseded with explicit evidence, or closed by recorded revalidation; wave verification passes; architecture budgets do not regress; process leases are closed; the worktree is clean or fully explained; and branch-level review has no blocking finding.
