# Agent Skill and workflow ecosystem comparison

**Snapshot date:** 2026-07-11

## Recommendation

Do **not** choose one third-party pack wholesale. Use a blended, project-owned system:

- adopt Matt Pocock's compact/composable discipline and emphasis on shared domain language;
- adopt Superpowers' insistence on observed red/green evidence, systematic diagnosis, and verification-before-completion;
- retain the user's enterprise framework's governance, data-security, task-classification, and stack-specific project context;
- retain the user's functional-core/imperative-shell design as the default implementation philosophy, but split it into on-demand style and stack references;
- use Spec Kit's artifact traceability selectively for substantial projects, not as mandatory ceremony for every change;
- use Trail of Bits skills as specialized security/testing add-ons after review;
- borrow multi-harness generation and skill-evaluation ideas from wshobson/agents, without loading its entire catalog;
- use Anthropic's repository as a packaging/specification reference, not a coding methodology;
- use BMAD only where a team genuinely wants a role-heavy, lifecycle-wide framework and accepts its operating cost.

The original skills in this package implement that blend without copying third-party skill text.

## Inputs audited

### User-provided enterprise framework

Strengths:

- task classification and autonomy levels;
- data-security policy and explicit responsibility;
- onboarding/setup workflow;
- code-review checklist and adoption metrics;
- concrete stack `AGENTS.md` templates;
- project-specific commands, environment variables, internal libraries, and gotchas;
- awareness that MCP connections are data-access channels.

Gaps:

- stable project facts and reusable procedures are sometimes mixed;
- templates are long and manually duplicated across stacks;
- implementation-style selection is not modular;
- no systematic trigger/output eval framework for skills;
- no canonical-to-harness synchronization or drift detection;
- some ecosystem claims and tool-specific material will age quickly.

Best use: enterprise governance layer plus project-specific generated `AGENTS.md`, not one global prompt loaded into every task.

### User-provided local skill pack

Strengths:

- behavior-first TDD and vertical tracer bullets;
- progressive-disclosure references in several skills;
- useful discovery/grilling, architecture, prototype, debugging, handoff, and triage workflows;
- domain language and ADR support;
- generally readable `SKILL.md` structure.

Gaps:

- much of the pack resembles an earlier generation of the Matt Pocock repository and may drift from upstream;
- several workflows require repeated human approval even when a safe assumption would be cheaper;
- TDD guidance is strong but overly broad about “integration-style” tests and does not adapt by seam or stack;
- arbitrary authoring rules such as a 100-line limit are weaker than relevance/progressive-disclosure criteria;
- no maintained eval corpus, baseline comparison, provenance record, or supply-chain review procedure;
- no unified `implement` → selected style → stack reference contract.

Best use: preserve the strongest behavior-first concepts, rewrite into a smaller project-owned set, and evaluate the routing.

### User-provided functional-core and architecture note

Strengths:

- clear functional-core/imperative-shell model;
- explicit handling of I/O, time, randomness, UUIDs, and feature flags;
- sensible functions-versus-classes guidance;
- repositories as domain boundaries rather than table wrappers;
- application services/use cases and composition roots;
- Rust traits/structs/functions and TypeScript interfaces/functions/classes mapped idiomatically;
- warnings against generic abstractions and giant service classes.

Gaps as a skill:

- approximately 1,500 lines is too much for an always-loaded implementation procedure;
- tutorial, reference, examples, language mappings, and decision policy are interleaved;
- it needs a selector to distinguish simple, functional-core, and clean/ports-and-adapters use;
- stack guidance should load only for the current target.

Best use: source material for a compact `implementation-style` skill plus progressively disclosed style and stack references.

## Ecosystem matrix

Scores are relative to this project's goal, not universal quality ratings. `5` is strongest.

