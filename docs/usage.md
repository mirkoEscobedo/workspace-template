# Usage guide

This guide covers new-project creation, safe repository adoption, local Frontier execution, workspace verification, explicit tooling changes, skill upgrades, source restructuring, and bounded architecture alignment.

## 1. Choose `create` or `adopt`

Use `create` for a new target or an intentionally generated starter. Use `adopt`/`retrofit` for an existing repository.

| Concern | `create` | `adopt` |
|---|---|---|
| Application source | generated | preserved |
| Tests | generated starter | preserved |
| Dependency manifests/lockfiles | generated; optional install | preserved |
| `README.md` | generated | preserved |
| Git initialization | optional | never |
| Agentic configuration | generated | added or safely merged |
| Existing custom instructions | normally absent | preserved, proposed, or managed-block merged |
| Existing skills | normally absent | inventoried and collision-checked |
| Default architecture | selected starter style | preserve current structure; record preferred direction separately |

Do not use `create --force` as the normal retrofit path.

## 2. Create a new project

```bash
npx workspace-template create inventory-api \
  --project typescript \
  --style functional-core \
  --tdd pragmatic \
  --agents codex,opencode \
  --pm npm \
  --yes
```

Offline generation:

```bash
npx workspace-template create inventory-api \
  --project typescript \
  --no-install \
  --no-git \
  --yes
```

### Project choices

- `typescript`
- `javascript`
- `react`
- `rust`
- `flutter`

### Style choices

- `simple`: cohesive modules and the fewest useful boundaries.
- `functional-core`: pure business policy surrounded by an imperative shell.
- `clean`: application-owned use cases and ports around real volatile boundaries.

The generator does not create empty ceremonial layers merely because `clean` was selected.

### TDD choices

- `strict`: production behavior starts from an observed failing test except explicitly approved generated/configuration work.
- `pragmatic`: test-first for domain behavior and defects; a bounded disposable spike is allowed when required.
- `off`: no test-first mandate, but regression protection and verification remain required.

All profiles favor one vertical behavior at a time, tests through public seams, independent expected values, minimal mocks, and refactoring only while green.

## 3. Inspect and adopt an existing repository

### Read-only inspection

```bash
npx workspace-template inspect . --workspace auto
npx workspace-template inspect . --workspace all --json
```

Inspection records repository identity, Git state, supported stacks, package-manager/lockfile ownership, commands, existing instructions/skills, ticket tracks, and workspace modules. It does not mutate the repository.

### Plan adoption

```bash
npx workspace-template adopt . \
  --dry-run \
  --json \
  --plan-out ../my-repo-adoption-plan.json
```

The persisted plan contains normalized operations, hashes/fingerprints, warnings, conflicts, verification, and approvals. Dry-run and apply use the same plan; apply does not silently replan.

### Apply the reviewed plan

```bash
npx workspace-template adopt . \
  --apply-plan ../my-repo-adoption-plan.json
```

A changed Git HEAD, changed fingerprinted file, changed custom instruction, new skill collision, or other material precondition invalidates the plan before mutation.

### Adoption defaults

| Option | Default | Meaning |
|---|---|---|
| `--project` | `auto` | infer from repository evidence |
| `--style` | `preserve` | do not claim the repository already follows a new architecture |
| `--tdd` | `preserve` | follow existing explicit policy; protect changed behavior pragmatically when no policy exists |
| `--pm` | `auto` | infer lockfile/package-manager owner |
| `--agents` | `codex,opencode` | install the default local harness role split |
| `--conflict` | `propose` | preserve custom text and write a reviewable proposal |
| dirty Git tree | refused | use `--allow-dirty` only for a known, fingerprinted state |
| project verification | off | use `--verify` explicitly |

`--yes` accepts safe defaults. It does not authorize overwriting unmanaged content, network access, lifecycle scripts, runtime dependencies, semantic scope expansion, commits, pushes, publishing, or deployment.

### Instruction conflict modes

```bash
# Preserve custom AGENTS.md and write .agentic/proposals/AGENTS.md
npx workspace-template adopt . --conflict propose

# Append or update only a delimited generated block
npx workspace-template adopt . --conflict managed-block

# Stop when custom integration is needed
npx workspace-template adopt . --conflict fail
```

Broken or duplicate managed markers always block.

### Current ticket migration

When an existing track has a known active ticket:

