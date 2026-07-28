# CLI and transaction architecture

## Purpose

`workspace-template` supports two entry conditions and several separately authorized follow-on operations:

```text
new target                         existing repository
    │                                     │
  create                               inspect
    │                                     │
    └──────────────► agentic workspace ◄──adopt / retrofit
                                          │
                         ┌────────────────┼─────────────────┐
                         ▼                ▼                 ▼
                      tooling       skills update      verify / doctor
                         │                │
                         ▼                ▼
                    restructure      project-owned
                         │             skill baseline
                         ▼
                       align
```

`create` and `adopt` do not share a mutation contract. `create` owns a new starter. `adopt` preserves the existing application and adds only the workspace-template-development substrate.

## Public commands

```text
create [directory]
inspect [directory]
adopt|retrofit [directory]
sync [directory]
doctor [directory]
verify [directory]
upgrade [directory] [--dry-run | --plan-out [path] | --apply-plan path]

tooling plan|install [directory]
skills update [directory]
restructure plan|apply [directory]
align plan|execute|status|resume [directory]
```

The package exposes the `workspace-template` binary and a JavaScript module surface from `src/index.js`.

## Inspect → plan → approve → apply → verify

Every mutating advanced command follows the same outer protocol while retaining command-specific authority:

```text
read-only repository/workspace snapshot
  ↓
command-specific planner
  ↓
versioned immutable plan
  ↓
human or policy approval
  ↓
precondition and integrity revalidation
  ↓
checkpoint / mutation boundary
  ↓
exact recorded operations and commands
  ↓
fresh verification and report
```

Planning and applying are separate functions. Apply never silently rescans and broadens the reviewed operation set.

### Plan envelope

Advanced plans contain:

- schema and plan version;
- content-derived plan identity and integrity hash;
- absolute repository root;
- selected workspace/module/path scope;
- Git, workspace, file, catalog, and command preconditions;
- normalized file operations and executable-plus-argv commands;
- explicit approvals for network, lifecycle scripts, runtime dependencies, semantic changes, risky skill behavior, dirty state, or removals;
- verification commands;
- rollback/checkpoint strategy;
- warnings, blocking conflicts, and `canApply`;
- command-specific metadata.

Changing the plan document, repository identity, selected files, incoming skill catalog, or other material precondition invalidates apply.

### Nested plans

An alignment plan can reference separately approved tooling or restructuring plans. Nested plans preserve their own integrity, approvals, operation boundaries, reports, and failure semantics. Parent semantic approval does not imply network, package lifecycle, runtime dependency, skill-risk, or mechanical-move authority.

## Module boundaries

```text
src/
├── args.js / cli.js                 command parsing, routing, rendering
├── create.js                        new-project workflow
├── inspection.js                    existing-repository evidence
├── adoption-plan.js / adopt.js      safe retrofit planning and apply
├── plans/                            common schema, fingerprints, journals, nesting
├── workspace/                        module discovery, graph, affected selection, verify
├── tooling/                          packs, package-manager adapters, structured integration
├── skills/                           baselines, catalog, merge, update plan/apply
├── restructure/                      inventory, language adapters, move plan/apply
├── align/                            assessment, slice plan, executor guard/orchestration
├── checkpoints/                      worktree/copy and tracked-file backups
├── sync.js / doctor.js              projections, ownership and structural diagnostics
└── fs-utils.js / process-utils.js    atomic/root-contained I/O and bounded processes
```

The design keeps read-only evidence, pure-ish plan construction, and side-effecting apply code separate. Deterministic renderers consume the plan rather than reconstructing it.

## Command authority matrix

| Command | May write | Must preserve |
|---|---|---|
| `create` | selected starter, profile, skills, projections, optional Git/install results | external/remote systems |
| `adopt` | `.agentic/**`, `docs/agent/**`, approved instruction blocks/proposals, canonical skills, conflict-free projections, ticket metadata | source/tests, manifests/lockfiles, `README.md`, CI/deployment, dependencies |
| `upgrade` | exact sealed package-owned substrate, managed instruction blocks, skill baselines/projections, transaction memory | product code, manifests/lockfiles, durable planning memory, local presets, unowned/drifted content |
| `tooling install` | exact reviewed manifest/lock/script/config paths and transaction reports | unrelated dependencies/config/source |
| `skills update` | selected canonical skills, baselines, lock, selected projections and reports | unrelated/local-conflicted skills |
| `restructure apply` | planned moves and reference/config rewrites caused by the move | behavior, dependency set, domain rules, package ownership |
| `align execute` | one approved semantic slice and its tests/docs inside allowed paths | unrelated use cases/modules, unapproved nested operations, remote Git state |
| `verify` / `doctor` | optional report state only | project content |

No command inherits another command’s write authority because they appear in one user request.

## Installed workspace upgrades

`upgrade` is the single path for both generated and adopted repositories.
Planning reads the installed workspace identity and ownership manifests, then
renders the incoming substrate from the currently running package. It performs
three-way skill merges and preserves managed-section ownership instead of
claiming whole adopted instruction files.

- No flag seals and immediately applies the exact plan.
- `--dry-run` emits that same plan without writing; `--json` is the agent seam.
- `--plan-out [path]` persists without applying. With no path, the deterministic
  name is `.agentic/plans/upgrades/upgrade-<from>-to-<to>-<plan-id>.json`.
- `--apply-plan <path>` applies only the saved, integrity-checked operations.

