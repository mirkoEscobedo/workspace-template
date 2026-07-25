# Implementation profile

Machine-readable policy: `.agentic/profile.json`.

- Mode: `adopted`
- Stack: `javascript`
- Style: `preserve`
- TDD mode: `preserve`
- Execution: Frontier Loop
- Active agent preset: `sol-codex` (active)
- Coordinator: `gpt-5.6-sol`, high
- Implementer: `gpt-5.3-codex`, high

## Decision rule

Use the smallest design that makes effects visible and behavior testable. In adopted repositories, preserve coherent existing structure and migrate only through explicitly approved, protected vertical slices. A selected future style is a direction for new or touched work, not a claim about the current codebase.
