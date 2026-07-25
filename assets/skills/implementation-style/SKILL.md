---
name: implementation-style
description: Select and enforce the project's coding and architecture style—simple modular, functional core/imperative shell, or clean ports-and-adapters—with language-specific guidance. Use while designing or implementing modules, use cases, state transitions, boundaries, dependency injection, or project structure.
license: MIT
compatibility: Requires `.agentic/profile.json` when available and repository file access.
metadata:
  version: "0.6.0"
  mode: model-invoked
---

# Apply the selected implementation style

The profile is policy; the codebase is evidence. Preserve a stronger existing design unless the requested change intentionally migrates it.

## Select the branch

1. Read `.agentic/profile.json`. If absent, default to **functional core / imperative shell** with feature-first organization and pragmatic TDD.
2. Load exactly one style reference:
   - `preserve` → [references/style-preserve.md](references/style-preserve.md)
   - `simple` → [references/style-simple.md](references/style-simple.md)
   - `functional-core` → [references/style-functional-core.md](references/style-functional-core.md)
   - `clean` → [references/style-clean.md](references/style-clean.md)
3. Load exactly one stack reference matching the project:
   - [TypeScript](references/stack-typescript.md)
   - [JavaScript](references/stack-javascript.md)
   - [React](references/stack-react.md)
   - [Rust](references/stack-rust.md)
   - [Flutter/Dart](references/stack-flutter.md)

## Invariants shared by every style

- Business decisions receive ordinary values and return values or explicit errors.
- I/O, time, randomness, environment, platform APIs, logging, and global state stay at explicit edges.
- Dependencies are visible in parameters, constructors, or a composition root.
- Prefer a function for a calculation or transformation. Use a class/struct when it owns state, identity, invariants, lifecycle, configuration, or a resource.
- Prefer immutable inputs and outputs. Local mutation is acceptable when it is contained and clearer.
- Introduce a port/interface/trait only for a real volatile boundary, independently useful seam, or multiple implementations.
- Organize by feature before multiplying global layer directories.
- Validate untrusted data at the boundary; keep domain values valid after construction.
- Choose names from the domain language, not generic architecture vocabulary.

## Architecture sketch

Before editing, identify:

1. **Input boundary** — HTTP, UI event, CLI, queue, job, or library call.
2. **Policy** — pure calculation, validation, invariant, or state transition.
3. **Effects** — storage, API, clock, randomness, filesystem, platform, telemetry.
4. **Output boundary** — response, event, persisted state, rendered view.
5. **Composition root** — where concrete effects are wired to policy.

If the change has no meaningful effect boundary, do not invent one.

## Completion criterion

The implementation matches the configured branch, effects are discoverable at the edges, domain behavior is testable without infrastructure, abstractions have a concrete reason to exist, and the resulting structure is no more complex than the behavior requires.