| System | Composability | Context economy | Implementation discipline | TDD/debug evidence | Governance/security | Traceability | Portability | Eval maturity | Best fit |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Matt Pocock skills | 5 | 5 | 4 | 4 | 2 | 3 | 4 | 3 | experienced engineers wanting small adaptable workflows |
| Superpowers | 4 | 3 | 4 | 5 | 2 | 4 | 5 | teams wanting a mandatory end-to-end engineering method |
| GitHub Spec Kit | 3 | 2 | 3 | 3 | 3 | 5 | 5 | requirements-heavy work needing persistent specs/plans/tasks |
| BMAD Method | 3 | 1 | 3 | 3 | 3 | 5 | 4 | large role-oriented lifecycle workflows |
| Anthropic skills repo/spec | 4 | 4 | 2 | 2 | 3 | 2 | 4 | canonical packaging and complex skill examples |
| Trail of Bits skills | 4 | 4 | 4 | 4 | 5 | 3 | 3 | security, static analysis, property testing, auditing |
| wshobson/agents | 5 | 3 | 3 | 3 | 3 | 4 | 5 | large cross-harness marketplace and evaluation tooling |
| User enterprise framework | 3 | 2 | 4 | 3 | 5 | 4 | 3 | enterprise project governance and stack context |
| User local skills | 4 | 3 | 4 | 4 | 2 | 3 | 3 | useful personal workflows needing consolidation/evals |
| This package's blend | 5 | 5 | 5 | 5 | 4 | 4 | 5 | project creation with selectable implementation policy |

## Detailed comparison

### Matt Pocock: strongest compact engineering vocabulary

Current strengths:

- explicit split between user-invoked orchestration and model-invoked reusable discipline;
- descriptions treated as invocation cost, not marketing copy;
- progressive disclosure and co-location;
- checkable completion criteria;
- pruning of no-ops, duplication, sediment, and sprawl;
- shared domain language, deep modules, TDD, diagnosis, and independent review axes.

Trade-offs:

- intentionally opinionated personal workflow;
- current `implement` skill is extremely small and assumes companion skills/harness behavior;
- some process choices are debatable: for example, current TDD guidance moves refactoring to review rather than keeping canonical micro-refactoring in each green cycle;
- governance, permissions, and enterprise data policy are not the focus.

Decision: use its authoring discipline and composable shape, but provide a fuller implementation contract and security model.

### Superpowers: strongest mandatory feedback loop

Strengths:

- coherent lifecycle from brainstorming through worktree, planning, subagent execution, review, and branch completion;
- strict observed RED → GREEN → REFACTOR behavior;
- systematic debugging and verification-before-completion;
- explicit two-stage review and isolated worktrees;
- broad harness support and skill-behavior eval work.

Trade-offs:

- deliberately dogmatic; “delete code written before tests” is useful as a forcing function but can be wasteful for migration, generated shell, characterization, or approved spikes;
- the full method can be too heavy for small changes;
- long skills and mandatory global use increase context/process cost;
- limited enterprise governance compared with the user framework.

Decision: adopt evidence gates and diagnosis discipline; expose strict versus pragmatic TDD modes.

### GitHub Spec Kit: strongest artifact traceability

Strengths:

- constitution → specification → plan → tasks → implementation flow;
- separates what/why from technical planning;
- consistency analysis and checklists;
- project-local overrides, presets, extensions, and bundles;
- broad agent integrations.

Trade-offs:

- artifact volume can become ceremony;
- whole-feature implementation can encourage large batches unless tasks are explicitly vertical;
- code design/TDD quality depends on the selected constitution and templates;
- not primarily a skill-authoring or implementation-style framework.

Decision: use its traceability concepts for medium/high-complexity work; do not make every small change produce a full artifact stack.

### BMAD Method: broadest role-based lifecycle

Strengths:

- adaptive planning depth;
- specialized PM, architect, developer, UX, and testing roles;
- many workflows and enterprise testing add-ons;
- non-interactive CLI installation.

Trade-offs:

- large framework footprint and learning surface;
- role simulation can create handoff overhead and repeated context;
- harder to debug and customize than a small local skill set;
- ownership may shift from the team's engineering process to the framework.

Decision: not the default for this project. Consider for organizations explicitly choosing a comprehensive role-driven method.

### Anthropic skills repository and Agent Skills specification

Strengths:

- authoritative packaging model: self-contained folder, `SKILL.md`, optional scripts/references/assets;
- clear frontmatter requirements and progressive loading model;
- production-grade examples for complex artifact tasks;
- official guidance for trigger and output evals.

Trade-offs:

- example repository is not a general software-development methodology;
- examples vary by domain and licensing;
- correct packaging does not guarantee useful coding behavior.

Decision: use as the structural and evaluation baseline.

### Trail of Bits

Strengths:

