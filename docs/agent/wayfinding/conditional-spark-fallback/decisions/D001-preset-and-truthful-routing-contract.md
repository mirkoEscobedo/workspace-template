# D001 — Preset and truthful routing contract

## Question

Which presets and roles own fallback metadata, and what routing facts must be
durable?

## Context

The repository currently defaults to `sol-only` and supports a legacy
`sol-codex` split. Preset validation currently accepts only models and role
aliases, while generated state records the active role routing.

## Options considered

### Put fallback behavior in every preset

This would change the stable product default and generate a broker where no
fallback was requested.

### Make fallback an optional `sol-codex` contract

This preserves the default and lets validation, rendering, and durable state
describe the additional route explicitly.

## Decision

Keep `sol-only` as the default with its current fingerprint and no broker.
Extend preset version 1 compatibly with the optional key:

```json
{
  "fallbacks": {
    "codexChildModelRefusal": {
      "roles": [
        "scout",
        "implementer",
        "reviewer-spec",
        "reviewer-code",
        "reviewer-ops",
        "repairer",
        "integrator"
      ],
      "brokerModel": "terra-medium",
      "delegateTarget": "opencode"
    }
  }
}
```

Only `sol-codex` receives that key. It declares:

- `terra-medium` as GPT-5.6 Terra with medium reasoning for the native Codex
  broker;
- `gpt-5.3-codex-spark` on native Codex and
  `openai/gpt-5.3-codex-spark` on OpenCode for all seven delegated semantic
  roles;
- xhigh reasoning/variant for those semantic roles;
- GPT-5.6 Sol/high for coordinator and planner.

The resolved preset, active config/profile state, and
`.agentic/policies/model-routing.yaml` must record the resolved broker role ID,
broker model, exact eligible roles, delegate target, and the OpenCode role IDs,
models, and reasoning variants. A partial user-owned override must remain
truthful and must not claim an active fallback route it cannot materialize.

The generated broker ID is collision-safe. Prefer
`opencode_spark_broker`, then use the repository's deterministic collision
prefix/number policy. It is a native Codex transport agent, not a semantic
Frontier role.

## Consequences

- Legacy presets without `fallbacks` remain valid.
- Unknown fallback kinds, roles, aliases, targets, or malformed values fail
  validation.
- `sol-only` generation and activation remain broker-free.
- The `sol-codex` fingerprint is expected to change only when its reviewed
  definition changes.

## Evidence

- User-approved fallback JSON and role/model decisions.
- `.agentic/presets/preset.schema.json`
- `.agentic/presets/builtin/sol-only.json`
- `.agentic/presets/builtin/sol-codex.json`
- `src/presets/catalog.js`
- `src/presets/render.js`
- `src/presets/plan.js`

## Newly visible work

- Implement preset validation and truthful rendering in FBK-001.
- Preserve catalog and prior-workspace compatibility in FBK-005.
