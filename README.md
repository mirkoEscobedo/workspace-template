# workspace-template 0.9.0-alpha.0

workspace-template is a registry-free, Windows x64 Rust CLI for Adaptive Delivery. Its direct package identity is `workspace-template-win32-x64` while the executable command remains `workspace-template`. This source tree is preparing the first public alpha; it is not signed or published.

The package owns methodology, inspection, verification, and sealed thin-state migration. npm/pnpm own dependency installation and lockfiles. Codex, OpenCode, and repository owners choose enabled models, agents, permissions, skills, and capabilities—workspace-template has no model presets or generated host-agent definitions.

## Commands

```text
workspace-template help
workspace-template instructions
workspace-template route [routing flags]
workspace-template inspect [root]
workspace-template doctor [root]
workspace-template verify [root] [--scope root|module|affected|all] ...
workspace-template debug providers [root]
workspace-template debug run --spec <session.json>
workspace-template adopt plan|apply [root] ...
workspace-template upgrade plan|apply [root] ...
workspace-template skills list
workspace-template skills show <name>
workspace-template skills update
workspace-template update status [root]
workspace-template version
```

Every command emits one stable JSON envelope. `--json` explicitly selects the default JSON format and is retained for compatibility. Unknown options, invalid values, and extra positionals fail with a documented usage exit.

Routing is Direct by default, Ticketed for multiple vertical slices or multi-session work, and Governed only for enumerated high-consequence authority. An outcome gets at most two semantic repair rounds and one explicitly classified flaky rerun.

Inspection emits a versioned graph for npm/pnpm, Cargo/Rust, Dart, Flutter, and polyglot workspaces. It reports internal dependencies, repository-owned commands, Git state, a canonical fingerprint, and conservative conflicts; Yarn/Bun members are observable but never executed. Thin-state overrides may add/exclude modules, provide explicit edges, and supply structured commands without shell strings.

Verification remains root-scoped by default. Module, affected, and all scopes validate the graph, include transitive dependents, run dependencies before dependents, block only failed branches, and use the qualified native supervisor with bounded output and timeouts. Unknown ownership selects every module and missing commands return `INSUFFICIENT_EVIDENCE`. Windows children start suspended inside a kill-on-close Job Object so timeout, cancellation, root exit, and detached descendants converge to zero owned processes.

`debug providers` performs read-only discovery of host-owned CDB/GDB/LLDB, Node, Dart, and Flutter providers. `debug run` validates the bounded v1 session contract, loopback-only endpoints, detach-on-attach policy, and prohibited actions. Protocol adapters are not yet qualified, so valid sessions currently stop with `INSUFFICIENT_EVIDENCE`; no debugger or SDK is bundled.

Adoption and upgrade use content-hashed sealed plans, repository fingerprints, stale-state rejection, safe relative paths, transaction staging, backup, rollback, and interrupted-run recovery. They write schema-v2 thin state and managed instruction/ignore blocks; they never modify package manifests or run package managers.

`create` is permanently rejected. Use an ecosystem initializer such as `cargo new` or `flutter create`, then run sealed `adopt plan/apply`. Adoption also accepts an existing empty directory and creates only managed `AGENTS.md`, `.agentic/project.json`, and `.gitignore`.

`skills list/show` reads the exact embedded 13-skill inventory. Generic skills are never copied into consumers. `skills update` directs users to update the exact dependency with npm/pnpm and then run sealed upgrade. `update status` compares manifest, lock resolution/integrity, installed package, running binary, and project state without mutation.

## Development

```powershell
npm run check
npm run pack:check
```

The retained PowerShell harnesses build reproducible Windows artifacts and qualify packed npm/pnpm consumers. Release materialization produces `bin/workspace-template.exe` and `workspace-template.provenance.json`; neither accepted 0.8 output is kept in the active 0.9 source tree.

See [Adaptive Delivery](docs/guides/adaptive-delivery.md), [native architecture](docs/architecture/native-cli.md), and [pre-publication authority](docs/release-readiness/0.9.0-alpha.0.md).

## Publication gate

Authenticode signing with RFC 3161 timestamping is mandatory before publication. Package namespace/ownership, maintainers, recovery owners, signing custody, tags, releases, registry writes, and dist-tags require separate human authority.
