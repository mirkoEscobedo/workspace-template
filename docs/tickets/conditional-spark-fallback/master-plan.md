# Conditional Terra → OpenCode Spark Fallback Master Plan

## Goal

Add a truthful, refusal-only Terra → OpenCode Spark fallback to `sol-codex`
without changing the broker-free `sol-only` product default.

## Goal completion contract

- `sol-only` remains the default at its current preset fingerprint and emits no
  fallback metadata or broker.
- Version-1 presets without fallback metadata remain valid.
- `sol-codex` declares the exact
  `fallbacks.codexChildModelRefusal` contract, keeps coordinator/planner on
  GPT-5.6 Sol/high, routes all seven eligible semantic roles to
  GPT-5.3 Codex Spark/xhigh, and resolves a collision-safe native
  GPT-5.6 Terra/medium transport broker.
- Expanded config, profile, and model-routing state truthfully record broker
  identity/model, eligible roles, delegate target, OpenCode semantic role IDs,
  models, and variants.
- A run chooses its delegated route at the first eligible native attempt.
  Broker mode opens only for `unsupported-model`, `unavailable-model`, or
  `refused-model` before start with no child identity; all other failures stop.
- The run-scoped circuit and verbatim/normalized refusal evidence persist under
  `.agent/runs/<run-id>/routing-state.json` keyed by active preset fingerprint.
- Node 24 owns the primary control plane; Python is a compatibility fallback.
  POSIX process groups and a Windows Job Object/PInvoke argument-array host
  provide bounded whole-tree termination and durable leases.
- Node ticket-pack validation and architecture-budget checking match the
  Python behavior, including invalid YAML, invalid lock rules, and intentional
  baseline capture. FBK-002 runs the package assets against both the
  `workspace-upgrade` and `conditional-spark-fallback` tracks; installed
  `.agentic` copies become authoritative only after FBK-005 materializes them.
- The generated Codex hook source is Node-first with a Python compatibility
  fallback. FBK-002 owns that package source; FBK-005 owns current-repository
  materialization.
- The Terra broker is transport-only and makes one fixed, safe OpenCode
  Spark/xhigh invocation in one fresh session per attempt from a root-contained
  frozen packet.
- Create, adopt, upgrade, preset switching, doctor, and packed distribution
  deliver and validate the behavior offline with fake OpenCode coverage.
- FBK-001 through FBK-005 land under the baseline `sol-only` fingerprint.
  FBK-006 activates `sol-codex`, stops for a human Codex App restart, then
  completes the bounded live implementer/reviewer proof and leaves
  `sol-codex` active.
- Independent specification/authority, code/test, and operations/security
  reviews pass the exact landed diff. Final state has zero owned descendants
  and zero open leases.

## Source and authority

1. Current explicit user approval and locked details.
2. `docs/agent/wayfinding/conditional-spark-fallback/`.
3. Repository `AGENTS.md`, `.agentic/profile.json`, and active policies.
4. Existing repository behavior at clean base
   `fe7e325958ff56eefa3bd97a54fabed58c845de6`.

Contract authority is `contract.yaml`; `ticket.md` is its human-readable
expansion. Any disagreement stops execution until the pack is repaired.

## Locked decisions

- The exact optional preset key is:

  ```json
  {
    "fallbacks": {
      "codexChildModelRefusal": {
        "roles": ["scout", "implementer", "reviewer-spec", "reviewer-code", "reviewer-ops", "repairer", "integrator"],
        "brokerModel": "terra-medium",
        "delegateTarget": "opencode"
      }
    }
  }
  ```

- `terra-medium` resolves to `gpt-5.6-terra`/medium for the native broker. The
  seven semantic delegated roles resolve to
  `gpt-5.3-codex-spark`/xhigh on native Codex and
  `openai/gpt-5.3-codex-spark`/xhigh on OpenCode.
- The generated native broker prefers `opencode_spark_broker`, resolves
  collisions deterministically, and owns transport only.
- The first eligible delegation is the one native route probe. A returned child
  identity irrevocably locks native mode for the run. Only an approved
  pre-start model refusal with no identity opens broker mode. There is no
  second transition.
- The broker keeps the requested semantic role and scheduling slot. Writer
  roles are the sole writer; each reviewer gets a fresh read-only session.
- The OpenCode argv and forbidden flags are fixed by D004. Callers supply only
  semantic role, validated root-contained frozen packet files, identities, and
  deadline.
- Node hooks are primary. Python is optional fallback. Windows uses Job
  kill-on-close with an argument-array PowerShell/PInvoke host; POSIX uses a
  dedicated process group with bounded TERM/KILL.
- One writer, serial landing, independent read-only reviews.
- FBK-006 has a mandatory human restart gate after activation and before any
  live proof.