Apply revalidates repository, file, catalog, command, lease, transaction, and
symlink preconditions; runs pre-verification; validates a staged proposed tree;
creates a durable write-set backup; writes identity/manifest files last; then
runs post-doctor and the same sealed verification authority. Verification is
audited for filesystem side effects. Any failure restores the backup and
records a terminal journal event. Direct upgrades retain the sealed plan and
report under `.agentic/transactions/<plan-id>/`.

## Repository and workspace inspection

Inspection is read-only and records:

- resolved path, Git root/HEAD/dirty state, filesystem-root and symlink safety;
- supported stack evidence and confidence;
- package manager and lockfile owner;
- existing scripts and safe verification candidates;
- root/nested instructions, canonical/projection skills, locks and ownership markers;
- local ticket tracks;
- recognized npm-family workspaces, Cargo members/path dependencies, Flutter/Dart package layouts, and supported polyglot combinations;
- stable module IDs, paths, manifests, commands, internal edges, opaque members, warnings, and conflicts.

Ambiguous lockfile ownership, duplicate/case-colliding module IDs, overlapping module roots, cycles, or unsafe paths block planning instead of selecting the first match.

## Workspace verification

The workspace graph drives root, selected-module, all-module, and Git-affected verification. Affected mode maps changed paths to owners and includes configured transitive dependents. Commands are grouped dependency-first; independent groups may run with bounded concurrency. Results remain deterministically ordered and use explicit states:

```text
passed | failed | blocked | skipped | unknown
```

Verification never installs dependencies or invents an unavailable command.

## Tooling transactions

A tooling plan resolves versioned capability packs and explicit dependencies against each selected module. Package-manager adapters emit an executable, argv, cwd, expected mutation paths, network requirement, lifecycle policy, and dependency kind. Apply:

1. validates the immutable plan and explicit authority flags;
2. snapshots reviewed files and the surrounding mutation boundary;
3. invokes npm, pnpm, Yarn, Bun, Cargo, or Flutter/Dart tooling without an interpolated shell string;
4. detects unplanned paths immediately;
5. performs conservative JSON/YAML/TOML and package-script integration according to preserve/propose/managed/fail policy;
6. verifies requested dependencies and project commands;
7. restores promised paths on failure and reports residue it cannot safely remove.

## Skill upgrades

Managed skills are vendored source, not a cache. For each skill the updater compares:

```text
baseline = exact incoming snapshot used by the prior successful install
local    = current project-owned canonical skill
incoming = selected new catalog snapshot
```

Per-file decisions cover unchanged sides, identical edits, additions, deletions, clean non-overlapping text merges, real conflicts, and risky executable/permission changes. Canonical trees are staged and validated before replacement. Default apply is atomic across the selected set; `--partial` is an explicit different plan.

## Mechanical restructuring

A restructure plan inventories one selected module, normalizes explicit or inferred moves, checks collisions and ownership, scans supported static references, and embeds exact rewritten content/hashes. Apply runs in a worktree when possible or a bounded copy otherwise, verifies the staged tree, applies only the reviewed changed paths, verifies the target, and restores reviewed paths on failure.

Adapters are intentionally conservative. They use location-aware token/literal scanning and structured path resolution for a supported subset; they do not claim to be complete language compiler frontends. Computed imports, ambiguous aliases, generated relationships, macros/custom loaders, and cross-module ownership changes are blockers or manual work.

## Architecture alignment

Alignment is semantic and therefore remains separate from restructuring. Planning produces source-located effect/seam evidence, chooses exactly one module and observable use-case file, records characterization policy, generates bounded ordered tasks, and sets allowed paths plus file/diff limits.

Execution supports:

- `manual`: emit one task request/result contract and stop;
- `command:<executable>`: invoke one configured local wrapper for one task.

After every task, the orchestrator compares the actual filesystem diff with the structured claim, enforces scope/budgets, runs required verification itself, and records evidence. Final verification and deterministic scope/quality guards run before completion. The workflow stops after one migration slice and never commits or pushes.

## Checkpoints and rollback

- `worktree` prefers an isolated Git worktree and falls back to a staged copy when unavailable.
- `copy` uses a bounded repository copy excluding generated transaction/cache/build state.
- `patch` uses copy semantics while preserving patch-oriented reporting.
- Tooling and final target apply use tracked/file backups and mutation-boundary snapshots.
- Success reports are written only after required gates pass; failures retain actionable reports/journals.

Cross-system side effects and package caches cannot be transactionally erased in general. Reports distinguish guaranteed restoration from retained residue.

## Idempotence and ownership

Generated ownership is recorded independently of configuration:

- `.agentic/managed-files.json` for fully managed files, managed sections, and proposals;
- `.agentic/skills.lock.json` and `.agentic/skill-baselines/` for skill provenance;
- `.agentic/managed-projections.json` for harness projections;
- stable managed-block markers inside custom instruction files.

An unchanged rerun produces no content churn. Unmanaged divergent collisions block or become proposals. Sync removes only projections proven to be managed by a prior manifest.

## Release validation

Release validation occurs at three levels:

1. source self-check and Node test suite;
2. `npm pack --dry-run` and package-content inspection;
3. installation of the actual `.tgz` into a clean consumer followed by packed CLI smoke tests.

The packed test does not depend on a live paid model or hidden network package. It uses a local `file:` package for the package-manager transaction and the manual alignment executor for the semantic stop gate.
