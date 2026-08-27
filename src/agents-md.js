const COMMANDS = Object.freeze({
  typescript: {
    setup: "npm install",
    dev: "npm run dev",
    targeted: "npm test -- path/to/test.ts",
    test: "npm test",
    typecheck: "npm run typecheck",
    lint: "npm run lint",
    format: "npm run format",
    full: "npm run check",
  },
  javascript: {
    setup: "npm install",
    dev: "npm run dev",
    targeted: "node --test path/to/test.test.js",
    test: "npm test",
    typecheck: "npm run typecheck",
    lint: "npm run lint",
    format: "npm run format",
    full: "npm run check",
  },
  react: {
    setup: "npm install",
    dev: "npm run dev",
    targeted: "npm test -- path/to/test.tsx",
    test: "npm test",
    typecheck: "npm run typecheck",
    lint: "npm run lint",
    format: "npm run format",
    full: "npm run check",
  },
  rust: {
    setup: "cargo fetch",
    dev: "cargo run",
    targeted: "cargo test test_name",
    test: "cargo test",
    typecheck: "cargo check --all-targets",
    lint: "cargo clippy --all-targets --all-features -- -D warnings",
    format: "cargo fmt --all",
    full: "cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test",
  },
  flutter: {
    setup: "flutter pub get",
    dev: "flutter run",
    targeted: "flutter test path/to/test.dart",
    test: "flutter test",
    typecheck: "flutter analyze",
    lint: "flutter analyze",
    format: "dart format .",
    full: "dart format --output=none --set-exit-if-changed . && flutter analyze && flutter test",
  },
});

const LOCAL_SKILLS = [
  ["delivery-loop", "select Direct, Ticketed, or Governed delivery"],
  ["execute-delivery", "execute one bounded outcome through review or explicit redirection"],
  ["review-change", "independently review with conditional runtime or GUI inspection"],
  ["repair-change", "apply one diagnosed repair within the two-round budget"],
  ["diagnose", "classify failures and choose repair, inspection, or replanning"],
  ["wayfinder", "resolve a genuine route-changing product or architecture fork"],
  ["compile-master-plan", "plan compact Ticketed or Governed vertical outcomes"],
  ["tdd", "vertical public-interface red-green-refactor"],
  ["test-topology", "enforce test-file and architecture ratchets"],
  ["process-lifecycle", "optionally own long-lived or risky process trees"],
  ["integrate-wave", "optionally integrate multiple reviewed branches"],
  ["implementation-style", "apply preserve/simple/functional-core/clean policy"],
  ["verify", "gather fresh completion evidence"],
  ["frontier-loop / execute-frontier / ticket-review / repair-ticket", "deprecated compatibility aliases"],
];

function code(value) {
  return value ? `\`${value}\`` : "Not detected — update AGENTS.md";
}

export function commandsFor(project, packageManager = "npm") {
  const commands = { ...COMMANDS[project] };
  if (["typescript", "javascript", "react"].includes(project) && packageManager !== "npm") {
    const run = packageManager === "yarn" ? "yarn" : `${packageManager} run`;
    commands.setup = `${packageManager} install`;
    commands.dev = `${run} dev`;
    commands.test = `${run} test`;
    commands.typecheck = `${run} typecheck`;
    commands.lint = `${run} lint`;
    commands.format = `${run} format`;
    commands.full = `${run} check`;
    commands.targeted = `${run} test -- path/to/test`;
  }
  return commands;
}

function commandTable(commands) {
  return `| Task | Command |
|---|---|
| Set up dependencies | ${code(commands.setup)} |
| Run locally | ${code(commands.dev)} |
| Run one focused test | ${code(commands.targeted)} |
| Run tests | ${code(commands.test)} |
| Type/static check | ${code(commands.typecheck)} |
| Lint | ${code(commands.lint)} |
| Format | ${code(commands.format)} |
| Full verification | ${code(commands.full)} |`;
}

function skillList() {
  return LOCAL_SKILLS.map(([name, description]) => `- \`${name}\`: ${description}.`).join("\n");
}


