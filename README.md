# workspace-template

`workspace-template` creates a new agent-ready project or safely retrofits an existing repository into an **Adaptive Delivery** workflow.

Version 0.7.0 is a methodology-rescue release. It combines:

- Direct delivery by default, with Ticketed and Governed modes admitted only by explicit risk or durability signals;
- a bounded execution state machine with two semantic repairs, one classified flaky rerun, and explicit replanning outcomes;
- independent read-only review with a static-to-runtime evidence ladder;
- conditional runtime-debug and interactive-GUI inspection when deterministic evidence cannot establish correctness;
- one compact current ticket for durable work instead of generated ticket or validator graphs;
- project-owned Agent Skills and conflict-safe harness projections;
- a default `sol-only` route using GPT-5.6 Sol high for every role, plus the historical `sol-codex` split using GPT-5.3 Codex high natively and the matching GPT-5.3 Codex Spark model through OpenCode for delegated engineering roles;
- immutable inspect → plan → approve → apply → verify transactions;
- workspace/monorepo discovery and dependency-aware verification;
- explicit dependency/tooling installation;
- three-way upgrades for locally editable skills;
- guarded source-tree restructuring;
- bounded, one-slice-at-a-time architecture alignment;
- test-topology controls and optional process-lifecycle/integration specialists.

Frontier/Wayfinder execution is no longer the default. The legacy `frontier-loop`,
`execute-frontier`, `ticket-review`, and `repair-ticket` skills remain for one
release as compatibility shims that route into Adaptive Delivery and emit
deprecation guidance. Historical ticket graphs remain history; failed checks do
not generate successor tickets, decision files, validation scripts, or evidence
trees.

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

Use `--host-bundles preserve` when the repository already owns its Codex/OpenCode host assets. The sealed adoption plan then contains no operations or collision checks under `.agents/`, `.codex/`, `.opencode/`, or product-owned `opencode.json`; the default `--host-bundles managed` behavior is unchanged. Subsequent implicit `sync` and `skills update` projection steps report a successful `no-projection` result and leave those paths byte-identical. Explicit attempts to target protected projections fail before writing.

## Adaptive Delivery

The generated workflow is:

```text
INTAKE → ROUTED → PLANNED → IMPLEMENTING → VERIFYING → REVIEWING → ACCEPTED
                                          ↘ DIAGNOSING / INSPECTING
                                             → REPAIRING → VERIFYING
                                             → REPLANNING → redirect/defer/abort
```

`delivery-loop` is the normal entry point. Ordinary features, fixes, refactors,
and bounded investigations select Direct mode and create no process artifacts.
Multi-session work or several independently useful vertical slices select
Ticketed mode. Governed mode is reserved for irreversible operations,
credentials/security boundaries, financial authority, destructive migrations,
native process ownership, or production external side effects. Ambiguity alone
does not select Governed.

### Planning roles

- **Delivery Loop** selects the least-governed safe mode and defines acceptance evidence.
- **Execute Delivery** coordinates the bounded state machine; it cannot mint extra work to obtain retries.
- **Review Change** returns `PASS`, `FAIL`, or `INSUFFICIENT_EVIDENCE` and the permitted transition. It never repairs source or expands scope.
- **Repair Change** requires a new falsifiable hypothesis and stops after two semantic repair rounds.
- **Wayfinder** is admitted only for a material product or architecture decision that repository evidence cannot resolve. It produces one decision memo and does not resume execution automatically.

### Swappable agent presets

Every created or adopted repository receives the complete built-in preset
catalog. `sol-only` is active by default; `sol-codex` preserves the original
Sol coordinator/planner and Codex worker split, using the matching Codex Spark
model for OpenCode workers. Selecting a preset changes only
the active routing—it does not remove inactive presets.

```bash
workspace-template preset list .
workspace-template preset plan . --preset sol-codex --plan-out ../sol-codex-plan.json
workspace-template preset apply . --apply-plan ../sol-codex-plan.json
workspace-template preset status .
```

Repository-owned experimental definitions live in
`.agentic/presets/local/`. Built-ins live in `.agentic/presets/builtin/`, and
the expanded active policy lives in `.agentic/policies/model-routing.yaml`.
Start a new agent session after switching because an existing session retains
the configuration it loaded at startup.

### Seamless workspace upgrades

Created and adopted repositories now share one atomic upgrade path:

```bash
workspace-template upgrade . --allow-network
workspace-template upgrade . --dry-run
workspace-template upgrade . --dry-run --json
workspace-template upgrade . --plan-out --allow-network
workspace-template upgrade . --apply-plan ".agentic/plans/upgrades/upgrade-0.6.1-to-0.7.0-<id>.json"
```

