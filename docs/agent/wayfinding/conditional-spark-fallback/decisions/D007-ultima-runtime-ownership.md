# D007 — Ultima runtime ownership

## Question

After the development direction changed, which parts of the conditional Spark
fallback remain owned by `workspace-template`, and which parts move to Ultima?

## Context

FBK-001 landed the optional preset schema, resolved routing declaration,
collision-safe generated configuration, truthful state rendering, and atomic
preset materialization. FBK-002 runtime work was started only in the local
worktree and was never staged or committed. FBK-003 through FBK-006 were not
started.

The user explicitly directed on 2026-07-28 that the bypass is no longer needed
in this repository and that runtime orchestration will move to `ultima-ai`.

## Decision

`workspace-template` retains ownership of:

- project creation and adoption;
- the Frontier Loop methodology and project-owned skills;
- declarative preset and runtime requirements;
- validation and architecture budgets;
- truthful generation and atomic materialization of the FBK-001 declaration;
- integration with an external Ultima runtime.

Ultima owns runtime orchestration, including route selection after a native
model refusal, the control plane, broker execution, refusal-circuit state,
agent-process ownership and leases, OpenCode spawning, runtime routing,
activation sequencing, and live orchestration proof.

The generated broker-shaped FBK-001 configuration is retained as part of the
landed declarative contract. Its presence describes an integration requirement;
it does not claim that `workspace-template` implements or operates the runtime.
No local ticket after FBK-001 may implement that runtime without a new explicit
authority decision and a defined Ultima integration seam.

FBK-002 through FBK-006 are superseded. Their historical documents remain
available through Git history, while their current ticket records contain only
the supersession disposition.

## Consequences

- FBK-001 and its tests/evidence remain the completed end of this track.
- The uncommitted FBK-002 implementation and generated runtime residue are
  removed.
- No Node fallback control plane, refusal circuit, runtime broker adapter,
  fallback-runtime agent-process lease implementation, OpenCode spawn adapter,
  or live-model proof remains in this repository.
- `sol-only` remains active. This change does not activate `sol-codex` and does
  not run or configure live models.
- Public documentation must describe the Ultima boundary and must not promise a
  future local FBK-002 runtime.

## Evidence

- Explicit user direction dated 2026-07-28.
- Git base `f86efd3f143b40631d4a278e143949ca7ae28907`.
- Landed FBK-001 commit `86b716a4a56de448b9bd9265dc47c9b3f201539b`.
- Empty index and FBK-002-only worktree inventory captured before cleanup.
