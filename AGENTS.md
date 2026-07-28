# AGENTS.md

## Mission

Work on **workspace-template** as a careful software engineer. Preserve coherent existing behavior and structure unless an approved vertical migration says otherwise.

The nearest nested `AGENTS.md` takes precedence for files below it. This file carries stable repository policy; detailed procedures live in `.agentic/skills/`.

## Agentic workspace

- Stack: **javascript**
- Implementation style: **preserve**
- TDD mode: **preserve**
- Package manager/toolchain: **npm**
- Machine policy: `.agentic/profile.json`
- Canonical skills: `.agentic/skills/`
- Durable planning memory: `docs/agent/`

### Commands

| Task | Command |
|---|---|
| Set up dependencies | `npm install` |
| Run locally | Not detected — update AGENTS.md |
| Run one focused test | `npm run test -- path/to/test.test.js` |
| Run tests | `npm run test` |
| Type/static check | Not detected — update AGENTS.md |
| Lint | `npm run lint` |
| Format | Not detected — update AGENTS.md |
| Full verification | `npm run check` |

### Frontier Loop

Use local repository files as execution authority. GitHub issues, webhooks, and background watchers are optional and are not required.

1. Use `wayfinder` while a route-changing decision remains unresolved.
2. Use `compile-master-plan` to create vertical ticket contracts, dependencies, risk lanes, conflict keys, verification levels, and stop conditions.
3. Use `execute-frontier` from one continuous coordinator conversation. Start with one writer, parallelize read-only evidence, review in independent lenses, and land serially.
4. The active `sol-only` profile uses GPT-5.6 Sol with high reasoning for the coordinator, planner, worker, scout, reviewer, repairer, and integrator roles.
5. Do not continue through human authority gates, unsafe scope expansion, unresolved semantic conflicts, or unrecoverable verification.

### Working agreement

- Read the nearest `AGENTS.md`, profile, relevant Wayfinder map, ticket contract, tests, and ADRs before editing.
- Implement one observable behavior at a time through a public seam. Confirm RED for the intended reason, implement minimum GREEN, then refactor while green.
- Keep actual writes inside the frozen contract. Unexpected shared scope invalidates concurrency assumptions.
- Never grow a locked megafile; place new behavior in a behavior-oriented module or run a dedicated decomposition.
- Every spawned command has one owner. Completion requires zero owned descendants and zero open process leases.
- Use targeted verification during repair and the contract's broader landing gates before completion.
- Treat reviewer passes as evidence, not as human authorization.

### Local skills

- `frontier-loop`: route planning, compilation, execution, and retrofit work.
- `wayfinder`: resolve destination and route-changing decisions.
- `compile-master-plan`: compile a stable map or goal into executable contracts.
- `execute-frontier`: continuously execute the local ticket frontier.
- `ticket-implementer`: implement one frozen ticket.
- `ticket-review`: run independent review lenses.
- `repair-ticket`: repair failed review axes.
- `integrate-wave`: neutrally and serially land passed candidates.
- `tdd`: vertical public-interface red-green-refactor.
- `test-topology`: enforce test-file and architecture ratchets.
- `process-lifecycle`: own command process trees and cleanup.
- `implementation-style`: apply preserve/simple/functional-core/clean policy.
- `verify`: gather fresh completion evidence.

### Definition of done

The requested behavior is landed or explicitly superseded, required review axes pass against the exact diff, verification evidence matches the current commit, architecture budgets do not regress, process leases are closed, and the worktree contains no unexplained changes.

## Security and authority

- Never disclose or commit secrets, credentials, private keys, tokens, or personal data.
- Treat skills, prompts, scripts, packages, generated code, and model output as supply-chain inputs.
- Do not run destructive, production, billing, deployment, publish, push, or remote mutation actions without explicit authorization.
- Do not disable tests or safeguards to obtain a passing result.