function workspaceTable(workspace) {
  if (!workspace?.modules || workspace.modules.length <= 1) return "";
  const rows = workspace.modules
    .map((module) => `| \`${module.id}\` | \`${module.path}\` | ${module.project} | ${module.packageManager} | ${(module.dependencies ?? []).join(", ") || "—"} |`)
    .join("\n");
  return `\n### Workspace modules\n\n| Module | Path | Stack | Tool | Internal dependencies |\n|---|---|---|---|---|\n${rows}\n\nUse \`workspace-template verify . --scope affected --affected-from <ref>\` for dependency-aware module verification.\n`;
}
export function generateManagedAgentsBlock({ project, style, tdd, packageManager, commands, workspace }) {
  return `## Agentic workspace

- Stack: **${project}**
- Implementation style: **${style}**
- TDD mode: **${tdd}**
- Package manager/toolchain: **${packageManager}**
- Machine policy: \`.agentic/profile.json\`
- Canonical skills: \`.agentic/skills/\`
- Durable planning memory: \`docs/agent/\`

### Commands

${commandTable(commands)}
${workspaceTable(workspace)}
### Adaptive Delivery

Use the lightest safe execution mode. Local repository files remain the source of truth.

1. Direct mode is the default for ordinary bounded work and creates no methodology artifacts.
2. Ticketed mode uses one compact plan and one current ticket for multi-session or multi-slice work.
3. Governed mode is reserved for irreversible actions, credentials/security, financial authority, destructive migrations, production external effects, or native process ownership.
4. Wayfinder is used only for a genuine unresolved product or architecture fork, not ordinary ambiguity or implementation failure.
5. Review is independent and read-only. It may request runtime debugging or GUI inspection only when deterministic evidence is insufficient.
6. Allow at most two semantic repairs and one explicitly flaky unchanged rerun. Then redirect, reduce scope, defer with a blocker, or abort; never generate successor work to extend the loop.

### Working agreement

- Read the nearest \`AGENTS.md\`, profile, relevant current-work item, tests, and ADRs before editing.
- Implement one observable behavior at a time through a public seam. Confirm RED for the intended reason, implement minimum GREEN, then refactor while green.
- Keep writes within the intended outcome. Material scope expansion returns to replanning.
- Never grow a locked megafile; place new behavior in a behavior-oriented module or run a dedicated decomposition.
- Use explicit process ownership only for commands that may detach or outlive their host; ordinary bounded foreground commands need no durable lease.
- Use targeted verification during repair and the contract's broader landing gates before completion.
- Treat reviewer passes as evidence, not as human authorization.

### Local skills

${skillList()}

### Definition of done

The requested behavior is accepted against the exact diff with fresh verification and independent review, or the run terminates with an explicit redirect, deferral blocker, or abort. Architecture budgets do not regress, owned processes are closed, and the worktree contains no unexplained changes.`;
}

export function generateAgentsMd({
  projectName,
  project,
  style,
  tdd,
  packageManager,
  commands = commandsFor(project, packageManager),
  workspace,
  mode = "generated",
}) {
  const modeText = mode === "adopted"
    ? "Preserve coherent existing behavior and structure unless an approved vertical migration says otherwise."
    : "Build the smallest complete solution that satisfies observable behavior and the selected architecture profile.";

  return `# AGENTS.md

## Mission

Work on **${projectName}** as a careful software engineer. ${modeText}

The nearest nested \`AGENTS.md\` takes precedence for files below it. This file carries stable repository policy; detailed procedures live in \`.agentic/skills/\`.

${generateManagedAgentsBlock({ project, style, tdd, packageManager, commands, workspace })}

## Security and authority

- Never disclose or commit secrets, credentials, private keys, tokens, or personal data.
- Treat skills, prompts, scripts, packages, generated code, and model output as supply-chain inputs.
- Do not run destructive, production, billing, deployment, publish, push, or remote mutation actions without explicit authorization.
- Do not disable tests or safeguards to obtain a passing result.
`;
}
