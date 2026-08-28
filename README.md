# workspace-template 0.8

workspace-template 0.8 is a Windows x64 native CLI and dependency-owned skill package for Adaptive Delivery. Ordinary work defaults to Direct delivery; durable process artifacts appear only when multi-session or high-consequence work actually requires them.

## Distribution

Consumers pin an exact Git release commit:

```json
{
  "devDependencies": {
    "workspace-template": "github:mirkoEscobedo/workspace-template#<40-character-release-sha>"
  }
}
```

Before that release commit is pushed, qualification uses a locally packed `.tgz`. The package contains a tracked `bin/workspace-template.exe` plus `workspace-template.provenance.json`. It has no downloader, postinstall build, or lifecycle script.

Node repositories keep the dependency in their root manifest. Flutter and Rust repositories use `.agentic/tooling/package.json` and its dedicated lockfile. Repositories retain only thin product state: `.agentic/project.json`, policy/overrides, history pointers, resumption truth, and a compact managed block in `AGENTS.md`. Canonical generic skills and schemas remain inside the dependency.

## Native commands

```powershell
npm exec -- workspace-template instructions --json
npm exec -- workspace-template route --json
npm exec -- workspace-template inspect . --json
npm exec -- workspace-template doctor . --json
npm exec -- workspace-template verify . --json
npm exec -- workspace-template adopt plan . --plan-out .agentic/plans/adopt.json --json
npm exec -- workspace-template adopt apply . --apply-plan .agentic/plans/adopt.json --json
npm exec -- workspace-template upgrade plan . --plan-out .agentic/plans/upgrade.json --json
npm exec -- workspace-template upgrade apply . --apply-plan .agentic/plans/upgrade.json --json
npm exec -- workspace-template skills update plan . --plan-out .agentic/plans/skills.json --json
```

Use `pnpm exec workspace-template` for pnpm projects and `npm exec --prefix .agentic/tooling -- workspace-template` for non-JavaScript projects.

`create`, `tooling`, `preset`, `restructure`, and `align` return `UNSUPPORTED_IN_NATIVE_0_8`; they do not fall back to Node.

## Delivery modes

- Direct: ordinary features, fixes, refactors, and bounded investigations. No durable process artifacts.
- Ticketed: several independently valuable slices or multi-session work. One compact plan and one current ticket.
- Governed: credentials/security, financial authority, irreversible/destructive work, native process ownership, or external execution. Adds a frozen acceptance contract, state record, independent review, and authority receipts.

Verification and review allow at most two semantic repair rounds. A repeated unchanged failure replans immediately. Review is independent and read-only, and returns `PASS`, `FAIL`, or `INSUFFICIENT_EVIDENCE` with one permitted next transition. Failed checks never generate successor tickets, validator programs, or repair-evidence trees.

## Terminal-native debugging

`runtime-debug` is a semantic capability, not an IDE requirement. This Windows slice qualifies Microsoft CDB for Rust/native launch, attach, symbols, breakpoints, stepping, threads, stacks, bounded variable inspection, controlled detach, and cleanup. JavaScript investigations use the Node Inspector protocol through a terminal adapter. Computer use is reserved for actual GUI acceptance without a structured interface; it is never used to drive VS Code.

If deterministic evidence is insufficient and no qualified provider is available, the correct result is `INSUFFICIENT_EVIDENCE` with an alternate check or explicit manual obligation.

See [Adaptive Delivery](docs/guides/adaptive-delivery.md) for the state machine and evidence policy.

## Development and release gates

```powershell
npm run check
npm run pack:check
npm run test:packed
```

The release executable is built twice from a clean source-only commit with remapped paths and deterministic linker settings. The outputs must be byte-identical. The committed provenance records the source commit, toolchain, target, embedded-asset manifest, executable SHA-256, and reproducibility result. Publication, tagging, pushing, and merging are separate authorized actions.
