# workspace-template

`workspace-template` creates a new agent-ready project or safely retrofits an existing repository into the **Frontier Loop** workflow.

Version 0.6.0 combines:

- Wayfinder planning and dependency-frontier ticket compilation;
- one continuous, local-file-based coordinator workflow;
- project-owned Agent Skills and conflict-safe harness projections;
- GPT-5.6 Sol high for orchestration/planning and GPT-5.3-Codex high for all delegated engineering roles;
- immutable inspect → plan → approve → apply → verify transactions;
- workspace/monorepo discovery and dependency-aware verification;
- explicit dependency/tooling installation;
- three-way upgrades for locally editable skills;
- guarded source-tree restructuring;
- bounded, one-slice-at-a-time architecture alignment;
- test-topology and process-lifecycle controls.

The Frontier Loop does **not** require GitHub issues, webhooks, a repository watcher, or several independent chats. One coordinator session reads and updates local repository artifacts, delegates bounded roles when the harness supports them, lands approved work serially, and recomputes the next ready frontier.

## Requirements

- Node.js `>=24`.
- Git is recommended for repository fingerprints and worktree checkpoints, but non-Git directories can be created or adopted with documented limitations.
- Rust, Flutter/Dart, and package-manager toolchains are needed only when their commands are actually executed.

The CLI has no external runtime dependency.

## Quick start

### Create a new project

```bash
npx workspace-template create my-service \
  --project typescript \
  --style functional-core \
  --tdd pragmatic
```

For an offline or review-only generation pass:

```bash
npx workspace-template create my-service \
  --project typescript \
  --no-install \
  --no-git \
  --yes
```

Supported starter targets are Rust, TypeScript, JavaScript, React with TypeScript, and Flutter/Dart. New projects select `simple`, `functional-core`, or `clean` as an implementation direction and `strict`, `pragmatic`, or `off` as the TDD policy.

### Retrofit an existing repository

Inspect and persist the exact plan without writing to the repository:

```bash
  npx workspace-template adopt . \
  --dry-run \
  --json \
  --plan-out .workspace-template-adoption-plan.json
```

Apply only that reviewed plan:

```bash
npx workspace-template adopt . \
  --apply-plan .workspace-template-adoption-plan.json
```

`retrofit` is an alias for `adopt`.

Adoption preserves application source, tests, dependency manifests, lockfiles, `README.md`, CI, deployment files, and custom instructions. It adds the agentic substrate, durable planning state, skills, harness configuration, and optional ticket/document retrofits. Existing unmanaged collisions block or become proposals according to the selected policy; they are not silently overwritten.

## Frontier Loop

The generated workflow is:

```text
Wayfinder
  → Compile Master Plan
  → compute local dependency frontier
  → parallel read-only preflight
  → one writer by default
  → independent review lenses
  → targeted repair
  → serial integration
  → recompute frontier
```

The coordinator may continue through all ordinary local tickets in one conversation. It stops at completion, a human authority gate, a material contradiction, unsafe scope expansion, or unrecoverable verification.

### Planning roles

- **Wayfinder** resolves the destination, completion proof, decisions, constraints, authority gates, evidence, and remaining fog.
- **Compile Master Plan** converts a stable route into vertical ticket contracts with dependencies, conflict keys, risk lanes, verification levels, architecture budgets, and stop conditions.
- **Execute Frontier** runs the ready local frontier. Read-only investigation and independent reviews may be parallel; overlapping mutation and authority transitions remain serialized.

### Default model routing

| Role | Model | Reasoning |
|---|---|---|
| Coordinator/orchestrator | `gpt-5.6-sol` | high |
| Wayfinder/planner | `gpt-5.6-sol` | high |
| Scout | `gpt-5.3-codex` | high |
| Implementer | `gpt-5.3-codex` | high |
| Spec/authority reviewer | `gpt-5.3-codex` | high |
| Code/test reviewer | `gpt-5.3-codex` | high |
| Operations/security reviewer | `gpt-5.3-codex` | high |
| Repairer | `gpt-5.3-codex` | high |
| Integrator | `gpt-5.3-codex` | high |

Generated Codex roles are under `.codex/agents/`; generated OpenCode role prompts are under `.opencode/prompts/frontier-loop/`. Planners and reviewers are read-only. Write access is limited to implementation, repair, and integration roles. The default child-agent cap is three.

## ChatGPT Wayfinder

The repository contains two deliberately different Wayfinder editions:

- `chatgpt-skills/wayfinder-planner/SKILL.md` is a single self-contained file for ChatGPT’s Skills interface. It includes conversational planning, the visible ledger, route stabilization, master-plan compilation, ticket templates, retrofit behavior, and the handoff to local execution.
- `assets/skills/wayfinder/SKILL.md` is the modular repository edition. It writes durable planning artifacts and delegates ticket compilation to `compile-master-plan`.

The ChatGPT file can be placed in a `wayfinder-planner/` folder and uploaded from **Skills → + → Upload from your computer**.

## Generated project shape

Every new or adopted workspace receives the applicable subset of:

```text
AGENTS.md

.agentic/
  config.json
  profile.json
  profile.schema.json
  implementation-profile.md
  dependency-snapshot.md
  managed-files.json
  managed-projections.json
  skills.lock.json
  skill-baselines/
  skills/
  plans/
  transactions/
  reports/
  migrations/
  restructures/

.agent/
  leases/

.agents/skills/                 Codex/open Agent Skills projection
.codex/config.toml
.codex/hooks.json
.codex/agents/

opencode.json
.opencode/prompts/frontier-loop/
.opencode/skills/

docs/agent/
docs/tickets/
```

