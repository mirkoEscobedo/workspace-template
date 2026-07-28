import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEPENDENCY_SNAPSHOT, PACKAGE_VERSION } from "./constants.js";
import { hashBuffer, listFiles, normalizeTextLineEndings, toPosixPath } from "./fs-utils.js";
export { assetsRoot, assetsSkills } from "./asset-paths.js";
import { assetsRoot, assetsSkills } from "./asset-paths.js";
import { presetCatalogArtifacts } from "./presets/catalog.js";
import {
  activePresetState,
  modelRoutingYaml as renderModelRoutingYaml,
  renderCodexArtifacts,
  renderOpenCodeArtifacts,
} from "./presets/render.js";


export function agenticReadme(mode = "generated") {
  return `# Agentic workspace

This ${mode} repository owns its installed agent behavior.

- \`profile.json\` records implementation, testing, and Frontier execution policy.
- \`skills/\` is the canonical project-local skill catalog.
- \`skills.lock.json\` records the packaged baseline.
- \`managed-files.json\` records generator ownership and drift boundaries.
- \`managed-projections.json\` records harness projections.
- \`policies/\` contains model routing, verification, architecture, and process defaults.
- \`scripts/\` contains deterministic guards and retrofit helpers.
- \`../docs/agent/\` is durable repository planning memory.

Edit canonical skills, then run:

\`\`\`bash
npx workspace-template sync .
npx workspace-template doctor .
\`\`\`

Frontier Loop is local-file based. GitHub issues, webhooks, and repository watchers are optional integrations, not prerequisites.
`;
}

export function architectureNote({ project, style, tdd, mode, presetState }) {
  const coordinator = presetState?.roles?.coordinator;
  const implementer = presetState?.roles?.implementer;
  return `# Implementation profile

Machine-readable policy: \`.agentic/profile.json\`.

- Mode: \`${mode}\`
- Stack: \`${project}\`
- Style: \`${style}\`
- TDD mode: \`${tdd}\`
- Execution: Frontier Loop
- Active agent preset: \`${presetState?.id ?? "unresolved"}\` (${presetState?.status ?? "unresolved"})
- Coordinator: \`${coordinator?.targets?.codex ?? coordinator?.targets?.opencode ?? "unresolved"}\`, ${coordinator?.reasoningEffort ?? "unresolved"}
- Implementer: \`${implementer?.targets?.codex ?? implementer?.targets?.opencode ?? "unresolved"}\`, ${implementer?.reasoningEffort ?? "unresolved"}

## Decision rule

Use the smallest design that makes effects visible and behavior testable. In adopted repositories, preserve coherent existing structure and migrate only through explicitly approved, protected vertical slices. A selected future style is a direction for new or touched work, not a claim about the current codebase.
`;
}

export function dependencyNote(project) {
  const relevant = {
    typescript: ["typescript", "tsx", "vitest", "biome", "typesNode"],
    javascript: ["typescript", "biome", "typesNode"],
    react: [
      "react",
      "reactDom",
      "typescript",
      "vite",
      "viteReact",
      "vitest",
      "testingLibraryReact",
      "testingLibraryJestDom",
      "jsdom",
      "biome",
    ],
    rust: [],
    flutter: ["flutterLints"],
  }[project] ?? [];

  const lines = relevant.map((key) => `- ${key}: \`${DEPENDENCY_SNAPSHOT[key]}\``).join("\n");
  return `# Dependency snapshot

Captured on **${DEPENDENCY_SNAPSHOT.capturedAt}** when this generator release was assembled.

${lines || "- No third-party runtime dependencies are added by this workflow layer."}

The snapshot is a reproducible starting point, not a current-version promise. Adoption never installs or changes dependencies.
`;
}

export function createAgenticConfig({
  mode,
  project,
  style,
  tdd,
  packageManager,
  agents,
  originalTimestamp,
  docs = true,
  tickets = true,
  presetState,
}) {
  const summary = (role) => ({
    model: role.targets?.codex ?? role.targets?.opencode,
    reasoningEffort: role.reasoningEffort,
  });
  const timestampKey = mode === "adopted" ? "adoptedAt" : "createdAt";
  return {
    version: 3,
    generator: "workspace-template",
    generatorVersion: PACKAGE_VERSION,
    mode,
    [timestampKey]: originalTimestamp === undefined ? new Date().toISOString() : originalTimestamp,
    project,
    style,
    tdd,
    packageManager,
    canonicalSkills: ".agentic/skills",
    skillLock: ".agentic/skills.lock.json",
    managedFiles: ".agentic/managed-files.json",
    execution: {
      method: "frontier",
      preset: presetState,
      coordinator: summary(presetState.roles.coordinator),
      planner: summary(presetState.roles.planner),
      workers: summary(presetState.roles.implementer),
      routing: presetState.roles,
      maxConcurrentSubagents: 3,
      defaultWriters: 1,
      landing: "serial",
    },
    features: {
      durableAgentDocs: docs,
      ticketContracts: tickets,
      processLeases: true,
      architectureBudgets: true,
    },
    agentTargets: agents,
  };
}

