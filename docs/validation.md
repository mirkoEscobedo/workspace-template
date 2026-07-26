# Validation record — 0.6.0

**Validation date:** 2026-07-24  
**Package:** `workspace-template@0.6.0`  
**Runtime:** Node.js 22.16.0, npm 10.9.2, Git 2.47.3, Python 3.13.5

## Release result

The 0.6.0 source tree and actual npm tarball passed the release gates described below. The validation deliberately separates deterministic structural/JavaScript evidence from unavailable external toolchains and from any live paid model.

## Source checks

```bash
npm run check
```

Result:

```text
self-check: pass
Node tests: 89 passed, 0 failed
Suites: 19
```

The self-check validates:

- package/internal version consistency;
- published package file declarations;
- 17 repository skills;
- skill frontmatter, names, local links/resources, and eval JSON where present;
- JavaScript syntax across source, binary, scripts, and tests;
- non-scaffold internal JavaScript imports;
- no runtime PyYAML import in standalone Python tooling;
- Python syntax when Python is present;
- Sol-high/Codex-high Codex and OpenCode routing;
- required release docs/scripts;
- absence of superseded draft modules.

The Node suite covers:

- every supported new-project stack and all style combinations;
- conflict-safe projection and drift repair;
- safe adoption planning/apply, custom instruction preservation, managed blocks, dirty-tree and unmanaged-skill gates;
- persisted-plan round trips, integrity and stale-state rejection;
- monorepo adoption and nested instruction scope;
- npm-family/Cargo/Flutter-Dart workspace discovery, internal dependency edges, affected selection, dependency-aware verification, lock ownership, opaque modules, polyglot roots, and conflict cases;
- package-manager adapter command planning, network/runtime/lifecycle authority, structured JSON/YAML/TOML integration, unplanned mutation rejection, and rollback;
- project-owned skill baselines, three-way merges, conflict/risk/removal gates, partial/atomic behavior, and incoming-catalog invalidation;
- worktree/copy checkpoints and file restoration;
- conservative JavaScript/TypeScript, Rust, and Dart reference rewrite planning plus target restoration;
- architecture assessment, bounded slice planning, manual/command executor behavior, actual-diff guards, task-by-task resume, final verification, and restoration;
- dependency-free Python docs/ticket/budget scripts under `python -S`.

## Python tooling

The standalone retrofit and budget scripts were executed through tests with site packages disabled:

```text
python3 -S ...
```

They used the bundled `_mini_yaml.py` fallback. PyYAML is not required. Release packaging excludes `__pycache__` and `.pyc` files.

## Package dry run and contents

```bash
npm pack --dry-run --json
```

Result: **pass**. The dry run produced 230 publishable entries and included the executable, runtime modules, harness configurations, project templates, 17 repository skills, process/retrofit scripts, tooling-pack catalog, Markdown/HTML documentation, and the versioned retrofit plan. Tests, GitHub workflow files, caches, bytecode, and local tarballs are excluded.

## Actual tarball smoke test

The release procedure creates the real `.tgz`, installs it into a new package consumer using:

```bash
npm install --ignore-scripts --no-audit --no-fund --package-lock=false <tarball>
```

and then invokes the installed binary. The packed smoke test passed these gates:

1. package version and required packed payload;
2. TypeScript project creation and `doctor`;
3. GPT-5.6 Sol high / GPT-5.3 Codex high `sol-codex` generated harness configuration;
4. immutable adoption-plan persist/load/apply round trip;
5. existing source and custom `AGENTS.md` byte preservation plus proposal generation;
6. project-owned skill-update check;
7. workspace discovery, internal dependency edge, and dependency-aware verification;
8. an actual native npm tooling transaction using only a local `file:` package, with no network;
9. an actual mechanical TypeScript file move and import rewrite from an immutable restructure plan;
10. a manual architecture-alignment plan/execute/status flow that emits one task and stops without launching a model or mutating application source.

This validates the distributed artifact rather than relying only on imports from the source checkout.

## Publish dry run

```bash
npm publish --dry-run --ignore-scripts
```

Result: **pass**. npm accepted the package for dry-run publication and produced the same package identity and integrity metadata as `npm pack`. No package was actually published.

## Toolchain limitations

The validation environment did not contain `cargo`, `rustc`, `flutter`, or `dart`. Therefore:

- Rust and Flutter/Dart starter trees, profiles, skills, workspace detection, package-manager command planning, and structural adapters were tested structurally in JavaScript;
- Rust source was **not** compiled and Cargo commands were **not** executed against a real toolchain;
- Dart/Flutter source was **not** analyzed/compiled and Flutter/Dart package commands were **not** executed against a real toolchain.

Consumers using those stacks must run the generated project commands in an environment containing the relevant toolchains. A structural scanner result is never represented as a compiler/analyzer/test pass.

## Network and model limitations

- The deterministic release test does not depend on registry downloads beyond installing the already produced local tarball; the tooling transaction uses a local `file:` dependency.
- No live paid model is invoked. Alignment automation is covered with deterministic manual/fake/configured command protocols and independent filesystem/verification guards.
- OpenAI/Codex/OpenCode configuration is validated structurally against the generated role and permission model; provider availability and account entitlements remain environment-specific.

## Honest capability boundary

The JavaScript/TypeScript, Rust, and Dart restructure adapters are conservative location-aware scanners for supported static constructs, not complete compiler frontends. Dynamic imports, generated code, macros, custom loaders, ambiguous aliases, visibility/ownership changes, and other unsupported relationships become conflicts or manual work.

Architecture assessment is source-located heuristic evidence, not an automatic proof of good architecture. Semantic alignment remains one reviewed, test-protected use-case slice at a time and requires executable project evidence for a completion claim.
