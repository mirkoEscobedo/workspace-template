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
  ["frontier-loop", "route planning, compilation, execution, and retrofit work"],
  ["wayfinder", "resolve destination and route-changing decisions"],
  ["compile-master-plan", "compile a stable map or goal into executable contracts"],
  ["execute-frontier", "continuously execute the local ticket frontier"],
  ["ticket-implementer", "implement one frozen ticket"],
  ["ticket-review", "run independent review lenses"],
  ["repair-ticket", "repair failed review axes"],
  ["integrate-wave", "neutrally and serially land passed candidates"],
  ["tdd", "vertical public-interface red-green-refactor"],
  ["test-topology", "enforce test-file and architecture ratchets"],
  ["process-lifecycle", "own command process trees and cleanup"],
  ["implementation-style", "apply preserve/simple/functional-core/clean policy"],
  ["verify", "gather fresh completion evidence"],
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
### Frontier Loop

Use local repository files as execution authority. GitHub issues, webhooks, and background watchers are optional and are not required.

1. Use \`wayfinder\` while a route-changing decision remains unresolved.
2. Use \`compile-master-plan\` to create vertical ticket contracts, dependencies, risk lanes, conflict keys, verification levels, and stop conditions.
3. Use \`execute-frontier\` from one continuous coordinator conversation. Start with one writer, parallelize read-only evidence, review in independent lenses, and land serially.
4. The coordinator/planner model profile is GPT-5.6 Sol with high reasoning. Worker, scout, reviewer, repairer, and integrator profiles use GPT-5.3-Codex with high reasoning.
5. Do not continue through human authority gates, unsafe scope expansion, unresolved semantic conflicts, or unrecoverable verification.

### Working agreement

- Read the nearest \`AGENTS.md\`, profile, relevant Wayfinder map, ticket contract, tests, and ADRs before editing.
- Implement one observable behavior at a time through a public seam. Confirm RED for the intended reason, implement minimum GREEN, then refactor while green.
- Keep actual writes inside the frozen contract. Unexpected shared scope invalidates concurrency assumptions.
- Never grow a locked megafile; place new behavior in a behavior-oriented module or run a dedicated decomposition.
- Every spawned command has one owner. Completion requires zero owned descendants and zero open process leases.
- Use targeted verification during repair and the contract's broader landing gates before completion.
- Treat reviewer passes as evidence, not as human authorization.

### Local skills

${skillList()}

### Definition of done

The requested behavior is landed or explicitly superseded, required review axes pass against the exact diff, verification evidence matches the current commit, architecture budgets do not regress, process leases are closed, and the worktree contains no unexplained changes.`;
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
