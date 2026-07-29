# Frontier skill-system architecture

## Goals

- one project-owned source of truth for engineering procedures;
- progressive disclosure instead of one repeated megaprogram;
- a clear separation between planning, execution, review, repair, integration, testing, process safety, and migration;
- deterministic validation and project-owned upgrade baselines;
- conflict-safe projections into several harnesses;

## Durable layers

### Repository context

`AGENTS.md` contains stable project-wide context: mission, profile, real commands, authority boundaries, local Frontier workflow, security rules, skills, and definition of done. Workspace adoption may add a nested `AGENTS.md` only when a module’s stack, commands, or policy materially differs.

### Machine-readable policy

`.agentic/profile.json`, `.agentic/config.json`, `.agentic/workspace.json`, policy files, and ticket contracts hold decisions that should not be copied into every prompt. Generated and adopted profiles distinguish current architecture from the preferred direction for touched/new code.

### Canonical repository skills

The editable source is:

```text
.agentic/skills/<skill>/SKILL.md
```

A skill may include flat `references/`, deterministic `scripts/`, schemas/assets, and eval fixtures. Users edit the canonical tree, then run `sync` to project it.

### Harness projections

Configured copies are generated under paths such as:

```text
.agents/skills/
.opencode/skills/
.claude/skills/
.github/skills/
.gemini/skills/
```

Codex additionally receives `.codex/config.toml`, `.codex/agents/*.toml`, and hooks. OpenCode receives `opencode.json` and `.opencode/prompts/frontier-loop/`. Cursor uses a managed rule because its native format differs.

A projection is writable only when absent, hash-identical and explicitly adopted, or proven generator-owned. Custom same-name content blocks synchronization before writes. When projections are disabled or host bundles are preserved, implicit synchronization reports `no-projection` and performs no projection writes; an explicit protected target fails closed. Managed projection mode retains its existing reconciliation behavior.

### Project-owned baselines

`.agentic/skill-baselines/<skill>/` stores the exact upstream input from the last successful installation/update. The skill lock records provenance, baseline/installed hashes, per-file state, and risk metadata. This supports offline three-way updates while preserving local edits.

## Skill catalog in 0.6.1

### Router and planning

| Skill | Responsibility |
|---|---|
| `frontier-loop` | Select Wayfinder, compilation, execution, or retrofit path without duplicating specialist procedures. |
| `wayfinder` | Resolve destination, evidence, decisions, authority gates, prototypes/research, and remaining fog; write repository planning artifacts. |
| `compile-master-plan` | Convert a stable map/specification into vertical local ticket contracts, dependencies, conflict keys, risk lanes, budgets, and gates. |

### Execution loop

| Skill | Responsibility |
|---|---|
| `execute-frontier` | Keep one coordinator session running from local files; schedule the current dependency frontier, one writer by default, parallel read-only work, serial landing. |
| `ticket-implementer` | Execute one frozen ticket with public-interface vertical TDD and scope/write-set discipline. |
| `ticket-review` | Independently review specification/authority, code/test design, or operations/security. |
| `repair-ticket` | Repair only failed review axes and invalidate only affected evidence. |
| `integrate-wave` | Recheck ownership/write sets, integrate passed candidates in dependency order, and run landing gates. |

### Engineering discipline

| Skill | Responsibility |
|---|---|
| `tdd` | One public behavior at a time, independent oracles, minimal mocks, fixture/test placement, red–green–refactor. |
| `test-topology` | Architecture baselines, megafile no-growth ratchets, behavior-oriented decomposition, and budget checks. |
| `process-lifecycle` | Managed process leases, process-tree ownership, bounded termination, evidence, and zero-descendant completion. |
| `implementation-style` | Preserve coherent existing design or apply the selected simple/functional-core/clean direction without ceremonial layers. |
| `diagnose` | Reproduce, observe, hypothesize, prove root cause, and protect with a regression. |
| `verify` | Fresh commands, explicit levels, evidence, and honest limitations. |

### Retrofitting and meta work

| Skill | Responsibility |
|---|---|
| `retrofit-agent-docs` | Add durable `docs/agent/` state without moving or overwriting source documentation. |
| `retrofit-ticket-pack` | Preserve legacy ticket prose while adding contracts, risk/conflict/dependency metadata, evidence directories, and a local frontier. |
| `write-skill` | Create or revise project-local skills with routing/output evals, provenance, and security review. |

The catalog contains 17 canonical skill directories in this release.

## Wayfinder

