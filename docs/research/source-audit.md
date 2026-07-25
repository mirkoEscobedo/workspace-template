# Research source audit, provenance, and limitations

**Cutoff for this audit:** 2026-07-11

## Method

Sources were ranked in this order:

1. official specification or official framework/language documentation;
2. primary repository maintained by the author/organization;
3. primary research paper or preprint;
4. user-provided material;
5. secondary commentary only when primary material was unavailable.

The implementation uses original text and code. External repositories were read for comparison and design inspiration; their skills were not copied into the npm package.

## User-provided artifacts

### `ai-avvale-framework.zip`

Audited areas:

- task classification;
- data security;
- AI assistant setup;
- development workflow;
- AI-assisted code review;
- adoption metrics and onboarding prompts;
- stack `AGENTS.md` templates;
- Python procedural skills;
- MCP setup guidance;
- token/context optimization material.

Used in the design:

- governance and risk awareness;
- stable project command/context template;
- data/security guardrails;
- stack-specific gotcha mindset;
- onboarding and review concepts.

Not redistributed:

- proprietary/internal repository links and catalogs;
- exact templates or prose;
- organization-specific process content.

### `localskills.zip`

Audited skills included TDD, grilling/discovery, architecture improvement, prototypes, diagnosis, handoff, triage, PRD/issues, package audit, and skill authoring.

Used in the design:

- vertical tracer-bullet TDD;
- behavior-through-public-interface emphasis;
- domain language/ADR ideas;
- progressive disclosure;
- diagnosis and handoff needs.

Changes made:

- removed arbitrary line-count authoring rules;
- replaced repeated mandatory approvals with risk-based escalation;
- added selectable implementation profiles;
- made test strategy seam-specific;
- added trigger/output eval fixtures and supply-chain review;
- separated micro-refactoring from broad structural work;
- created a canonical skill source with projection/drift tooling.

### `example.md`

This long design note was the main implementation-style input. It covers:

- functional core / imperative shell;
- hexagonal/ports-and-adapters and dependency inversion;
- repositories and application services/use cases;
- composition roots and transactions;
- explicit time/randomness/identity;
- functions versus classes;
- anti-overengineering guidance;
- Rust and TypeScript mappings/examples.

It was not copied wholesale because an approximately 1,500-line tutorial is too costly and broad for one always-loaded skill. Its concepts were decomposed into:

- a compact `implementation-style/SKILL.md`;
- `style-simple.md`, `style-functional-core.md`, and `style-clean.md`;
- stack references for Rust, TypeScript, JavaScript, React, and Flutter;
- generated starter examples.

## Official and primary sources

| Source | Role in research | Notes |
|---|---|---|
| Anthropic “Building effective agents” | workflow vs agent distinction, simple composable patterns | https://www.anthropic.com/research/building-effective-agents |
| Anthropic context engineering | finite context and selective loading | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents |
| OpenAI practical guide | starting simple, layered guardrails, human intervention | https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf |
| OpenAI Codex skills and `AGENTS.md` docs | current progressive-loading, trigger, `.agents/skills`, and nested instruction behavior | https://learn.chatgpt.com/docs/build-skills and https://learn.chatgpt.com/docs/agent-configuration/agents-md |
| Claude Code memory and skills docs | current `CLAUDE.md`/skill separation, imports, and `.claude/skills` path | https://code.claude.com/docs/en/memory and https://code.claude.com/docs/en/skills |
| Gemini CLI context and skills docs | `GEMINI.md` imports plus `.gemini/skills` and `.agents/skills` discovery | https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md and https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/skills.md |
| GitHub Copilot skill docs | project skill locations, frontmatter, resources, and shell preapproval warning | https://docs.github.com/en/copilot |
| OpenCode skill docs | `.opencode/skills`, compatible aliases, permissions, and frontmatter limits | https://opencode.ai/docs/skills/ |
| Agent Skills specification | folder/frontmatter/resource contract | https://agentskills.io/specification |
| Agent Skills best practices/evals | iterative authoring, trigger/output evaluation | https://agentskills.io/skill-creation/best-practices |
| `AGENTS.md` specification | repository instruction placement and nesting | https://agents.md/ |
| Flutter architecture/testing | current adaptive architecture and test guidance | https://docs.flutter.dev/app-architecture/guide |
| Effective Dart | Dart idioms | https://dart.dev/effective-dart |
| React docs | reducers and custom hooks | https://react.dev/learn/extracting-state-logic-into-a-reducer |
| Rust Book | testing and traits | https://doc.rust-lang.org/book/ch11-00-testing.html |
| Fowler catalog/TDD | named refactorings and red-green-refactor baseline | https://refactoring.com/catalog/ |

