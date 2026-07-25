# Agentic development: research synthesis and operating model

**Research date:** 2026-07-11  
**Scope:** coding-agent workflows, repository instructions, Agent Skills, planning, implementation, testing, review, verification, security, and project bootstrapping.

## Executive conclusion

Reliable agentic development is not “a better system prompt.” It is an engineered feedback system around a stochastic contributor:

- keep the model's active context small, current, and task-relevant;
- store stable repository truth in versioned local artifacts;
- decompose work into observable vertical outcomes rather than layer-by-layer activity;
- use the model for judgment and code synthesis, but use deterministic tools for orchestration, validation, and state transitions;
- make side effects, permissions, and escalation rules explicit;
- require fresh evidence before completion;
- evaluate skills for both **triggering** and **output quality**;
- treat third-party skills, prompts, scripts, and generated code as supply-chain inputs.

The best default pipeline is:

```text
intent → discovery → design/profile → vertical plan →
red/green implementation slices → focused review → fresh verification →
human-controlled publish/deploy → retrospective improvement
```

This pipeline should be scaled to risk. A typo does not need an architecture committee; a payment migration does not deserve a one-line autonomous prompt.

## 1. What “agentic development” should mean

Anthropic distinguishes **workflows**, where models and tools follow predefined code paths, from **agents**, where a model dynamically directs its own tool use. Their recommendation is to begin with the simplest composable pattern that works, adding autonomy only where it improves outcomes. That is the right starting point for software engineering too.

A useful operational definition:

> Agentic development is software work in which a model can inspect a repository, choose and invoke tools, modify artifacts, and iterate on feedback under explicit objectives, permissions, and verification gates.

This definition includes several autonomy levels:

| Level | Model role | Human/system control |
|---|---|---|
| Assist | explain, suggest, draft | human edits and runs everything |
| Execute | edit and run bounded local tools | deterministic scope and command allowlist |
| Orchestrate | plan, dispatch focused subtasks, integrate | checkpoints, state, schema validation |
| Operate | carry a long-running issue to a reviewable change | strict permissions, monitoring, rollback, human release gate |

“More agentic” is not automatically better. The desired level depends on reversibility, blast radius, ambiguity, testability, and access to sensitive systems.

## 2. The evidence base

The synthesis prioritizes primary and official sources:

- Anthropic guidance on effective agents and context engineering;
- OpenAI's practical guide to building agents;
- the Agent Skills specification and official evaluation guidance;
- current OpenAI Codex, Claude Code, Gemini CLI, GitHub Copilot, and OpenCode skill/instruction documentation;
- the `AGENTS.md` specification;
- official Flutter, Dart, React, TypeScript, and Rust guidance;
- canonical refactoring and TDD references;
- current public skill/workflow repositories;
- recent empirical/preprint research, clearly labeled as preliminary where applicable;
- the three user-provided artifacts: an enterprise framework, a local skill pack, and a long functional-core/clean-architecture design note.

Detailed provenance and limitations are in [source-audit.md](source-audit.md).

## 3. Principles that consistently improve reliability

### 3.1 Context is a budget, not a warehouse

Long context does not remove the need for context engineering. Every irrelevant instruction competes with the current task, repository evidence, error output, and implementation details. Stable facts belong in a concise `AGENTS.md`; procedures belong in skills loaded only when relevant; long references belong behind explicit links; transient tool output should be summarized or discarded.

Practical consequences:

- one authoritative statement per rule;
- descriptions optimized for routing, not for teaching;
- branch-specific detail in reference files;
- nearby/nested instructions for specialized subtrees;
- task-specific context packs instead of reading the whole repository;
- handoff artifacts that preserve decisions and evidence, not conversation transcripts.

### 3.2 Separate stable policy from procedural behavior

A repository-level instruction file and a skill solve different problems.

`AGENTS.md` should answer:

- What is this project?
- What commands are authoritative?
- What constraints and security boundaries always apply?
- What conventions are stable?
- What constitutes done?

A skill should answer:

- When should this procedure run?
- What sequence should the agent follow?
- What completion criterion closes each step?
- Which branch-specific references should it load?
- What evidence should it return?

Putting every workflow into `AGENTS.md` increases permanent context load. Putting stable project facts into a skill makes them easy to miss.

### 3.3 Plan around behavior and dependencies

Good plans are not file inventories. They define:

- an observable outcome;
- non-goals and constraints;
- the public seam where behavior is demonstrated;
- a dependency order;
- one thin vertical slice at a time;
- verification for each slice;
- rollback or containment for high-risk changes.

A vertical slice crosses only the layers needed to prove one capability. It gives the agent feedback before it compounds incorrect assumptions across an entire architecture.

### 3.4 Keep orchestration deterministic where possible