`.agentic/skills` is the canonical, project-owned skill tree. Harness copies are projections and are never authoritative.

## Command families

```text
workspace-template create [directory] --project <type>
workspace-template inspect [directory]
workspace-template adopt|retrofit [directory]
workspace-template sync [directory]
workspace-template doctor [directory]
workspace-template verify [directory] --scope root|module|affected|all

workspace-template tooling plan [directory] ...
workspace-template tooling install [directory] --apply-plan <file> ...

workspace-template skills update [directory] --check
workspace-template skills update [directory] --plan-out <file>
workspace-template skills update [directory] --apply-plan <file>

workspace-template restructure plan [directory] --module <id> --move <from=>to>
workspace-template restructure apply [directory] --apply-plan <file>

workspace-template align plan [directory] --module <id> --use-case <path>
workspace-template align execute [directory] --apply-plan <file>
workspace-template align status [directory] --plan-id <id>
workspace-template align resume [directory] --apply-plan <file>
```

See [the complete usage guide](docs/usage.md) for command options and examples.

## Safety contracts

### Adoption

`adopt` adds workflow infrastructure. It does not restructure production source, install dependencies, initialize Git, commit, push, publish, deploy, or silently replace custom skills/instructions.

### Tooling installation

Dependency changes require a persisted tooling plan. Apply uses the native package manager with executable-plus-argv invocation, validates the resulting mutation set, and requires explicit authority for network access, runtime dependencies, and package lifecycle scripts. Lockfiles are never hand-edited.

### Skill upgrades

Managed skills retain an exact project-owned baseline. Updates compare baseline, local, and incoming content. Clean non-overlapping text changes can merge; overlapping edits, risky executable/tool changes, removals, and unmanaged projection collisions remain review gates.

### Source restructuring

`restructure` is mechanical only: reviewed file moves plus static reference/config rewrites. It uses language-specific, location-aware scanners for supported JavaScript/TypeScript/React, Rust, and Dart/Flutter constructs. Dynamic imports, generated code, macros, custom loaders, ambiguous module ownership, and unsupported relationships fail closed or become explicit manual work. It does not claim compiler-grade semantic equivalence.

### Architecture alignment

`align` handles one observable use case at a time. It records architecture/effect evidence, requires characterization or an explicit waiver, enforces allowed paths and file/diff budgets, runs tasks in a checkpoint, independently verifies the filesystem diff, and stops after one completed slice. Manual execution emits task/result files without launching a model. Command execution is bounded and cannot commit or push through the built-in protocol.

### Process ownership

Generated process-lifecycle assets wrap commands with leases, process-tree ownership, deadlines, bounded output, and zero-descendant completion checks. On POSIX they use process groups; on Windows the Python wrapper attempts Job Object ownership and falls back conservatively when unavailable.

## Workspace and monorepo support

The workspace inspector understands recognized npm-family workspaces, Cargo workspaces, Flutter/Dart package layouts, and polyglot combinations. It records stable module IDs, paths, command evidence, lockfile ownership, and manifest-declared internal dependencies. Unsupported members remain opaque evidence instead of disappearing.

Verification can run:

- the root aggregate gate;
- selected modules;
- all modules;
- modules affected since a Git ref plus their configured dependents.

Commands run dependency-first with bounded concurrency. Results distinguish `passed`, `failed`, `blocked`, `skipped`, and `unknown`.

## Ticket and documentation retrofit

Adoption can add a durable `docs/agent/` knowledge shape and retrofit existing local ticket tracks without replacing their prose. Standalone dependency-free Python tools are also installed under `.agentic/scripts/` and the corresponding skills:

```bash
python .agentic/scripts/retrofit_docs.py docs --apply
python .agentic/scripts/retrofit_tickets.py docs/tickets/<track> --apply
python .agentic/scripts/validate_ticket_pack.py docs/tickets/<track>
python .agentic/scripts/check_architecture_budgets.py .
```

The ticket retrofit adds contracts, manifests, evidence directories, risk lanes, conflict keys, architecture budgets, and a protected local frontier. It can recover legacy hierarchy while keeping uncertainty explicit.

## Development and release validation

```bash
npm run lint
npm test
npm run check
npm run pack:check
npm pack
npm run test:packed -- ./workspace-template-0.6.0.tgz
npm publish --dry-run --ignore-scripts
```

The packed smoke test installs the actual tarball into a clean consumer, checks the packed payload and version, creates and diagnoses a project, round-trips a persisted adoption plan while proving source/custom-instruction preservation, checks project-owned skill updates, verifies a dependency-aware workspace, installs a local `file:` dependency without network, applies a mechanical restructure, and proves the manual architecture-alignment stop gate.

See [the validation record](docs/validation.md) for the exact release evidence and limitations.

## Documentation

- [Usage guide](docs/usage.md)
- [HTML user guide](docs/guides/frontier-loop-user-guide.html)
- [CLI architecture](docs/architecture/cli-design.md)
- [Frontier operating model](docs/architecture/frontier-loop.md)
- [Advanced operation contracts](docs/architecture/advanced-operations.md)
- [Skill-system architecture](docs/architecture/skill-system.md)
- [Validation record](docs/validation.md)
- [0.6.0 release notes](docs/releases/0.6.0.md)
- [Versioned retrofit objective](docs/plans/0.6.0-existing-repository-retrofitting-plan.md)
- [Security policy](SECURITY.md)
- [Workspace-template-development research](docs/research/workspace-template-development-research.md)
- [Implementation patterns](docs/research/implementation-patterns.md)
- [Skill comparison](docs/research/skill-comparison.md)

## License

MIT. External projects informed the research and design but are not vendored; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