### Reso Coder course link

The user supplied:

https://resocoder.com/2019/08/27/flutter-tdd-clean-architecture-course-1-explanation-project-structure/

Automated access was blocked by the site's protection during this research session. The report therefore does not claim a line-by-line audit of that page. It treats the course as historical inspiration and uses maintained official Flutter architecture/testing documentation as the current primary baseline.

## Harness compatibility decision

The audit found that repository skill paths are converging but are not identical:

- Codex currently uses `.agents/skills` for repository skills.
- Claude Code uses `.claude/skills` and does not directly treat root `AGENTS.md` as its project memory file.
- Gemini CLI, GitHub Copilot, and OpenCode accept `.agents/skills` as an interoperable path, while also supporting their own native directories.
- Cursor uses project rules rather than the same skill-discovery contract.

The generator therefore retains `.agentic/skills` as an explicitly tool-neutral editable source and projects copies. It creates a minimal `CLAUDE.md` or `GEMINI.md` import bridge only when needed and preserves pre-existing custom files.

## Public workflow and skill repositories

Reviewed from their default branches on the audit date:

| Repository | Files emphasized | Use |
|---|---|---|
| `mattpocock/skills` | README, writing-great-skills, implement, tdd | compact composability, invocation/context vocabulary, completion criteria |
| `obra/superpowers` | README, test-driven-development | mandatory lifecycle, observed RED, systematic verification |
| `github/spec-kit` | README/process overview | constitution/spec/plan/task traceability and override model |
| `bmad-code-org/BMAD-METHOD` | README | scale-adaptive role-heavy lifecycle comparison |
| `anthropics/skills` | README/spec pointers | canonical packaging/reference examples |
| `trailofbits/skills` | README/catalog | security/testing specialty ecosystem |
| `wshobson/agents` | README/architecture/eval overview | multi-harness source generation and evaluation ideas |

These repositories evolve rapidly. The comparison is a dated snapshot, not a permanent ranking.

## Research papers and caveats

### Runtime-Structured Task Decomposition for Agentic Coding Systems

https://arxiv.org/abs/2605.15425

Useful signal: executable branching, schema validation, persisted state, and selective retry can outperform static prompt decomposition under failure. Caveats: only two controlled workloads, ten runs per configuration, simulated failure for retry cost, and higher baseline overhead for decomposition.

### SWE-Skills-Bench

https://arxiv.org/abs/2604.18595

Useful signal: many skills may provide little benefit, and mismatched/outdated instructions can hurt. Caveat: preprint, benchmark/task/model selection limits generalization. It motivates evaluation; it does not prove skills are broadly ineffective.

### Under the Hood of SKILL.md

https://arxiv.org/abs/2605.11418

Useful signal: discovery/selection/governance can be manipulated through skill metadata/instructions. Caveat: preprint and tested registry mechanisms are not every agent environment. It motivates code-like review of skills.

### Adoption and PR studies

- https://arxiv.org/abs/2601.18341
- https://arxiv.org/abs/2601.17581

Useful signal: coding agents are widely used and agent-authored changes have distinct size/commit characteristics. These studies are observational and do not establish causality about quality.

## Dependency snapshot

The npm package starter versions were queried from the npm registry on 2026-07-11 and recorded in `src/constants.js`. Flutter lints were checked against pub.dev. Versions are pins for reproducibility, not evergreen recommendations.

Rust starters have no third-party runtime dependencies. Flutter starters use only the Flutter SDK at runtime and `flutter_lints` for development. React starters use the normal React/Vite/testing toolchain.

## Validation record

The exact package and generated-project checks are recorded in [../validation.md](../validation.md).

## Validation environment limitation

The package's own Node tests and generated JavaScript/TypeScript/React projects were executed in the build environment. Rust and Flutter/Dart toolchains were not installed there. Their generated templates were structurally inspected and covered by generator tests, but final consumers must run the generated full verification commands with installed toolchains:

```bash
# Rust
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test

# Flutter
flutter pub get
dart format --output=none --set-exit-if-changed .
flutter analyze
flutter test
```

This limitation is intentionally disclosed rather than converting static inspection into a false execution claim.
