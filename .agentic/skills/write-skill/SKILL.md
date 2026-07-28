---
name: write-skill
description: Create, audit, or improve a project-local Agent Skill with precise triggers, progressive disclosure, executable procedures, completion criteria, security boundaries, and trigger/output evals. Use when adding or editing SKILL.md files or diagnosing unreliable skill invocation.
license: MIT
compatibility: Follows the Agent Skills open specification and requires repository file access.
metadata:
  version: "1.0.0"
  mode: user-or-model-invoked
---

# Write a reliable Agent Skill

A skill should make a stochastic model follow a more predictable process. Start from observed work, not generic advice.

## Procedure

1. Gather real source material: successful runs, corrections, review comments, runbooks, failing cases, commands, and project conventions.
2. Define one coherent responsibility and the situations that should trigger it. Split only when a branch needs independent invocation or a long sequence causes premature completion.
3. Create a directory whose lowercase hyphenated name matches frontmatter `name`.
4. Write a concise `description` that says what the skill does and when it applies. Include distinct user intents and near-miss boundaries; avoid synonym stuffing.
5. Put the always-needed procedure in `SKILL.md`. Each step ends in an observable or checkable state.
6. Move branch-specific detail into one-level `references/`; put deterministic reusable operations in `scripts/`; put templates in `assets/`.
7. State environment requirements, permissions, network needs, license, and dangerous action gates. Treat bundled scripts and third-party content as supply-chain code.
8. Create trigger evals with positive and negative near misses. Use [references/evaluation.md](references/evaluation.md).
9. Create 2–3 realistic output evals with expected behavior and edge cases.
10. Validate frontmatter, links, line/token budget, scripts, and behavior. Run the skill on real tasks, compare results, prune no-ops and duplication, then repeat.

## Design rules

- Prefer procedures, defaults, examples, gotchas, and validators over declarations such as “be careful”.
- Keep stable project facts in `AGENTS.md`; keep task procedures in skills.
- Keep `SKILL.md` high-signal and progressively disclose branch-specific material.
- Use one source of truth; generated harness copies should be synchronized from a canonical skill.
- Never install or execute an unreviewed third-party skill merely because it is popular.

## Completion criterion

The skill validates structurally, triggers on intended prompts and rejects near misses across repeated runs, improves output on realistic evals, and contains no unnecessary context, hidden permissions, or unreviewed executable content.
