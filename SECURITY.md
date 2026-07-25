# Security policy

## Supported version

Version `0.6.x` is the supported development line represented by this release artifact.

## Security model

`workspace-template` is a local repository mutation tool. It can create files, copy project-owned skills into agent-visible directories, run explicitly reviewed local commands, invoke native package managers, and optionally invoke a configured local coding-agent wrapper for one bounded alignment task. Treat it with the same care as a code generator, dependency manager, and local build tool.

The core rule is:

> Every higher-risk capability has its own inspect → plan → approve → apply → verify contract. Authority granted to one command does not transfer to another.

### Command authority boundaries

| Command | Authorized mutation | Explicitly outside its authority |
|---|---|---|
| `create` | a new or intentionally overlaid starter workspace | remote Git operations, deployment |
| `adopt` / `retrofit` | agentic metadata, approved instruction blocks/proposals, canonical skills, conflict-free projections, durable docs/ticket metadata | application source/tests, dependency manifests/lockfiles, CI/deployment files, package installation |
| `tooling install` | reviewed manifests, native lockfiles, approved scripts/config, selected dependency transaction | unrelated dependencies/config/source; hidden network or lifecycle execution |
| `skills update` | selected canonical skills, project-owned baselines, lock, approved projections | unrelated local skills; silent loss of local edits; unreviewed executable/permission expansion |
| `restructure apply` | reviewed file moves and static reference/config rewrites caused by those moves | business behavior, new dependencies, architecture invention, package/crate ownership changes |
| `align execute` / `resume` | one reviewed semantic slice inside allowed paths and budgets | broader modules/use cases, unapproved nested tooling/restructure work, commit/push/publish/deploy, another automatic slice |
| `verify` / `doctor` | report artifacts only | setup/install or source mutation |

## Primary risks and controls

### Untrusted repository content and skills

Repository instructions, skills, scripts, MCP servers, agent prompts, and imported catalogs can contain prompt injection or executable behavior.

- Review skills as code-like dependencies.
- Preserve exact project-owned baselines and inspect three-way update/risk reports.
- Require explicit approval for new or broader scripts, shell/network instructions, tools, or permissions.
- Keep write-capable agents narrowly scoped. Planners and reviewers are read-only by default.
- Do not place secrets in `AGENTS.md`, skills, task requests, fixtures, reports, or migration evidence.

### Dependency and package-manager execution

- No package-manager command is run by `adopt`, `doctor`, `verify`, `restructure plan`, or `align plan`.
- `tooling install` executes only the executable, argv, cwd, and policy recorded in an approved immutable plan.
- Network access requires `--allow-network` both in the plan and at apply time.
- Node lifecycle scripts default to denied and require `--lifecycle-scripts allow` when the plan records that authority.
- Runtime dependencies require `--allow-runtime`.
- Lockfiles are changed only by the native package manager; unexpected manifest/lock/config/source mutations fail the transaction.
- Rollback restores the reviewed tracked/config paths where promised. Package caches, downloaded archives, `node_modules`, build output, or external service side effects cannot be universally erased; reports state that limitation.

### Source restructuring and semantic alignment

- Plans are fingerprinted and immutable. Changed files, changed Git identity, changed catalogs, or changed plans invalidate apply.
- Restructuring occurs in a Git worktree when available or a bounded copy checkpoint otherwise.
- Conservative scanners block computed/dynamic references, generated code, unsupported macros/loaders, ambiguous ownership, and cross-module moves rather than guessing.
- Alignment requires one selected public use case, characterization policy, allowed paths, file/diff budgets, and fresh verification.
- Executor claims are not trusted: the orchestrator compares the actual filesystem diff to the structured result and reruns required commands itself.
- Built-in execution never commits, pushes, publishes, deploys, or automatically starts another semantic slice.

### Process and resource leaks

Generated process-lifecycle tools use explicit leases, process groups on POSIX, Windows Job Objects where available, deadlines, termination escalation, bounded output, and zero-owned-descendant completion checks. Do not replace ownership-aware cleanup with blanket process-kill commands.

The tool cannot guarantee cleanup of processes launched outside its ownership wrapper or by an external harness that does not propagate ownership metadata. Run completion hooks and inspect lease reports before declaring long-running work complete.

### Logs and secrets

Command output is bounded and common secret-like values should not be deliberately copied into reports, but arbitrary subprocess output cannot be guaranteed secret-free. Use least-privilege environments and dedicated credentials. Redact reports before sharing outside the trusted project boundary.

### Filesystem and Git safety

- Existing-repository adoption refuses a dirty Git tree unless `--allow-dirty` is explicit.
- Every planned path is normalized and checked for root containment.
- Symlinks that would escape managed roots are blocking.
- Custom instructions and unmanaged skills/projections are preserved, proposed, or treated as conflicts; they are not silently overwritten.
- User-owned files are never deleted by adoption.

## Reporting a vulnerability

Report issues to the repository owner through the private channel used to distribute this package. Include the affected version, command and options, repository state, reproducible steps, expected and actual behavior, and whether secrets, package-manager activity, child processes, or remote side effects were involved. Do not include live credentials or sensitive repository contents.
