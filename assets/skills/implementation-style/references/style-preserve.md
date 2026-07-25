# Preserve coherent existing structure

Use this branch for adopted repositories whose current architecture is mixed, undocumented, or intentionally unchanged.

- Inspect nearby code, tests, ADRs, and repository instructions before choosing structure.
- Preserve a coherent local design; do not claim the whole repository follows a style it has not adopted.
- Do not spread a known local anti-pattern merely for consistency.
- For new or touched behavior, keep effects visible, dependencies explicit, policy testable, and abstractions justified.
- Choose the smallest suitable structure for the current vertical slice.
- Record an explicit decision before starting a deliberate architecture migration.
- Characterize legacy behavior before changing it when no reliable regression seam exists.
