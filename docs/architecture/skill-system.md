# Adaptive skill-system architecture

## Authority layers

`AGENTS.md` contains stable repository context, real commands, authority
boundaries, mode-selection rules, stopping limits, security rules, and the
definition of done. `.agentic/config.json` is the public machine-readable policy
and `.agentic/profile.json` records the detected/project-selected profile.

Repository skills under `.agentic/skills/` own methodology behavior. Harness
projections under `.agents/`, `.codex/`, and `.opencode/` are derived adapters;
they do not become methodology authorities. Upgrades three-way merge editable
skills against recorded baselines and preserve local divergence.

## Decision-oriented surface

| Skill | Responsibility |
|---|---|
| `delivery-loop` | Sole normal entry point; select Direct, Ticketed, or Governed and define minimum evidence. |
| `execute-delivery` | Coordinate the bounded execution state machine and enforce transition budgets. |
| `review-change` | Independent static-to-inspection review; emit verdict and permitted transition only. |
| `repair-change` | Repair one diagnosed cause with hypothesis novelty and a two-round maximum. |
| `diagnose` | Classify failure, choose inspection, state a falsifiable hypothesis, or select an alternate route. |
| `compile-master-plan` | For Ticketed/Governed only, produce tracer-bullet outcomes and one current ticket. |
| `wayfinder` | Apply the admission test and, when admitted, write one material decision memo. |
| `verify`, `tdd` | Supporting deterministic verification and test-first implementation. |
| `implementation-style`, `test-topology` | Supporting architecture and test-boundary guidance. |
| `process-lifecycle`, `integrate-wave` | Optional specialists, admitted only by process or multi-branch evidence. |

`frontier-loop`, `execute-frontier`, `ticket-review`, and `repair-ticket` are
one-release compatibility shims. `ticket-implementer` and
`retrofit-ticket-pack` recover legacy callers without granting a historical
graph execution authority.

## State and evidence

The portable state machine is implemented in `src/delivery.js` and documented
in `delivery-loop/references/state-machine.md`. Public policy is shipped in
`delivery-loop/assets/delivery-policy.yaml`. Reviewer records conform to
`review-change/assets/review-report.schema.json` and identify evidence level,
inspection capability, verdict, unresolved items, and permitted transition.

The methodology refers to `runtime-debug` and `interactive-gui`. Host adapters
may map those names to a debugger, computer-use provider, emulator driver, or
another equivalent capability. Provider names are not embedded in portable
policy.

## Convergence invariants

- No more than two semantic repair rounds per outcome.
- One unchanged rerun only when the gate is explicitly classified as flaky.
- Repeated failure without new causal evidence goes directly to replanning.
- Infrastructure failure is not an implementation defect.
- Review cannot modify source or expand scope.
- Failed checks cannot create executable validators, successor tickets,
  decision files, or repair evidence trees.
- Replanning selects alternate implementation, reduced scope, defer, or abort.

These invariants are enforced by source tests and skill trigger/output evals;
they are not delegated to generated project scripts.
