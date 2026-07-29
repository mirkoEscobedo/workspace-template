---
name: compile-master-plan
description: "Use when a resolved Wayfinder map, specification, or clear local goal must be compiled into a Frontier Loop ticket pack with vertical contracts, dependencies, risk lanes, conflict keys, verification policies, architecture budgets, process postconditions, and continuous local execution instructions."
compatibility: ChatGPT Skills, Codex, OpenCode
metadata:
  version: "0.6.0"
---

# Compile Master Plan

Compile only after the destination and material route-changing decisions are stable. The output is one local-file Frontier pack; it does not require GitHub issues, webhooks, or event-driven dispatch.

## Inputs

Use, in authority order:

1. explicit current user instructions;
2. approved Wayfinder map and decision files, including exported conversation artifacts;
3. preserved product specifications and ADRs;
4. repository evidence;
5. clearly labeled inference.

Stop and return to Wayfinder when an unresolved decision would materially change ticket boundaries, authority, data shape, or sequencing.

## Output shape

```text
docs/tickets/<track-slug>/
  master-plan.md
  track.yaml
  frontier.json
  current-sprint.md
  policies/
    verification.yaml
    architecture-budgets.yaml
    process.yaml
    model-routing.yaml
  NNN-<ticket-slug>/
    ticket.md
    contract.yaml
    validation.md
    evidence/
      README.md
```

Use the templates and schema in `assets/` and `schemas/`.

Every executable ticket must declare a `verification` object with at least one
nonblank exact command in `verification.commands`. A record is non-executable
only when its `kind` is `tracker`, `aggregate-only`, or `historical`, or its
`execution_policy` is `aggregate-only` or `historical-only`. Do not emit an
executable contract with missing verification, missing commands, `commands: []`,
or blank command strings. Exemption markers are exact strings: never trim,
case-fold, or otherwise normalize them. `public_outcome` must be a nonblank
string.

## Compile the graph

1. State the goal completion contract and source authority.
2. Recover locked decisions, human gates, out-of-scope boundaries, and stop/escalation rules.
3. Slice implementation into vertical tracer bullets that expose one public behavior or integration proof each.
4. Assign stable flat IDs. Encode hierarchy through `parent` and `blocked_by`, never recursive ID suffixes.
5. Add dependency edges only after all visible tickets exist.
6. Mark tracker parents `aggregate-only`; they summarize child evidence and never enter the implementation queue.
7. Assign each executable ticket:
   - risk lane;
   - public outcome and invariants;
   - expected read and write sets;
   - semantic conflict keys;
   - required review lenses;
   - verification levels;
   - architecture and process budgets;
   - human gates and stop conditions;
   - `preflight_required` when scope is uncertain;
   - a `verification` object whose `commands` contains at least one nonblank exact command.
8. Prefer expand-migrate-contract sequencing for wide changes.
9. Generate the initial `frontier.json` from true dependencies and status.
10. Validate schema, missing blockers, cycles, duplicate IDs, and executable tracker parents.

## Active model routing

Read `.agentic/policies/model-routing.yaml` and copy its active preset and
expanded role routing into the track policy. Never substitute model names from
memory or from this skill.

## Master-plan requirements

`master-plan.md` must include:

- goal and completion contract;
- source and authority ordering;
- locked decisions and out of scope;
- human gates;
- continuous Frontier execution policy;
- milestones;
- ticket index by stable ID and title;
- completion and stop rules.

## Ticket contract authority

`contract.yaml` is the machine-readable execution boundary. `ticket.md` is the human-readable behavior specification. If they disagree, stop and repair the pack before implementation.

Read `references/ticket-contract.md` before generating contracts.
