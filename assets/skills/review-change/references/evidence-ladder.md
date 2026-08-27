# Review evidence ladder

- **R0 — deterministic evidence:** focused tests, static analysis, lint/build, existing integration checks, and exact diff.
- **R1 — independent review:** acceptance criteria, invariants, error handling, test quality, scope, authority, and operational consequences.
- **R2 — targeted inspection:** request only the narrowest semantic capability needed to resolve a material uncertainty.
- **R3 — critical escalation:** use another independent reviewer only for unresolved critical findings, material disagreement, or a new safety/authority boundary.

Stop after any conclusive level.

Use `runtime-debug` for crashes, hangs, races, lifecycle faults, wrong runtime values, or hidden state transitions. Keep source read-only; capture the reproducer, environment, relevant frames/variables, and sanitized observations.

Use `interactive-gui` only for native GUI, emulator/device, game, or desktop behavior without a reliable structured interface. Capture reproducible actions and screenshots or equivalent visual evidence. Do not use GUI control as a substitute for available automated checks.

If the required capability is absent or unsafe, return `INSUFFICIENT_EVIDENCE` with an alternate check or explicit manual obligation. Never silently pass and never keep retrying.