```bash
npx workspace-template adopt . \
  --current-ticket 031 \
  --current-status in_progress
```

Use `--trust-current-dependencies` only when the live checkout/evidence proves the active ticket’s transitive dependencies already passed. Otherwise the generated frontier remains conservative.

## 4. Use Wayfinder and the local Frontier

The standard local flow is:

```text
Wayfinder map
  → compiled ticket contracts
  → ready frontier
  → read-only preflight
  → implementation
  → independent review axes
  → targeted repair
  → serial integration
  → next frontier
```

### Repository planning prompt

```text
Use the repository Wayfinder skill for this goal.
Write the durable planning map under docs/agent/wayfinding/<effort>/.
Keep source-backed facts, user decisions, inferences, unresolved decisions,
authority gates, evidence, and fog distinct. Do not compile tickets until
route-changing decisions are resolved.
```

Then:

```text
Use Compile Master Plan on the approved Wayfinder map. Produce vertical local
tickets with dependencies, conflict keys, risk lanes, expected write sets,
verification levels, review axes, architecture budgets, and stop conditions.
```

Then:

```text
Use Execute Frontier. Continue from local files in this coordinator session.
Parallelize read-only investigation and independent review; keep one writer by
default and land accepted work serially. Continue until completion or a real
human/contradiction/safety gate.
```

Frontier does not require an issue tracker. A repository may mirror contracts into issues later, but local files remain sufficient.

### ChatGPT planning edition

Upload `chatgpt-skills/wayfinder-planner/SKILL.md` through ChatGPT’s Skills interface. That single file contains the visible conversation ledger, planning procedure, master-plan compiler, ticket/validation templates, retrofit behavior, and execution handoff. It intentionally does not depend on repository companion files.

## 5. Configure Codex and OpenCode

Generated defaults:

```text
Coordinator/planner: GPT-5.6 Sol, high
All other roles:     GPT-5.3-Codex, high
Maximum subagents:   3
```

### Codex

Generated `.codex/config.toml` contains the primary model and default subagent model. Role files under `.codex/agents/` define narrow planner, scout, implementer, reviewer, repairer, and integrator responsibilities.

Planners/scouts/reviewers use read-only sandboxes. Implementer, repairer, and integrator roles receive workspace write access. `Stop` and `SubagentStop` hooks run the process-lease guard before a role may finish.

Start conservatively:

```text
1 coordinator
1 write-capable worker
up to 2 read-only agents
serial landing
```

Enable a second writer only after the ticket contracts prove disjoint write sets and conflict keys, neither ticket is authority-critical, and both use isolated checkpoints/worktrees.

### OpenCode

`opencode.json` and `.opencode/prompts/frontier-loop/` define the equivalent role split. The orchestrator may invoke approved roles; write workers may not recursively create more writers. Replace provider-specific model identifiers only if your provider exposes different names.

## 6. Sync and diagnose skills

Edit the canonical source only:

```text
.agentic/skills/<skill>/...
```

Project changes into configured harnesses:

```bash
npx workspace-template sync .
```

Diagnose structure, ownership, locks, projections, plans, workspace state, and process policy:

```bash
npx workspace-template doctor .
npx workspace-template doctor . --json
```

Custom `CLAUDE.md`, `GEMINI.md`, projected skills, and Cursor rules are preserved unless generator ownership is proven. Unmanaged same-name collisions block synchronization.

## 7. Verify a workspace

```bash
# Root aggregate gate
npx workspace-template verify . --scope root

# One or more modules
npx workspace-template verify . --scope module --module web --module core

# All modules
npx workspace-template verify . --scope all --concurrency 3

# Changed modules plus configured dependents
npx workspace-template verify . \
  --scope affected \
  --affected-from origin/main \
  --concurrency 3
```

Workspace discovery understands npm-family workspaces, Cargo members/path dependencies, Flutter/Dart packages, and supported polyglot roots. Unknown members are retained as opaque nodes. Overlapping roots, dependency cycles, duplicate IDs, and ambiguous lockfile ownership block until explicitly resolved.

Verification results are dependency-aware and deterministic:

- `passed`: fresh command evidence succeeded;
- `failed`: a command ran and returned nonzero;
- `blocked`: a required dependency/root gate failed;
- `skipped`: no applicable command or excluded by policy;
- `unknown`: the executable/evidence was unavailable.

No setup/install command is inferred during verification.