A model is valuable for ambiguous judgment: understanding intent, locating relevant code, proposing designs, diagnosing evidence, and writing adaptations. It is a poor place to hide process state.

Put these in code or machine-readable artifacts:

- accepted inputs and enum values;
- task state and dependency edges;
- schema validation;
- command execution and exit status;
- retry limits;
- permission gates;
- generated-file manifests and hashes;
- quality-gate results.

A 2026 controlled study of runtime-structured task decomposition reported that static decomposition alone could increase retry cost, while executable branching and selective retry isolated failures more efficiently. The study is small and scenario-specific, but it supports a general engineering rule: **decompose with recoverable state, not merely with more prompts**.

### 3.5 Evidence beats self-assessment

An agent saying “done” is not verification. Completion requires fresh evidence from the environment:

- the intended failing test was observed;
- the focused test now passes;
- type/static checks pass;
- lint and format checks pass;
- the full relevant suite passes;
- build/package output succeeds where applicable;
- the final diff matches scope;
- unverified items are disclosed precisely.

Verification commands and their results should be part of the final handoff. A stale result from before the last edit is not evidence for the final state.

### 3.6 Use autonomy proportional to risk

A useful risk model scores five dimensions:

| Dimension | Low | High |
|---|---|---|
| Reversibility | local edit, easy revert | destructive migration or external side effect |
| Blast radius | one module | production, billing, identity, many tenants |
| Ambiguity | precise acceptance criteria | unclear product or domain behavior |
| Observability | fast deterministic tests | delayed or weak feedback |
| Sensitivity | public/local data | credentials, personal/client data, regulated systems |

As risk rises, narrow permissions, require human checkpoints, add independent review, and move deploy/publish actions out of the agent's default authority.

### 3.7 Multi-agent only when separation is real

Parallel agents help when subtasks:

- have independent inputs and outputs;
- do not edit the same files;
- benefit from different context or expertise;
- can be validated independently;
- have an explicit integration owner.

They hurt when several agents rediscover the same repository, race on shared files, inherit inconsistent assumptions, or produce artifacts with no integration contract. “More agents” can multiply context cost and coordination defects.

Strong uses include parallel research, independent spec-vs-quality review, isolated adapter implementations behind an agreed port, and separate test/implementation reviews. Weak uses include splitting a tightly coupled feature by architectural layer.

### 3.8 Keep durable state outside the conversation

Long work needs versioned state:

- a brief/spec with acceptance criteria;
- architecture decision records;
- a task graph or checklist with completion evidence;
- a domain glossary for overloaded terms;
- a machine-readable profile;
- a change log or handoff note.

The conversation is an interaction surface, not the source of truth.

### 3.9 Treat skills as executable supply-chain content

A skill's metadata controls discovery and selection; its body can influence tool use; bundled scripts can execute code. Review it like a dependency:

- provenance and maintainer;
- exact version or commit;
- license and redistribution terms;
- scripts and binaries;
- allowed tools and network access;
- secret/environment access;
- installation hooks;
- prompt-injection or precedence claims;
- overly broad trigger language;
- generated-output behavior.

A May 2026 preprint demonstrated semantic attacks against skill discovery, selection, and governance mechanisms. Its exact rates should not be generalized beyond the tested setup, but the threat model is credible: natural-language metadata is operational, not passive.

## 4. Recommended end-to-end workflow

### Phase 0 — establish project truth

Create or update:

- root `AGENTS.md`;
- nested `AGENTS.md` only where subtree rules materially differ;
- `.agentic/profile.json` for implementation/TDD policy;
- canonical local skills;
- command table and lockfile;
- data/security policy;
- definition of done.

Completion criterion: a new agent can identify the correct setup, focused test, full check, architecture style, and prohibited actions without guessing.

### Phase 1 — discover

For a non-trivial request:

1. inspect repository instructions and relevant nearby code/tests;
2. restate the user-visible outcome;
3. distinguish requirements, assumptions, and questions;
4. identify risk, constraints, and non-goals;
5. find the public behavior seam;
6. define acceptance examples, including failure paths.

Do not force a long interview when a safe, reversible assumption can be recorded. Do not silently invent domain rules.

Completion criterion: the change can be judged true or false through observable behavior.

### Phase 2 — choose implementation profile

Select the smallest architecture that protects the change:

- `simple` for low-complexity local behavior;
- `functional-core` for business decisions plus effects;
- `clean` for several volatile boundaries or long-lived domain/application separation.

Record why the more complex alternative is not needed, or why the simpler alternative would create a concrete problem.

Completion criterion: dependency direction, effect boundaries, test seams, and file organization are explicit.

### Phase 3 — plan vertical slices

Each task should name:

- behavior demonstrated;
- files or modules likely involved;
- dependencies/blockers;
- test seam and expected red state;
- implementation boundary;
- focused verification;
- risk/rollback notes.