- narrow, high-value security and testing capabilities;
- Rust review, property-based testing, mutation testing, static analysis, supply-chain review, and workflow-skill design;
- security-first expertise and concrete tooling.

Trade-offs:

- specialized rather than a complete product-development loop;
- tools may require environment setup and expert interpretation;
- skills still require provenance, permission, and license review.

Decision: recommended optional source for audited specialized add-ons, especially security-critical Rust and dependency work.

### wshobson/agents

Strengths:

- one source transformed into harness-native artifacts;
- large catalog and progressive loading;
- static, model-judge, and Monte Carlo skill-evaluation concepts;
- automated generation, validation, and drift/gardening workflows.

Trade-offs:

- catalog size makes curation essential;
- quality and applicability vary across many plugins;
- multi-harness conversion can hide semantic differences between runtimes;
- adopting the marketplace is much broader than this project's needs.

Decision: adopt the source-of-truth, adapter, and evaluation ideas; ship a tiny curated set.

## Why the blend is better

The compared systems optimize different axes:

- **methodology frameworks** optimize lifecycle consistency;
- **skill libraries** optimize reusable procedures;
- **enterprise frameworks** optimize governance and stack context;
- **architecture notes** optimize implementation design;
- **marketplaces** optimize breadth and distribution.

A project creator needs all five concerns, but not in one always-loaded artifact. The blend therefore uses layers:

```text
AGENTS.md                 stable local truth and guardrails
.agentic/profile.json     chosen architecture/testing policy
.agentic/skills/*         task procedures
references/*              style/stack detail loaded on demand
source/tests/toolchain     deterministic evidence
sync + doctor             portability and drift control
```

## Shipped skill set

| Skill | Purpose | Key completion evidence |
|---|---|---|
| `discover` | turn ambiguity into testable outcomes | requirements/assumptions/non-goals and public seam |
| `plan` | dependency-aware vertical plan | each task has behavior, test, implementation, verification |
| `implementation-style` | select/apply simple, functional-core, or clean | effect map, dependency direction, stack reference |
| `tdd` | seam-aware red/green/refactor | observed red, minimal green, protected refactor |
| `implement` | coordinate complete change | verified slices, reviews, final evidence |
| `diagnose` | reproduce/minimize/hypothesize/fix | regression test and original reproduction closed |
| `refactor` | preserve behavior while improving design | named transformations and green checks |
| `review` | spec and engineering review | findings prioritized with evidence |
| `verify` | fresh completion gate | commands, exit status, limitations |
| `write-skill` | author/evaluate local skills | structure, trigger evals, output evals, provenance |

## Design changes from the audited inputs

- Replace mandatory repeated approval with risk-based escalation and explicit assumptions.
- Replace one “best architecture” with a selector and complexity budget.
- Replace “all good tests are integration tests” with seam-specific test strategy.
- Reconcile TDD schools: micro-refactor after green; large structural refactors are separate, protected changes.
- Replace line-count limits with relevance, context cost, branches, and progressive disclosure.
- Add trigger and output eval fixtures.
- Add third-party skill supply-chain review.
- Add canonical skill source, generated projections, hashes, and drift diagnosis.
- Add stack-aware examples without forcing Java-style patterns into Rust or repositories into state-only UI samples.

## Adoption policy for external skills

Before importing a third-party skill:

1. identify the exact repository, path, commit/tag, maintainer, and license;
2. read every instruction and script, including hidden/install files;
3. enumerate tool, filesystem, network, environment, and secret access;
4. inspect trigger language for breadth, precedence, and routing collision;
5. run positive and negative trigger evals against your installed set;
6. run output evals on real project fixtures;
7. compare against no-skill and current-skill baselines;
8. copy only the needed capability into a reviewed local source, or pin the dependency;
9. record provenance and update policy;
10. remove skills that provide no measured value.

## Source links

- Matt Pocock skills: https://github.com/mattpocock/skills
- Superpowers: https://github.com/obra/superpowers
- GitHub Spec Kit: https://github.com/github/spec-kit
- BMAD Method: https://github.com/bmad-code-org/BMAD-METHOD
- Anthropic skills: https://github.com/anthropics/skills
- Trail of Bits skills: https://github.com/trailofbits/skills
- wshobson/agents: https://github.com/wshobson/agents
- Agent Skills specification: https://agentskills.io/specification