## 8. Plan and install tooling explicitly

Planning performs no install:

```bash
npx workspace-template tooling plan . \
  --module web \
  --pack quality \
  --plan-out .agentic/plans/tooling-web.json
```

Explicit local or registry dependency:

```bash
npx workspace-template tooling plan . \
  --module web \
  --dependency vitest@4.1.10 \
  --kind development \
  --plan-out .agentic/plans/vitest.json
```

Apply the exact plan:

```bash
npx workspace-template tooling install . \
  --apply-plan .agentic/plans/vitest.json \
  --allow-network \
  --lifecycle-scripts deny
```

Authority flags:

- `--allow-network`: required when the reviewed command needs network access.
- `--allow-runtime`: required for runtime dependencies.
- `--lifecycle-scripts allow`: required when package lifecycle scripts are authorized.
- `--scripts preserve|propose|managed-block|fail`: controls structured script/config integration.
- `--lockfile update|preserve`: lockfiles are changed only by native package managers.

The package-manager command is stored as executable plus argv/cwd, not a shell string. Apply snapshots the reviewed mutation boundary, validates manifest/lockfile results, rejects unplanned paths, restores promised tracked files on failure, and reports caches or untracked residue it cannot safely guarantee away.

Supported adapters are npm, pnpm, Yarn, Bun, Cargo, and Flutter/Dart.

## 9. Update project-owned skills

Check the installed project against the incoming catalog:

```bash
npx workspace-template skills update . --check
```

Plan selected updates:

```bash
npx workspace-template skills update . \
  --skill tdd \
  --skill execute-frontier \
  --plan-out .agentic/plans/skills-update.json
```

Apply:

```bash
npx workspace-template skills update . \
  --apply-plan .agentic/plans/skills-update.json
```

Each managed skill has:

```text
baseline: exact upstream snapshot from last successful install/update
local:    current .agentic/skills/<name>
incoming: selected package/catalog snapshot
```

Rules:

- unchanged local + changed incoming → incoming applies;
- changed local + unchanged incoming → local is preserved;
- non-overlapping textual edits → deterministic three-way merge;
- overlapping edits/deletions/executable changes → explicit conflict/risk review;
- changed tools, scripts, invocation behavior, or permissions require `--allow-risky-tool-changes`;
- removals require `--allow-skill-removal`;
- default selected-set apply is atomic;
- `--partial` allows only independently conflict-free skills to advance and reports the rest.

Canonical skills, baselines, lock, and selected projections are staged and validated together.

## 10. Restructure source paths without semantic change

Create a reviewed mechanical move plan:

```bash
npx workspace-template restructure plan . \
  --module web \
  --move 'src/old/policy.ts=>src/domain/policy.ts' \
  --checkpoint worktree \
  --plan-out .agentic/plans/restructure-policy.json
```

Apply:

```bash
npx workspace-template restructure apply . \
  --apply-plan .agentic/plans/restructure-policy.json
```

Allowed operations are file moves and the static reference/config rewrites required by those moves. Business logic, dependencies, abstraction design, public behavior, and package ownership are outside this command.

The built-in adapters handle a conservative set of location-aware constructs:

- JavaScript/TypeScript/React: literal ESM imports/exports, literal dynamic imports, CommonJS `require`, supported aliases/entrypoint/config references.
- Rust: file/module paths, supported `use`/module declarations, target paths, and integration-test relationships.
- Dart/Flutter: `package:`/relative imports and supported `export`/`part` relationships.

Computed imports, macros, generated files, custom loaders, build-script references, ambiguous aliases, and cross-package ownership changes fail closed or require manual work. The command does not claim a full compiler frontend.

`worktree` prefers a detached Git checkpoint and falls back to a staged copy when a clean root worktree is unavailable. `copy` forces a staged copy. `patch` uses a staged copy and leaves patch emission to the operation report.

## 11. Align one architecture slice

Assess and plan one observable use case:

```bash
npx workspace-template align plan . \
  --module orders \
  --use-case src/orders/process-order.ts \
  --style functional-core \
  --characterization required \
  --max-files 8 \
  --max-diff-lines 400 \
  --plan-out .agentic/plans/process-order-align.json
```

### Manual executor

```bash
npx workspace-template align execute . \
  --apply-plan .agentic/plans/process-order-align.json \
  --executor manual
```

