---
name: wayfinder
description: "Use in a repository to plan a large or ambiguous software effort by recording the observable destination, source-backed decisions, authority gates, research, prototypes, and the current decision frontier before implementation tickets are compiled."
compatibility: Codex, OpenCode, repository Agent Skills
metadata:
  version: "0.6.0"
  edition: "repository-modular"
---

# Wayfinder

Wayfinder is the repository-backed planning layer. It discovers and records the route; it does not implement the destination and it does not duplicate ticket compilation.

Create or update:

```text
docs/agent/wayfinding/<effort-slug>/
  map.md
  frontier.yaml
  decisions/
    D001-<decision-slug>.md
  research/
  prototypes/
```

Use the templates in `assets/`.

## Chart a new effort

1. Inspect supplied repository files, existing plans, ADRs, glossary, retained evidence, and explicit current user decisions.
2. State the **destination** as an observable completed state, separate from implementation guesses.
3. Record source authority, locked decisions, out-of-scope areas, constraints, and human authority boundaries.
4. Map the first breadth-first decision frontier. One item asks one question whose answer can materially change the route.
5. Put still-unformulable work in **Fog**, not speculative implementation tickets.
6. Add blocking edges only after visible decision items have stable flat IDs.
7. Dispatch independent read-only research in parallel when supported. Never parallelize mutation of the same prototype or decision artifact.
8. Stop charting when the initial frontier and fog are durable. Do not implement.

## Work the decision frontier

1. Load `map.md` and `frontier.yaml`, not every closed artifact.
2. Select the first open, unblocked, unclaimed decision unless the user chose another.
3. Mark it claimed before work begins.
4. Resolve it through the minimum adequate method: repository research, current external research, bounded prototype, or human decision.
5. Write the complete conclusion, evidence, alternatives, and implications in one decision file. Do not preserve hidden reasoning.
6. Update the map with a one-line gist and link, close the item, and graduate newly precise fog.
7. Continue only when requested. Never invent a human-in-the-loop decision.

## Source discipline

Use this authority order:

1. explicit current user instructions;
2. approved Wayfinder decisions;
3. preserved specifications and ADRs;
4. repository evidence;
5. clearly labeled inference.

Point recovered facts to their source. Keep contradictions visible. Never silently replace a product decision or promote inference to fact.

## Exit to plan compilation

Wayfinding is complete when:

- the destination is stable and testable;
- no unresolved decision can materially change architecture, authority, data shape, sequencing, or ticket boundaries;
- remaining uncertainty can be expressed as ticket stop conditions;
- public seams and human gates are known;
- visible work can be expressed as dependency-aware vertical outcomes.

Then invoke the separate `compile-master-plan` skill with the Wayfinder map directory. Wayfinder remains the decision authority; `compile-master-plan` owns ticket slicing, contracts, policies, and frontier generation.

## Guardrails

- Stable flat decision IDs only; hierarchy belongs in metadata.
- One decision per file.
- Do not turn implementation steps into decision items.
- Do not begin source mutation from a Wayfinder task.
- Do not close an authority gate with model or reviewer approval.
- Mark unsupported or stale fields `UNRESOLVED`.
