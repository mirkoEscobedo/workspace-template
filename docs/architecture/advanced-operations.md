# Advanced operation contracts

## Common invariants

Tooling installation, skill upgrades, source restructuring, and architecture alignment are separate operations. Each planner records the complete normalized scope before apply. Apply validates plan integrity and repository fingerprints; it never treats `--yes` as authorization for new network, lifecycle, runtime, executable, removal, semantic, or remote-Git behavior.

## Persistent plans

Plan files are immutable reviewed inputs. Generate them outside paths the same command is expected to create when adopting an untouched repository, or commit them after adoption under `.agentic/plans/`.

A plan contains exact operations, commands, approvals, preconditions, verification, rollback strategy, and conflicts. Editing it invalidates the integrity hash. Changing a fingerprinted repository file or catalog invalidates applicability.

## Monorepo orchestration

Workspace discovery prefers explicit workspace manifests and records unsupported nodes rather than silently dropping them. Each supported module has one stable ID, normalized path, project type, manifest, package-manager/lock owner, commands, and internal dependency edges where the manifest provides them.

Mutating commands select modules explicitly or operate only when selection is unambiguous. Verification can select all, named, root, or affected modules and schedules dependency-first with bounded concurrency.

## Tooling installation

Planning resolves versioned packs or explicit dependencies and reports existing/conflicting capabilities. Apply authority is exact:

- `--allow-network` for commands marked networked;
- `--allow-runtime` for runtime dependencies;
- `--lifecycle-scripts allow` for commands whose reviewed plan permits lifecycle execution;
- `--scripts preserve|propose|managed-block|fail` for script/config integration.

Package-manager adapters produce argv arrays and expected paths. Native tools own lockfile changes. The mutation guard rejects source or unrelated config changes and restores reviewed paths on failure. Cache/build residue is reported rather than erased blindly.

## Skill updates

Project-owned baselines make local edits first-class. Planning compares every selected skill tree and highlights:

- upstream/local content changes;
- add/delete/rename state;
- clean text merges versus conflicts;
- scripts/executables;
- invocation/description changes;
- broader tools/permissions and cross-skill references.

Default apply is atomic. `--partial` creates an explicitly different authority decision. Removals and risky executable/tool changes require dedicated flags and remain blocked when local edits would be destroyed.

## Source restructuring

Restructuring changes location and required static references only. Explicit `--move` entries are the safest input. Organization/style presets can infer candidates but do not invent business abstractions.

The supported scanners are intentionally bounded:

- JavaScript/TypeScript/React: quoted ESM/CJS/literal dynamic references and selected JSON path fields;
- Rust: quoted path/include references and supported `crate::` use paths;
- Dart/Flutter: quoted import/export/part references including local package URIs.

Unsupported computed references, generated files, macros/custom loaders, ambiguous aliases, visibility/ownership changes, and cross-package moves are blockers/manual work. Compiler/analyzer verification is still required when available.

## Architecture alignment

Assessment findings are source-located heuristics, not an architecture verdict. Planning resolves exactly one module/use-case source file and emits ordered tasks such as characterization, explicit nondeterministic inputs, pure policy extraction, application-shell orchestration, real port/adapter boundary, composition wiring, and verification.

Manual execution writes one request and one result contract, then stops. Command execution invokes one local wrapper task at a time inside a checkpoint. The result schema cannot authorize broader paths; actual diff and commands are independently checked.

Alignment stops on a red baseline, absent characterization without an approved waiver, scope/budget expansion, unapproved manifest/lockfile changes, failed targeted/full verification, or blocking review. Completion stops before another slice and before any commit/push.

## Recovery

- stale or broadened plan: generate a new plan;
- tooling failure: inspect report, restored files, and reported residue;
- skill conflict: resolve staged conflict artifacts or change selection/approval, then replan;
- restructure failure: inspect retained report/checkpoint and generate a corrected move plan;
- manual alignment failure: repair the current bounded task/result and resume;
- semantic scope expansion: stop and create a new Wayfinder/plan decision, not an ad hoc executor instruction.