Avoid “create all models, then all repositories, then all services.” Prefer “user can perform one thin use case through the public boundary.”

Completion criterion: every task produces a reviewable capability or enabling proof, not merely architecture inventory.

### Phase 4 — implement in feedback loops

For each slice:

1. write or identify one behavior test;
2. run it and confirm the expected failure;
3. implement the smallest coherent behavior;
4. run the focused test and relevant static check;
5. micro-refactor while green;
6. record evidence;
7. continue with the next slice.

A bounded exploratory spike is acceptable in pragmatic mode when an API or design is unknown. Mark it as disposable; do not quietly turn the spike into production code without characterization and cleanup.

### Phase 5 — diagnose failures scientifically

When a check fails:

1. reproduce reliably;
2. reduce to the smallest failing case;
3. separate observation from inference;
4. form one falsifiable hypothesis;
5. instrument or inspect the nearest cause;
6. fix the cause, not the symptom;
7. add a regression test;
8. verify the original reproduction and adjacent behavior.

Do not make several speculative changes before rerunning the failure.

### Phase 6 — review on independent axes

Run at least two passes:

**Specification pass**

- Does the behavior satisfy acceptance criteria?
- Are edge cases, error paths, and non-goals respected?
- Did scope drift occur?

**Engineering pass**

- Is dependency direction coherent?
- Are effects and ownership explicit?
- Are tests coupled to behavior rather than implementation?
- Are error, security, concurrency, and resource paths safe?
- Is the diff understandable and minimal?

For high-risk work, use an independent reviewer/context where feasible.

### Phase 7 — verify and hand off

Run fresh, in this order where practical:

1. focused tests;
2. type/static checks;
3. lint and format checks;
4. full tests;
5. build/package;
6. diff and secret scan;
7. project-specific integration/e2e checks.

Handoff should include:

- behavior delivered;
- material design decisions;
- files or public APIs changed;
- commands run and results;
- known limitations and unverified areas;
- migration/rollback notes;
- follow-up work kept out of scope.

Publishing, deploying, destructive migration, billing, credential, or production actions remain explicit human gates by default.

## 5. Skill design and evaluation

### 5.1 A good skill is a process contract

A skill should have:

- a narrow capability;
- realistic positive and negative triggers;
- ordered actions only where order matters;
- checkable completion criteria;
- progressive disclosure for branch-specific detail;
- deterministic scripts for repeatable mechanical operations;
- an evidence-shaped output contract;
- explicit limits and escalation conditions.

Avoid generic exhortations such as “be thorough” or “write clean code.” They consume context without changing behavior.

### 5.2 Test two different things

**Trigger evaluation** asks whether the skill is selected for realistic requests and not selected for near misses. Use both positive and negative prompts, including paraphrases and competing skills.

**Output evaluation** asks whether the skill produces the right artifact/process. Use deterministic checks where possible and model judgments only for genuinely semantic qualities. A useful suite checks success, failure, edge, and adversarial cases.

### 5.3 Evaluate changes against a baseline

A skill edit is beneficial only if it improves outcomes, routing, cost, or maintainability. Compare:

- no skill;
- previous skill;
- candidate skill.

A 2026 SWE-Skills-Bench preprint reported that many tested skills did not improve task success and some harmed it, including through version mismatch. Treat this as preliminary evidence, not a universal verdict, but it reinforces the need for task-specific evaluation instead of assuming that more instruction is better.

## 6. Anti-patterns

### Monolithic constitution-prompt

Symptoms: one giant file mixes company policy, product context, architecture, TDD, deployment, and dozens of workflows. Result: high context load, contradictions, poor routing, and maintenance drift.

### Prompt-only state machine

Symptoms: the skill says “remember which phase you are in” but no file/schema records it. Result: retries and compaction lose state; steps are skipped or repeated.

### Architecture-by-folder

Symptoms: interfaces, repositories, services, DTOs, and layers are created before volatility or behavior proves they are needed. Result: ceremonial indirection and horizontal implementation.

### Mock-everything testing

Symptoms: tests assert private calls and collaborator order. Result: green tests with little behavioral confidence and high refactor friction.

### Autonomous high-risk side effects

Symptoms: agent may deploy, publish, migrate, delete, spend, or access production because the prompt says “finish the task.” Result: unacceptable blast radius.

### Unbounded research or tool loops

Symptoms: repeated searches, retries, or subagent spawning with no stopping rule. Result: cost and latency without better evidence.

### Bulk marketplace installation

Symptoms: dozens or hundreds of skills loaded or installed “just in case.” Result: routing collisions, context pollution, unreviewed code, and supply-chain exposure.

### Completion by narrative

Symptoms: final answer says tests pass but gives no fresh command evidence, or ignores unavailable runtimes. Result: false confidence.

## 7. Adoption roadmap