Bare `upgrade` seals the exact plan, runs doctor plus every sealed module/root
verification command, stages and validates the proposed tree, backs up its
write set, applies, then repeats doctor and verification. Any write or
verification failure restores the exact pre-upgrade state of the reviewed
repository-local write set. Verification runs only in disposable repository
copies, so `.git`, dependency trees, reports, transaction outputs, and deletion
of the copy cannot mutate the source repository. Because portable confinement
cannot prevent a command from reaching other filesystem paths or the network,
verification requires explicit `--allow-network`; external effects are not
claimed reversible. The sealed plan,
journal, backup metadata, and report remain under
`.agentic/transactions/<plan-id>/` for recovery and audit. `--dry-run` prints
that same plan without writing. Bare `--plan-out` creates a deterministic reviewed-plan name
under `.agentic/plans/upgrades/`, prints its path and exact apply command, and
does not apply. The active preset, generated/adopted identity, original
timestamp, product files, durable planning memory, and repository-local preset
definitions are preserved.

The isolated upgrade checkpoint deliberately excludes source `node_modules`.
For this baseline, a verified JavaScript/TypeScript manifest with any declared
dependency section, or a selected verification script that names
`node_modules/.bin`, blocks planning instead of running an
incomplete check. Native whole-tree upgrade verification is currently supported
only by the Windows Job Object owner; POSIX upgrade verification fails before
payload or lease creation when detached-session containment is unavailable.

For fair A/B experiments, create sibling branches or worktrees from the same
feature baseline, activate a different preset on each, and run equivalent
tasks and verification. Switching a preset never resets code or commits from a
previous attempt.

Generated Codex roles are under `.codex/agents/`; generated OpenCode role prompts remain under `.opencode/prompts/frontier-loop/` for host compatibility. Planners and reviewers are read-only. Write access is limited to implementation, repair, and integration roles. The default child-agent cap is three.

## Wayfinder

- `assets/skills/wayfinder/SKILL.md` contains a strict admission test. If admitted, it writes one concise decision memo. It does not compile a ticket pack, create validation code, or automatically continue execution.

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
workspace-template preset list|status [directory]
workspace-template preset plan [directory] --preset <id> --plan-out <file>
workspace-template preset apply [directory] --apply-plan <file>

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

Generated process-lifecycle assets wrap commands with leases, process-tree ownership, deadlines, bounded output, and zero-descendant completion checks. On POSIX they use process groups; on Windows the Python wrapper attempts Job Object ownership and falls back conservatively when unavailable. Finalized receipts remain durable evidence but are excluded from upgrade dirty-state checks; active leases are still blockers.

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

The ticket retrofit adds contracts, manifests, evidence directories, risk lanes, conflict keys, architecture budgets, and a protected local frontier. It can recover legacy hierarchy while keeping uncertainty explicit. Executable contracts must include at least one nonblank exact verification command; aggregate-only and historical records are the explicit non-executable exceptions.

## Development and release validation

```bash
npm run lint
npm test
npm run check
npm run pack:check
npm pack
npm run test:packed -- ./workspace-template-0.7.0.tgz
npm publish --dry-run --ignore-scripts
```

The packed smoke test installs the actual tarball into a clean consumer, checks the packed payload and version, creates and diagnoses a project, round-trips a persisted adoption plan while proving source/custom-instruction preservation, checks project-owned skill updates, verifies a dependency-aware workspace, installs a local `file:` dependency without network, applies a mechanical restructure, and proves the manual architecture-alignment stop gate.

See [the validation record](docs/validation.md) for the exact release evidence and limitations.

## Documentation

- [Usage guide](docs/usage.md)
- [Adaptive Delivery guide](docs/guides/adaptive-delivery.md)
- [HTML user guide](docs/guides/frontier-loop-user-guide.html)
- [CLI architecture](docs/architecture/cli-design.md)
- [Frontier operating model](docs/architecture/frontier-loop.md)
- [Advanced operation contracts](docs/architecture/advanced-operations.md)
- [Skill-system architecture](docs/architecture/skill-system.md)
- [Validation record](docs/validation.md)
- [0.7.0 release notes](docs/releases/0.7.0.md)
- [0.6.1 release notes](docs/releases/0.6.1.md)
- [0.6.0 release notes](docs/releases/0.6.0.md)
- [Versioned retrofit objective](docs/plans/0.6.0-existing-repository-retrofitting-plan.md)
- [Security policy](SECURITY.md)
- [Workspace-template-development research](docs/research/workspace-template-development-research.md)
- [Implementation patterns](docs/research/implementation-patterns.md)
- [Skill comparison](docs/research/skill-comparison.md)

## License

MIT. External projects informed the research and design but are not vendored; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
