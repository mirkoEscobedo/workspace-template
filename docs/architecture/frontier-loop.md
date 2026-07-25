# Frontier Loop operating model

## Definition

Frontier Loop is a **local-file, continuous-coordinator** development workflow. It is not a GitHub Issues event processor and does not require multiple independent chats watching a repository.

```text
one coordinator session
  │
  ├─ reads durable Wayfinder map and ticket contracts
  ├─ computes the currently ready dependency frontier
  ├─ delegates bounded fresh roles when supported
  ├─ keeps overlapping writes and authority transitions serialized
  ├─ integrates accepted work in dependency order
  └─ updates local evidence and continues
```

A repository can later mirror contracts into a tracker, but the local artifacts are sufficient and remain authoritative.

## Why a frontier rather than a universal sequence

A total order avoids merge conflicts but serializes work that cannot conflict, including repository reconnaissance and independent review. Unbounded swarms gain parallelism but create shared-file contention, context waste, and unclear authority.

Frontier Loop uses this rule:

> Parallelize discovery and evidence. Serialize overlapping mutations and authority transitions.

Tickets declare dependencies, expected write sets, conflict keys, risk lanes, and human gates. The scheduler starts only ready work and defaults to one write-capable worker. Read-only scouts and review lenses may run concurrently.

## Planning stages

### Wayfinder

Wayfinder resolves route-changing uncertainty before detailed tickets are frozen. It keeps distinct:

- destination and observable success;
- source-backed facts;
- explicit user decisions;
- model inferences;
- open decisions;
- authority gates;
- research/prototype evidence;
- currently visible work;
- remaining fog.

Wayfinder exits when unresolved decisions can no longer materially change architecture, public seams, authority ordering, scope, or the next execution frontier.

### Compile Master Plan

Compilation transforms a stable map/specification into vertical contracts. It does not attempt to detail all future work while fog remains. Newly visible work is compiled when prior tickets resolve the unknowns.

A contract includes public outcome, dependencies, read/write sets, conflict keys, risk lane, review axes, verification levels, architecture/process budgets, evidence paths, and stop/split conditions.

## Execution stages

### Read-only preflight

Before mutation, independent agents may inspect:

- specification/authority completeness;
- architecture and public seam;
- test placement and megafile pressure;
- expected write set and conflict keys;
- process/network/persistence risks;
- verification scope.

Preflight findings can amend or split a ticket before expensive implementation.

### Vertical implementation

The implementer works one frozen ticket and follows public-interface red–green–refactor. It stops rather than silently broadening scope when a new authority transition, conflicting architecture decision, unplanned dependency, or write-set expansion is required.

### Independent review axes

Normal and high-risk work separates:

- specification and authority;
- code and test architecture;
- operations and security where relevant.

Reviewers receive the contract, actual diff, relevant invariants, and fresh verification—not the implementer’s persuasive narrative. A failed axis triggers targeted repair and re-review of invalidated evidence only.

### Neutral integration

The integrator checks the actual diff against declared ownership, stages only accepted work, resolves landing order, runs wave/landing verification, and records the result. Semantic design conflicts return to planning rather than being improvised during merge.

## Risk lanes

| Lane | Typical work | Default review and execution |
|---|---|---|
| 0 — mechanical | exact generated/config/index/refactor-without-behavior work | controller or one worker; automated/combined review; targeted gates |
| 1 — local behavior | isolated pure behavior or narrow component | one writer; code/test review; L0–L2 verification |
| 2 — cross-module | protocols, persistence, integration, event streams | one writer initially; spec + code/test review; integration wave |
| 3 — authority-critical | production apply, funds/risk, transaction admission, destructive/process-lifecycle work | exactly one writer; authority + code/test + ops/security; explicit human gates and broad landing verification |

Risk lanes control ceremony and verification cost. They never allow a low-risk label to bypass an actual authority boundary.

## Verification ladder

```text
L0  format, lint, type/compile/static checks
L1  exact changed behavior
L2  affected package/component
L3  affected integration shard or landing wave
L4  full repository baseline
```

Red–green work uses L1. Handoff usually uses L0–L2. Integration waves use L3. Lane 3 landing uses L4. Repairs rerun the affected levels rather than paying for an unrelated full suite after every edit.

Every result records command, cwd/scope, commit/environment identity when available, duration, exit status, bounded output, and remaining owned processes.

## Architecture ratchets

Existing large files can be grandfathered but locked against growth. Budgets can use physical lines, case size/count, fixture/support size, runtime, flake history, touch frequency, and concentration. A locked file may be reduced or held constant; new behavior goes to a behavior-oriented module. Repeated blocking dispatches a dedicated decomposition ticket.

## Process lifecycle

Every long-running test/tool/server should run through the managed process wrapper. Completion requires the owned process tree to exit. Stop hooks can reject agent completion when leases remain open. Cleanup is based on run/process identity, never blanket names such as “all Node processes.”

## Operating modes

The default uses delegated roles when the harness supports subagents. When it does not, one conversation can still continue from local files by performing clearly separated implementation, review, repair, and integration phases. The same contracts/evidence are used, so execution topology can change without rebuilding the plan.

## Human stop conditions

The coordinator continues across routine tickets and stops for:

- an explicit human authority gate;
- a material contradiction or missing route-changing decision;
- unsafe scope/write-set expansion;
- a dependency/tool/network/semantic approval not present in the plan;
- repeated verification failure requiring a new hypothesis or plan;
- completion of the selected goal or one semantic alignment slice.
