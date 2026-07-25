import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  copyDirectory,
  ensureDirectory,
  exists,
  hashDirectory,
  readJson,
  removePath,
  writeJson,
  writeText,
} from "./fs-utils.js";

const PROJECTIONS = Object.freeze({
  claude: ".claude/skills",
  codex: ".agents/skills",
  copilot: ".github/skills",
  opencode: ".opencode/skills",
  gemini: ".gemini/skills",
});

const PROJECTION_MARKER = ".managed-by-workspace-template.json";
const MANAGED_SHIM_MARKER = "<!-- managed-by-workspace-template -->";

async function listSkillNames(canonicalRoot) {
  const entries = await readdir(canonicalRoot, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
}

function instructionShim(agent) {
  if (agent === "claude") return { relativePath: "CLAUDE.md", content: `${MANAGED_SHIM_MARKER}\n@AGENTS.md\n` };
  if (agent === "gemini") return { relativePath: "GEMINI.md", content: `${MANAGED_SHIM_MARKER}\n@AGENTS.md\n` };
  return undefined;
}

async function ensureInstructionShim(root, agent, dryRun) {
  const shim = instructionShim(agent);
  if (!shim) return undefined;
  const filePath = path.join(root, shim.relativePath);
  if (dryRun) return shim.relativePath;
  if (!(await exists(filePath))) await writeText(filePath, shim.content);
  else {
    const current = await readFile(filePath, "utf8");
    if (current.startsWith(MANAGED_SHIM_MARKER)) await writeText(filePath, shim.content);
  }
  return shim.relativePath;
}

async function instructionShimStatus(root, agent) {
  const shim = instructionShim(agent);
  if (!shim) return { instructionFile: undefined, instructionExists: true, instructionLinked: true, instructionManaged: false };
  const filePath = path.join(root, shim.relativePath);
  if (!(await exists(filePath))) return { instructionFile: shim.relativePath, instructionExists: false, instructionLinked: false, instructionManaged: false };
  const content = await readFile(filePath, "utf8");
  return {
    instructionFile: shim.relativePath,
    instructionExists: true,
    instructionLinked: /^@AGENTS\.md\s*$/m.test(content),
    instructionManaged: content.startsWith(MANAGED_SHIM_MARKER),
  };
}

function cursorRule() {
  return `---
description: Frontier Loop project workflow and architecture policy
globs: "**/*"
alwaysApply: true
---

Read and follow the nearest AGENTS.md, .agentic/profile.json, relevant Wayfinder map, and ticket contract before editing.
Use the canonical procedures under .agentic/skills/ when the task matches their descriptions.
Keep one writer by default, parallelize read-only evidence, review independently, land serially, and stop at human authority gates.
Do not execute destructive or high-risk actions without explicit authorization.
`;
}

async function loadMarker(destination) {
  const markerPath = path.join(destination, PROJECTION_MARKER);
  if (!(await exists(markerPath))) return undefined;
  try { return await readJson(markerPath); } catch { return { invalid: true }; }
}

async function preflightProjection(root, agent, names, canonicalRoot, previous) {
  if (agent === "cursor") {
    const rulePath = path.join(root, ".cursor", "rules", "workspace-template-workflow.mdc");
    if (!(await exists(rulePath))) return { agent, kind: "cursor", conflicts: [], rulePath, action: "create" };
    const content = await readFile(rulePath, "utf8");
    if (content === cursorRule() || /^---[\s\S]*workspace-template|Frontier Loop project workflow/.test(content)) {
      return { agent, kind: "cursor", conflicts: [], rulePath, action: "update" };
    }
    return { agent, kind: "cursor", conflicts: ["custom Cursor rule exists at .cursor/rules/workspace-template-workflow.mdc"], rulePath };
  }

  const relativeDestination = PROJECTIONS[agent];
  if (!relativeDestination) return { agent, kind: "none", conflicts: [] };
  const destination = path.join(root, relativeDestination);
  const marker = await loadMarker(destination);
  const managedNames = new Set([
    ...(marker?.skills ?? []),
    ...(previous?.projections?.[agent]?.skills ?? []),
    ...(previous?.skillNames ?? []),
  ]);
  const conflicts = [];
  const actions = [];

  for (const name of names) {
    const canonical = path.join(canonicalRoot, name);
    const projected = path.join(destination, name);
    if (!(await exists(projected))) {
      actions.push({ name, action: "create" });
      continue;
    }
    const equal = (await hashDirectory(canonical)) === (await hashDirectory(projected));
    if (equal) actions.push({ name, action: "adopt-identical" });
    else if (managedNames.has(name) && !marker?.invalid) actions.push({ name, action: "update" });
    else conflicts.push(`${relativeDestination}/${name} is unmanaged and differs from the canonical skill`);
  }

  const remove = [];
  for (const oldName of managedNames) {
    if (!names.includes(oldName) && await exists(path.join(destination, oldName))) remove.push(oldName);
  }
  return { agent, kind: "skills", relativeDestination, destination, marker, conflicts, actions, remove };
}

export async function syncSkills(rootDirectory, requestedAgents, options = {}) {
  const root = path.resolve(rootDirectory);
  const configPath = path.join(root, ".agentic", "config.json");
  if (!(await exists(configPath))) throw new Error(`Missing ${path.relative(process.cwd(), configPath)}. Run create or adopt first.`);
  const config = await readJson(configPath);
  const agents = requestedAgents ?? config.agentTargets ?? [];
  const canonicalRoot = path.resolve(options.canonicalRoot ?? path.join(root, ".agentic", "skills"));
  if (!(await exists(canonicalRoot))) throw new Error(`Missing canonical skill directory: ${canonicalRoot}`);

  const names = await listSkillNames(canonicalRoot);
  const manifestPath = path.join(root, ".agentic", "managed-projections.json");
  const previous = (await exists(manifestPath)) ? await readJson(manifestPath) : { skillNames: [], projections: {} };
  const plans = [];
  for (const agent of agents) plans.push(await preflightProjection(root, agent, names, canonicalRoot, previous));
  const conflicts = plans.flatMap((plan) => plan.conflicts.map((message) => ({ agent: plan.agent, message })));
  if (conflicts.length > 0) {
    const error = new Error(`Projection conflicts:\n${conflicts.map((item) => `- ${item.agent}: ${item.message}`).join("\n")}`);
    error.conflicts = conflicts;
    throw error;
  }

  const projectionRecords = {};
  for (const plan of plans) {
    await ensureInstructionShim(root, plan.agent, options.dryRun);
    if (plan.kind === "cursor") {
      if (!options.dryRun) await writeText(plan.rulePath, cursorRule());
      projectionRecords.cursor = { kind: "rule", path: ".cursor/rules/workspace-template-workflow.mdc", skills: [] };
      continue;
    }
    if (plan.kind !== "skills") continue;
    if (!options.dryRun) {
      await ensureDirectory(plan.destination);
      for (const oldName of plan.remove) await removePath(path.join(plan.destination, oldName));
      for (const item of plan.actions) {
        if (item.action === "adopt-identical") continue;
        const target = path.join(plan.destination, item.name);
        await removePath(target);
        await copyDirectory(path.join(canonicalRoot, item.name), target);
      }
      await writeJson(path.join(plan.destination, PROJECTION_MARKER), {
        version: 2,
        generator: "workspace-template",
        canonical: ".agentic/skills",
        skills: names,
      });
    }
    projectionRecords[plan.agent] = {
      kind: "skills",
      path: plan.relativeDestination,
      skills: names,
      hash: options.dryRun ? "dry-run" : await hashDirectory(plan.destination),
    };
  }

  const manifest = {
    version: 2,
    generatedAt: options.dryRun ? null : new Date().toISOString(),
    canonical: ".agentic/skills",
    canonicalHash: options.dryRun ? "dry-run" : await hashDirectory(canonicalRoot),
    skillNames: names,
    agentTargets: agents,
    projections: projectionRecords,
    conflicts: [],
  };
  if (!options.dryRun) {
    await writeJson(manifestPath, manifest);
    config.agentTargets = agents;
    await writeJson(configPath, config);
  }
  return manifest;
}

export async function projectionStatus(rootDirectory) {
  const root = path.resolve(rootDirectory);
  const config = await readJson(path.join(root, ".agentic", "config.json"));
  const canonicalRoot = path.join(root, ".agentic", "skills");
  const names = await listSkillNames(canonicalRoot);
  const canonicalHash = await hashDirectory(canonicalRoot);
  const results = [];

  for (const agent of config.agentTargets ?? []) {
    const instruction = await instructionShimStatus(root, agent);
    if (agent === "cursor") {
      const rulePath = path.join(root, ".cursor", "rules", "workspace-template-workflow.mdc");
      const ruleExists = await exists(rulePath);
      results.push({ agent, exists: ruleExists, inSync: ruleExists && (await readFile(rulePath, "utf8")) === cursorRule(), ...instruction });
      continue;
    }
    const relativeDestination = PROJECTIONS[agent];
    if (!relativeDestination) continue;
    const destination = path.join(root, relativeDestination);
    const destinationExists = await exists(destination);
    let inSync = destinationExists;
    if (inSync) {
      for (const name of names) {
        const projected = path.join(destination, name);
        if (!(await exists(projected)) || (await hashDirectory(path.join(canonicalRoot, name))) !== (await hashDirectory(projected))) {
          inSync = false;
          break;
        }
      }
    }
    results.push({ agent, path: relativeDestination, exists: destinationExists, inSync, ...instruction });
  }
  return { canonicalHash, skillNames: names, results };
}