The command writes one task request and an expected structured result path under `.agentic/migrations/<plan-id>/`. Complete only that task, write the result, then:

```bash
npx workspace-template align resume . \
  --apply-plan .agentic/plans/process-order-align.json
```

Resume independently computes the filesystem diff, compares it to the claimed `changedPaths`, checks allowed paths and budgets, runs required commands, and advances only one task. After all tasks pass, it performs final guards and stops. It does not commit or start another slice.

### Command executor

```bash
npx workspace-template align execute . \
  --apply-plan .agentic/plans/process-order-align.json \
  --executor command:my-agent-wrapper
```

The wrapper receives a task request file and must write the required structured result. The orchestrator does not trust the result alone: it checks the actual checkpoint diff and runs verification itself.

### Alignment principles

- one public use case per plan;
- characterization/regression coverage before semantic movement unless explicitly waived with a reason;
- pure business decisions where practical;
- explicit clock/random/environment/current-user inputs at the core boundary;
- database/API/filesystem/queue/platform effects at adapters/application shell;
- transactions around the complete application use case;
- a port only for a real volatile boundary or useful seam;
- no universal repository/service/interface ceremony;
- no automatic commit, push, publish, deploy, or next-slice continuation.

Built-in review records are deterministic scope/verification guards. Human or independent model judgment remains a separate bounded reviewer task when required.

## 12. Retrofit durable docs and legacy tickets

After adoption, the repository can use the installed skills or the standalone scripts.

### Durable docs shape

```bash
python .agentic/scripts/retrofit_docs.py docs
python .agentic/scripts/retrofit_docs.py docs --apply
```

Adds, without moving source documentation:

```text
docs/agent/
  PROJECT_MAP.md
  DOMAIN_GLOSSARY.md
  AUTHORITY_MAP.md
  TEST_TOPOLOGY.md
  PROCESS_POLICY.md
  FAILURE_CATALOG.md
  CURRENT_FRONTIER.json
  architecture-baseline.json
  SOURCE_INDEX.md
  decisions/
  evidence/
  migrations/
  wayfinding/
```

Inferred material is labeled for review instead of being silently promoted to fact.

### Ticket track

```bash
python .agentic/scripts/retrofit_tickets.py docs/tickets/<track>
python .agentic/scripts/retrofit_tickets.py docs/tickets/<track> --apply
python .agentic/scripts/validate_ticket_pack.py docs/tickets/<track>
```

The migration preserves original prompts/validations and adds contracts, track metadata, local frontier data, Wayfinder recovery artifacts, evidence directories, risk lanes, conflict keys, verification policy, and architecture budgets. The Python tools use the bundled dependency-free mini-YAML implementation; PyYAML is not required.

## 13. Process lifecycle and test topology

Use the managed command wrapper for test servers, browser drivers, native tools, MCP helpers, and long-running child processes:

```bash
python .agentic/scripts/managed_command.py \
  --run-id ticket-031 \
  --timeout 900 \
  -- \
  npm test
```

Every command records ownership and bounded evidence. Completion gates can reject open leases or surviving descendants. Never replace ownership-aware cleanup with blanket commands such as killing all Node or Python processes.

Architecture budgets are checked as ratchets. Existing megafiles can be grandfathered but locked against growth; new work must use behavior-oriented modules or a dedicated decomposition task.

## 14. Recovery and limitations

- A stale persisted plan is invalid; create a new plan instead of editing fingerprints by hand.
- Tooling rollback guarantees only the reviewed tracked files and recorded mutations. Package caches, downloaded archives, or other external side effects are reported, not falsely claimed absent.
- A failed restructure restores reviewed target paths and rejects unplanned target mutations; retained checkpoint/report evidence can be inspected.
- Automated alignment restores the applied semantic target diff when final target verification fails. Manual alignment intentionally leaves the current bounded worktree changes available for repair.
- Structural scanners are conservative and can produce manual blockers. They are not a substitute for the language compiler/analyzer and fresh project tests.
- Reports bound command output, but arbitrary subprocess output cannot be guaranteed secret-free. Keep credentials out of prompts and use least-privilege environments.
- Rust and Flutter/Dart verification is only as strong as the toolchains present in the execution environment.

## 15. Local package development

```bash
npm run lint
npm test
npm run check
npm run pack:check
npm pack
npm run test:packed -- ./workspace-template-0.6.0.tgz
npm publish --dry-run --ignore-scripts
```
