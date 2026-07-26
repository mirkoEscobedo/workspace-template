# D004 — Terra broker and fixed OpenCode invocation

## Question

How may the native Terra broker invoke an OpenCode Spark semantic role without
becoming a general command proxy?

## Context

The fallback needs a natively spawnable child to bridge the Codex App refusal,
but semantic work must still execute as the requested role under Spark/xhigh.

## Options considered

### Give the broker semantic permissions and arbitrary command input

This would duplicate role authority and create a shell-injection boundary.

### Generate a transport-only broker with a fixed argv builder

This keeps role behavior in the existing semantic prompts and lets the control
plane validate every dynamic value.

## Decision

Generate a collision-safe native Codex agent, preferably
`opencode_spark_broker`, routed to GPT-5.6 Terra/medium. Its prompt and
permissions are transport-only: it may invoke the generated control plane for
one policy-derived semantic role and may not edit, review, repair, integrate,
select models, broaden paths, or spawn unrelated work itself.

Callers pass only:

- one of the seven eligible semantic roles;
- the validated repository root;
- root-contained, frozen packet files required by that role;
- run/ticket/agent identity and a bounded deadline.

The control plane resolves `opencode` on POSIX and
`opencode.cmd`/its underlying executable on Windows. It builds this fixed
argument array:

```text
opencode run
  --pure
  --agent <policy-derived-role>
  --model openai/gpt-5.3-codex-spark
  --variant xhigh
  --format json
  --dir <validated-root>
  --file <validated-packet-file>...
  <fixed broker instruction>
```

The fixed broker instruction tells OpenCode to act only as the selected
semantic role, consume the frozen packet, emit the required report/evidence,
and obey its generated permissions. No caller-controlled free-form instruction
is accepted.

Each broker attempt creates a fresh OpenCode session and runs exactly once.
Forbid `--auto`, `--continue`, `--session`, `--share`, credential dumps, and
environment dumps. Auto-update and sharing are disabled. Validate model,
variant, role ID, root, and every packet file against the active policy before
spawn.

## Consequences

- Terra transports; Spark performs the semantic task.
- OpenCode writer roles remain sole writers and reviewer roles remain
  read-only.
- Authentication, refusal, timeout, nonzero exit, malformed JSON, unexpected
  writes, or a second routing failure is terminal.

## Evidence

- User-approved exact argv and safety decisions.
- `assets/configs/opencode/opencode.json`
- `src/presets/render.js`
- `.agentic/policies/model-routing.yaml`

## Newly visible work

- Render the broker in FBK-001.
- Implement the invocation adapter in FBK-003.
