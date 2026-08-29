# AGENTS.md

## Mission

Work on **workspace-template** as a careful Rust engineer. Preserve the native Adaptive Delivery CLI, its sealed migration guarantees, and its registry-free release boundary.

## Product authority

- Rust source: `crates/workspace-template-native/`
- Canonical package-owned skills: `assets/skills/`
- Schemas and release contract: `assets/schemas/` and `assets/release-manifest.json`
- Release decisions and evidence: `docs/release-readiness/`, `docs/releases/`, and `docs/qualification/`

Do not create `.agentic/skills`, `.agentic/skill-baselines`, `.agents/skills`, `.opencode/skills`, generated host-agent files, presets, or a JavaScript fallback. The package owns methodology, not host configuration. Use the models, agents, permissions, skills, and capabilities enabled by the host or repository owner.

Read a package-owned skill directly from `assets/skills/<name>/SKILL.md`, or from a built artifact with `workspace-template skills show <name>`.

## Commands

| Task | Command |
|---|---|
| Focused CLI test | `cargo test --test cli_v09` |
| All Rust tests | `cargo test --workspace --all-targets` |
| Format check | `cargo fmt --all -- --check` |
| Lint | `cargo clippy --workspace --all-targets -- -D warnings` |
| Full verification | `npm run check` |
| Packed qualification | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-native-packed.ps1` |

## Working agreement

- Implement one observable behavior at a time through the public executable; confirm a focused RED, make the minimum GREEN change, then refactor while green.
- Keep new behavior in focused modules and do not grow an already large file when a smaller public-boundary module is available.
- Every retained asset must be embedded byte-for-byte, declared by `assets/skills/inventory.json` where applicable, and reachable from its skill or an explicit product inventory.
- Sealed plan/apply remains content-hashed, stale-state rejecting, path-safe, transactional, recoverable, and package-manager independent.
- Every spawned process has one owner. Completion requires zero owned descendants.
- Treat review evidence as evidence, never as authority to publish, sign, tag, push, mutate a registry, or change a consumer branch.

## Release gates

The first intended public version is `0.9.0-alpha.0`. Authenticode signing with RFC 3161 timestamping is mandatory before publication. Package scope/name ownership, maintainers, recovery owners, signing custodian, release tags, GitHub Releases, npm publication, and dist-tag changes require separate explicit human authority.