### Stage 1 — repository readiness

- create `AGENTS.md`;
- standardize setup/focused/full commands;
- define data/security rules;
- add a reliable full check;
- prohibit autonomous production/destructive actions.

### Stage 2 — repeatable workflows

- add discover, plan, implement, diagnose, review, verify skills;
- add machine-readable profile;
- create trigger and output evals for high-value skills;
- record handoffs and ADRs.

### Stage 3 — bounded orchestration

- represent task dependencies and state in code/data;
- isolate retries to failed steps;
- assign subagents only to independent work;
- validate intermediate outputs with schemas;
- measure latency, token use, failures, and rework.

### Stage 4 — governed scale

- maintain an approved skill registry with provenance and version pins;
- run security/static checks on skill changes;
- audit permissions and model/tool access;
- use independent review for high-risk domains;
- connect deployment only through explicit policy gates and rollback.

## 8. Metrics worth tracking

Avoid vanity metrics such as generated lines. Track outcomes:

- cycle time from accepted requirement to verified change;
- first-pass acceptance rate;
- escaped defects and regression rate;
- review findings by severity and type;
- percentage of claimed checks with captured evidence;
- reruns/retries per task and reason;
- agent-caused scope churn;
- average diff size and files touched for comparable work;
- skill trigger precision/recall on a maintained eval set;
- task success and cost relative to no-skill baseline;
- security exceptions, secret exposures, and unapproved side effects;
- human interruption points and their value.

The goal is not maximum autonomy. It is lower lead time and rework while preserving or improving safety, correctness, and maintainability.

## 9. Resulting design in this repository

`workspace-template` encodes the recommendations as:

- a concise generated `AGENTS.md`;
- a canonical `.agentic/skills` tree with progressive disclosure;
- `simple`, `functional-core`, and `clean` profiles;
- `strict`, `pragmatic`, and `off` TDD modes;
- stack references for Rust, TypeScript, JavaScript, React, and Flutter;
- trigger/output eval examples;
- projection synchronization, current harness paths, context-import bridges, and drift checks;
- starter code that demonstrates effects at boundaries rather than ceremonial layers;
- normal language/toolchain verification commands.

The CLI is intentionally a starting system, not a claim that one architecture fits every repository. The generated artifacts should evolve with observed project needs and evaluated agent behavior.

## References

Primary and official sources:

- Anthropic, “Building effective agents”: https://www.anthropic.com/research/building-effective-agents
- Anthropic, “Effective context engineering for AI agents”: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- OpenAI, “A practical guide to building agents”: https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
- OpenAI Codex, “Build skills”: https://learn.chatgpt.com/docs/build-skills
- OpenAI Codex, “Custom instructions with AGENTS.md”: https://learn.chatgpt.com/docs/agent-configuration/agents-md
- Claude Code project memory: https://code.claude.com/docs/en/memory
- Claude Code skills: https://code.claude.com/docs/en/skills
- Gemini CLI context files: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md
- Gemini CLI Agent Skills: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/skills.md
- GitHub Copilot Agent Skills: https://docs.github.com/en/copilot
- OpenCode Agent Skills: https://opencode.ai/docs/skills/
- Agent Skills specification: https://agentskills.io/specification
- Agent Skills best practices: https://agentskills.io/skill-creation/best-practices
- Agent Skills description evaluation: https://agentskills.io/skill-creation/evaluating-skill-descriptions
- Agent Skills output evaluation: https://agentskills.io/skill-creation/evaluating-skill-output
- `AGENTS.md`: https://agents.md/
- Flutter architecture guide: https://docs.flutter.dev/app-architecture/guide
- Flutter testing overview: https://docs.flutter.dev/testing/overview
- Effective Dart: https://dart.dev/effective-dart
- React reducers: https://react.dev/learn/extracting-state-logic-into-a-reducer
- React custom hooks: https://react.dev/learn/reusing-logic-with-custom-hooks
- Rust testing: https://doc.rust-lang.org/book/ch11-00-testing.html
- Rust traits: https://doc.rust-lang.org/book/ch10-02-traits.html
- Martin Fowler, refactoring catalog: https://refactoring.com/catalog/
- Martin Fowler, Test-Driven Development: https://martinfowler.com/bliki/TestDrivenDevelopment.html

Recent research, interpreted cautiously:

- “Runtime-Structured Task Decomposition for Agentic Coding Systems”: https://arxiv.org/abs/2605.15425
- “SWE-Skills-Bench”: https://arxiv.org/abs/2604.18595
- “Under the Hood of SKILL.md”: https://arxiv.org/abs/2605.11418
- “Agentic Much? Adoption of Coding Agents on GitHub”: https://arxiv.org/abs/2601.18341
- “How AI Coding Agents Modify Code”: https://arxiv.org/abs/2601.17581