- FBK-006 freezes the live packet at
  `docs/tickets/conditional-spark-fallback/006-live-dogfood/evidence/live/packet.md`.
  The implementer alone may write `implementer.marker` and
  `implementer-report.json` beside it. The reviewer session is read-only; only
  broker/coordinator capture may write `reviewer-report.json`. The controller
  may write only `.agent/runs/<run-id>/routing-state.json`,
  `.agent/runs/<run-id>/attempts/implementer-1.json`, and
  `.agent/runs/<run-id>/attempts/reviewer-code-1.json`, with `<run-id>`
  validated by safe-component rules.
- FBK-006 uses only the fixed safe-component agent IDs
  `native-spark-implementer`, `opencode-spark-implementer`, and
  `opencode-spark-reviewer-code`. Their transient leases are exactly
  `.agent/leases/<run-id>--FBK-006--<agent-id>.json`; their retained evidence
  uses the same names ending `.final.json`. The three transient files must be
  removed at completion. The three `.final.json` files must record final
  outcome and remaining descendants. No other FBK-006 lease path is allowed.

## Out of scope

- Any fallback after child start or for tool/test/review/cancel/ordinary ticket
  failure.
- Coordinator/planner fallback, arbitrary model/agent/flag selection, session
  reuse, auto/continue/session/share mode, credential or environment dumps.
- General shell proxying, non-root packet paths, broad process killing, or
  unowned descendants.
- Product version or release bump, commit push, pull request, publish, deploy,
  or other remote mutation.

## Human authority gates

- FBK-001 through FBK-005 need no additional human action for local
  implementation and verification.
- FBK-006 must stop after atomic `sol-codex` activation. A human must restart
  the Codex App and explicitly resume the coordinator before model discovery or
  any live delegation.
- Push, publish, deployment, release/version changes, and remote mutation
  remain separate unauthorized actions.

## Frontier execution policy

Run `execute-frontier` from local repository files in one continuous
coordinator conversation. Use one writer for every ticket and serial landing.
Read-only preflight and the three independent review lenses may be separate;
they do not authorize a second writer. Repair only inside the unchanged ticket
contract.

FBK-001 through FBK-005 must record the active `sol-only` preset and fingerprint
at claim and handoff. If either changes before FBK-006 activation, stop.
FBK-006 is not complete at its restart gate; persist state and resume it only
after human confirmation.

No GitHub issue, webhook, background watcher, or external scheduler is
required.

## Verification and architecture policies

See `policies/`. New fallback and lifecycle behavior belongs in focused modules
and in `test/preset-fallback.test.js` and
`test/node-control-plane.test.js`. Do not grow locked process or legacy test
files. Every command is bounded and owned; ordinary verification uses fake
OpenCode, while the only live model calls are the post-restart FBK-006 proof.
Verification commands are phase-correct: FBK-001 uses baseline gates; FBK-002
through FBK-004 invoke newly created `assets/scripts/*.mjs`; installed
`.agentic/scripts/*.mjs` commands begin only in FBK-005.

## Milestones

1. Truthful optional preset contract and collision-safe broker rendering.
2. Portable run-state and owned Node-first control plane.
3. Fixed OpenCode adapter and coordinator refusal transition.
4. Offline generator/upgrade/packed compatibility.
5. Atomic activation, mandatory restart, and bounded live dogfood.

## Ticket index

| ID | Title | Lane | Blocked by |
|---|---|---:|---|
| FBK-001 | Preset fallback contract and truthful routing | 3 | — |
| FBK-002 | Node-first fallback control plane | 3 | FBK-001 |
| FBK-003 | Terra OpenCode broker | 3 | FBK-002 |
| FBK-004 | Coordinator refusal transition | 3 | FBK-003 |
| FBK-005 | Offline fallback distribution | 3 | FBK-004 |
| FBK-006 | Sol-only and fallback live dogfood | 3 | FBK-005 |

## Completion rule

All six tickets are committed or explicitly superseded; the exact acceptance
commands and contract-native checks pass on the final diff; fake and packed
tests prove offline behavior; post-restart live evidence proves the expected
native refusal, brokered evidence-only implementer, and fresh read-only
reviewer; three independent review lenses pass; the preset left active is
`sol-codex`; and all owned descendants and leases are closed.
The three FBK-006 transient lease files are absent, while the three permitted
`.final.json` records truthfully retain final outcome and remaining-descendant
evidence.

## Stop and escalation rule

Stop on preset fingerprint drift, a route-changing contract conflict, an
unrecognized refusal, any child identity before fallback, fallback after start,
a second route transition, broker auth/refusal/timeout/nonzero/malformed output,
unexpected writes, unsafe path/argv construction, unverifiable ownership,
process or lease leakage, writer overlap, write-set expansion into an
unreviewed shared resource, failed rollback/activation atomicity, missing human
restart, any FBK-006 lease path outside the six frozen names, a retained
transient lease, missing or nonterminal final lease evidence, or any need for
release/push/publish/deploy authority.