```text
assets/skills/wayfinder/SKILL.md
```

 It writes `docs/agent/wayfinding/<effort>/map.md`, `frontier.yaml`, and supporting decision/research/prototype artifacts, then hands stable planning results to `compile-master-plan`.

## Frontier orchestration

```text
Wayfinder
  → Compile Master Plan
  → local ready frontier
  → parallel read-only preflight
  → one writer by default
  → independent review lenses
  → targeted repair
  → neutral serial integration
  → recompute frontier
```

The coordinator remains one continuous session and reads/writes local repository artifacts. No issue tracker, webhook, repository watcher, or fleet of independent long-lived chats is required.

The earlier sequential executor → reviewer → repair → reviewer loop remains the ticket-level correctness core. Frontier changes the scheduling boundary: discovery and independent evidence can run concurrently, while overlapping mutations and authority transitions remain serialized.

## Model and permission routing

| Role | Default | Access |
|---|---|---|
| coordinator/orchestrator | GPT-5.6 Sol, high | coordinates and decides; repository access follows harness session |
| Wayfinder/planner | GPT-5.6 Sol, high | read-only |
| scout | GPT-5.3 Codex, high | read-only |
| implementer | GPT-5.3 Codex, high | workspace write |
| specification/authority reviewer | GPT-5.3 Codex, high | read-only |
| code/test reviewer | GPT-5.3 Codex, high | read-only |
| operations/security reviewer | GPT-5.3 Codex, high | read-only |
| repairer | GPT-5.3 Codex, high | workspace write |
| integrator | GPT-5.3 Codex, high | constrained workspace write |

The default child-agent cap is three. A second writer is not the default; it requires disjoint write sets and conflict keys, non-authority-critical scope, and isolated worktrees/checkpoints.

## Ticket contracts

Compiled tickets are short-lived execution packets rather than long-lived guesses. Contracts record:

- outcome and public behavior;
- source-backed invariants and authority ordering;
- `blocked_by` edges and tracking-parent status;
- read/write sets and conflict keys;
- risk lane;
- verification ladder and review axes;
- architecture/test/process budgets;
- human gates;
- stop-and-split conditions;
- immutable evidence locations.

The local frontier consists only of tickets whose dependencies pass, whose conflicts are not active, and whose human/authority gates permit work.

Executable contracts additionally require at least one nonblank exact command
under `verification.commands`. Missing verification, missing/empty commands,
and blank-only commands are specification errors. Aggregate-only and historical
records remain explicit non-executable exceptions.

## TDD and test topology

The inner loop remains vertical:

```text
one public behavior
  → one observed failing test
  → smallest passing implementation
  → green
  → placement/refactor check
  → next behavior
```

Expected values must be independent from production logic. Test doubles model volatile effects rather than private computation. Existing oversized files can be grandfathered but locked against growth; new behavior moves to stable behavior-oriented modules or a dedicated decomposition ticket.

## Skill validation and updates

Static validation checks:

- `SKILL.md` presence and frontmatter delimiters;
- valid name and directory match;
- nonempty bounded description;
- local link/resource existence;
- JSON eval syntax where present;
- cross-skill/internal references;
- executable/script/risk metadata;
- canonical, baseline, lock, and projection hashes.

Static validity does not prove skill quality. Trigger/output evals, representative project trials, first-pass correctness, repair count, wall time, token/cost data, and escaped defects remain the quality evidence.

Updates use baseline/local/incoming comparison. Clean non-overlapping text edits may merge. Overlap, deletion of local edits, executable/binary divergence, and broader tools/permissions require review and can block the selected atomic set.

## Process ownership

Agent completion is not accepted solely because a model says it finished. Generated Stop/SubagentStop guards check open process leases. The managed command wrapper records run/ticket/agent identity, process identity, deadline, command digest, output, and termination result; it owns process groups or a Windows Job Object where available and checks that no owned descendants survive. A finalized receipt remains durable evidence but is ignored by upgrade dirty-state inspection; an open lease remains a blocker.

## Information-placement rule

Put an instruction in the highest layer that stays correct:

1. stable project truth in `AGENTS.md` or versioned docs;
2. machine-readable policy in profile/policy/contract files;
3. ordered reusable procedure in one authoritative skill;
4. branch-specific detail in a linked reference;
5. repeated deterministic work in a script;
6. ticket-specific frozen facts in the execution contract;
7. ephemeral exploration in disposable agent scratch/evidence.

Do not copy the complete TDD loop, risk policy, or model routing into every ticket. Reference the authoritative skill/policy and freeze only ticket-specific decisions.