export async function readTree(sourceRoot, destinationPrefix) {
  const artifacts = [];
  for (const source of await listFiles(sourceRoot)) {
    const relative = toPosixPath(path.relative(sourceRoot, source));
    artifacts.push({
      path: toPosixPath(path.posix.join(destinationPrefix, relative)),
      content: normalizeTextLineEndings(await readFile(source)),
      source,
    });
  }
  return artifacts;
}

export async function canonicalSkillArtifacts(destinationPrefix = ".agentic/skills") {
  return readTree(assetsSkills, destinationPrefix);
}

export async function skillBaselineArtifacts(destinationPrefix = ".agentic/skill-baselines") {
  return readTree(assetsSkills, destinationPrefix);
}

export async function projectMemoryArtifacts() {
  return readTree(path.join(assetsRoot, "project-agent"), "");
}

export async function scriptArtifacts() {
  return readTree(path.join(assetsRoot, "scripts"), ".agentic/scripts");
}

export async function harnessArtifacts(agents, resolvedPreset, roleIds) {
  const artifacts = [];
  if (agents.includes("codex")) {
    artifacts.push(...await renderCodexArtifacts(resolvedPreset, roleIds));
  }
  if (agents.includes("opencode")) {
    artifacts.push(...await renderOpenCodeArtifacts(resolvedPreset, roleIds));
  }
  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

export async function policyArtifacts(resolvedPreset, presetState = activePresetState(resolvedPreset, {})) {
  const compileAssets = path.join(assetsSkills, "compile-master-plan", "assets");
  const names = [
    ["architecture-budgets.yaml", "architecture-budgets.yaml"],
    ["verification-policy.yaml", "verification.yaml"],
    ["process-policy.yaml", "process.yaml"],
  ];
  const artifacts = [];
  for (const [sourceName, targetName] of names) {
    artifacts.push({
      path: `.agentic/policies/${targetName}`,
      content: normalizeTextLineEndings(await readFile(path.join(compileAssets, sourceName))),
    });
  }
  artifacts.push({ path: ".agentic/policies/model-routing.yaml", content: Buffer.from(renderModelRoutingYaml(resolvedPreset, presetState)) });
  return artifacts;
}

export { presetCatalogArtifacts };

export const PROJECTION_ROOTS = Object.freeze({
  claude: ".claude/skills",
  codex: ".agents/skills",
  copilot: ".github/skills",
  opencode: ".opencode/skills",
  gemini: ".gemini/skills",
});

export async function projectionArtifacts(agents) {
  const artifacts = [];
  const lock = await skillLock();
  const skillNames = Object.keys(lock.skills).sort();
  const skillHashes = Object.fromEntries(
    skillNames.map((name) => [name, lock.skills[name].baselineHash]),
  );
  const projections = {};

  for (const agent of agents) {
    const destination = PROJECTION_ROOTS[agent];
    if (!destination) continue;
    artifacts.push(...(await readTree(assetsSkills, destination)));
    artifacts.push({
      path: `${destination}/.managed-by-workspace-template.json`,
      content: Buffer.from(JSON.stringify({
        version: 2,
        generator: "workspace-template",
        canonical: ".agentic/skills",
        skills: skillNames,
        skillHashes,
      }, null, 2) + "\n"),
    });
    projections[agent] = { path: destination, skills: skillNames };
  }

  if (Object.keys(projections).length > 0) {
    artifacts.push({
      path: ".agentic/managed-projections.json",
      content: Buffer.from(JSON.stringify({
        version: 2,
        generator: "workspace-template",
        generatedAt: null,
        canonical: ".agentic/skills",
        skillNames,
        skillHashes,
        agentTargets: Object.keys(projections),
        projections,
      }, null, 2) + "\n"),
    });
  }
  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

export function normalizeArtifact(artifact) {
  const content = normalizeTextLineEndings(
    Buffer.isBuffer(artifact.content) ? artifact.content : Buffer.from(String(artifact.content), "utf8"),
  );
  return { ...artifact, content, hash: hashBuffer(content) };
}

export async function skillLock() {
  const entries = await readTree(assetsSkills, "");
  const grouped = new Map();
  for (const entry of entries) {
    const [name, ...rest] = entry.path.split("/");
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content);
    if (!grouped.has(name)) grouped.set(name, []);
    grouped.get(name).push({ path: rest.join("/"), content });
  }

  const skills = {};
  for (const name of [...grouped.keys()].sort()) {
    const files = grouped.get(name).sort((left, right) => left.path.localeCompare(right.path));
    const combined = Buffer.concat(files.flatMap((file) => [Buffer.from(`${file.path}\0`), file.content, Buffer.from("\0")]));
    skills[name] = {
      path: `.agentic/skills/${name}`,
      baselinePath: `.agentic/skill-baselines/${name}`,
      baselineHash: hashBuffer(combined),
      installedHash: hashBuffer(combined),
      localEditsAllowed: true,
      files: Object.fromEntries(files.map((file) => [file.path, { baselineHash: hashBuffer(file.content), installedHash: hashBuffer(file.content) }])),
    };
  }

  return {
    version: 2,
    source: { package: "workspace-template", version: PACKAGE_VERSION },
    skills,
  };
}

function commandText(command) {
  if (!command) return "Not detected";
  if (typeof command === "string") return command;
  return [command.command ?? command.executable, ...(command.args ?? [])].filter(Boolean).join(" ");
}

function serializedWorkspace(workspace) {
  return {
    version: workspace.version ?? 1,
    root: ".",
    kind: workspace.kind,
    fingerprint: workspace.fingerprint,
    evidence: workspace.evidence ?? [],
    rootModule: workspace.rootModule ? {
      id: workspace.rootModule.id,
      name: workspace.rootModule.name,
      path: workspace.rootModule.path,
      project: workspace.rootModule.project,
      packageManager: workspace.rootModule.packageManager,
      manifest: workspace.rootModule.manifest,
      lockOwner: workspace.rootModule.lockOwner,
      commands: workspace.rootModule.commands ?? {},
      aggregate: true,
    } : null,
    modules: workspace.modules.map((module) => ({
      id: module.id,
      name: module.name,
      path: module.path,
      project: module.project,
      packageManager: module.packageManager,
      manifest: module.manifest,
      lockOwner: module.lockOwner,
      dependencies: module.dependencies ?? [],
      commands: module.commands ?? {},
      opaque: Boolean(module.opaque),
    })),
    warnings: workspace.warnings ?? [],
    conflicts: workspace.conflicts ?? [],
  };
}

export function generatedWorkspace(context) {
  return {
    version: 1,
    root: ".",
    kind: "single",
    fingerprint: null,
    evidence: [],
    modules: [{
      id: context.npmName ?? context.rustCrateName ?? context.dartPackageName ?? "root",
      name: context.projectName,
      path: ".",
      project: context.project,
      packageManager: context.project === "rust" ? "cargo" : context.project === "flutter" ? "flutter" : context.packageManager,
      manifest: context.project === "rust" ? "Cargo.toml" : context.project === "flutter" ? "pubspec.yaml" : "package.json",
      lockOwner: ".",
      dependencies: [],
      commands: { full: context.commands?.full, fullSteps: [] },
      opaque: false,
    }],
    warnings: [],
    conflicts: [],
  };
}

export async function workspaceStateArtifacts(workspace, context, options = {}) {
  if (!workspace?.modules?.length) return [];
  const serialized = serializedWorkspace(workspace);
  const artifacts = [{
    path: ".agentic/workspace.json",
    content: Buffer.from(`${JSON.stringify(serialized, null, 2)}\n`),
  }];
  const includeNested = options.nestedInstructions !== "never";
  for (const module of serialized.modules) {
    const base = `.agentic/modules/${module.id}`;
    artifacts.push({
      path: `${base}/profile.json`,
      content: Buffer.from(`${JSON.stringify({
        version: 1,
        id: module.id,
        path: module.path,
        project: module.project,
        packageManager: module.packageManager,
        architecture: {
          current: "existing-or-mixed",
          preferredForNewCode: context.style === "preserve" ? null : context.style,
          migrationPolicy: "incremental-protected-vertical-slices",
        },
      }, null, 2)}\n`),
    });
    artifacts.push({ path: `${base}/commands.json`, content: Buffer.from(`${JSON.stringify(module.commands ?? {}, null, 2)}\n`) });
    if (includeNested && !module.opaque && module.path !== "." && (options.nestedInstructions === "always" || serialized.modules.length > 1)) {
      const full = module.commands?.full ?? (module.commands?.fullSteps ?? []).map(commandText).join(" && ");
      artifacts.push({
        path: `${module.path}/AGENTS.md`,
        content: Buffer.from(`# Module instructions — ${module.id}\n\nInherit repository-wide policy from the root \`AGENTS.md\`. This file adds only module-specific facts.\n\n- Path: \`${module.path}\`\n- Stack: \`${module.project}\`\n- Package manager/toolchain: \`${module.packageManager}\`\n- Manifest: \`${module.manifest}\`\n- Dependencies: ${(module.dependencies ?? []).length ? module.dependencies.map((item) => `\`${item}\``).join(", ") : "none"}\n- Full verification: ${full ? `\`${full}\`` : "Not detected — update module commands metadata"}\n\nKeep changes within this module unless the ticket contract explicitly names cross-module paths and conflict keys.\n`),
      });
    }
  }
  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}
