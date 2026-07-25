import path from "node:path";
import { createPlan, repositoryPreconditions } from "../plans/index.js";
import { assetsSkills } from "../workspace-artifacts.js";
import { exists, hashDirectory, readJson, toPosixPath } from "../fs-utils.js";
import { bundledSkillCatalog, readSkillTree, skillRiskDiff } from "./catalog.js";
import { ensureSkillBaselines } from "./baseline.js";
import { contentRecord, threeWayMergeText } from "./merge.js";

function unionKeys(...maps) {
  return [...new Set(maps.flatMap((map) => [...map.keys()]))].sort();
}

function executableFile(relative) {
  return relative.startsWith("scripts/") || /\.(?:js|mjs|cjs|py|sh|ps1|cmd|bat)$/i.test(relative);
}

function compareFile(relative, base, local, incoming) {
  if (base === undefined && local === undefined && incoming !== undefined) return { action: "add-incoming", content: incoming };
  if (base === undefined && local !== undefined && incoming === undefined) return { action: "keep-local", content: local };
  if (base === undefined && local !== undefined && incoming !== undefined) {
    if (local.equals(incoming)) return { action: "identical-add", content: local };
    return { action: "conflict", reason: "both local and incoming added different content" };
  }
  if (base !== undefined && local === undefined && incoming === undefined) return { action: "delete" };
  if (base !== undefined && local === undefined && incoming !== undefined) {
    if (incoming.equals(base)) return { action: "delete-local" };
    return { action: "conflict", reason: "incoming changed a file deleted locally" };
  }
  if (base !== undefined && local !== undefined && incoming === undefined) {
    if (local.equals(base)) return { action: "delete-incoming" };
    return { action: "conflict", reason: "incoming deleted a locally modified file" };
  }
  const localChanged = !local.equals(base);
  const incomingChanged = !incoming.equals(base);
  if (executableFile(relative) && localChanged && incomingChanged && !local.equals(incoming)) {
    return { action: "conflict", reason: "executable content changed on both sides" };
  }
  const merged = threeWayMergeText(base, local, incoming);
  if (merged.status === "conflict") {
    return { action: "conflict", reason: merged.reason ?? "overlapping local and incoming edits", details: merged.conflicts };
  }
  return { action: merged.status, content: merged.content };
}

async function skillPlan(root, name, incomingRoot, catalog, lock) {
  const baselinePath = path.resolve(root, lock.skills?.[name]?.baselinePath ?? `.agentic/skill-baselines/${name}`);
  const localPath = path.resolve(root, lock.skills?.[name]?.path ?? `.agentic/skills/${name}`);
  const incomingPath = path.resolve(incomingRoot, name);
  const base = (await exists(baselinePath)) ? await readSkillTree(baselinePath) : new Map();
  const local = (await exists(localPath)) ? await readSkillTree(localPath) : new Map();
  const incoming = (await exists(incomingPath)) ? await readSkillTree(incomingPath) : new Map();
  const files = [];
  const conflicts = [];
  for (const relative of unionKeys(base, local, incoming)) {
    const result = compareFile(relative, base.get(relative), local.get(relative), incoming.get(relative));
    const record = { path: relative, action: result.action, reason: result.reason, details: result.details };
    if (result.content !== undefined) Object.assign(record, contentRecord(result.content));
    files.push(record);
    if (result.action === "conflict") conflicts.push(`${name}/${relative}: ${result.reason}`);
  }
  const baselineRisk = { risk: lock.skills?.[name]?.risk ?? {} };
  const risk = skillRiskDiff(baselineRisk, catalog.skills[name]);
  const noChange = new Set(["local", "keep-local", "identical", "identical-add"]);
  return {
    name,
    baselinePath: toPosixPath(path.relative(root, baselinePath)),
    localPath: toPosixPath(path.relative(root, localPath)),
    incomingHash: catalog.skills[name]?.hash ?? null,
    localHash: (await exists(localPath)) ? await hashDirectory(localPath) : null,
    baselineHash: (await exists(baselinePath)) ? await hashDirectory(baselinePath) : null,
    files,
    conflicts,
    risk,
    changed: files.some((file) => !noChange.has(file.action)),
  };
}

export async function planSkillUpdate(rootDirectory, options = {}) {
  const root = path.resolve(rootDirectory);
  const incomingRoot = path.resolve(options.incomingRoot ?? assetsSkills);
  const lock = await ensureSkillBaselines(root);
  const catalog = await bundledSkillCatalog(incomingRoot);
  const selected = options.skills?.length ? [...new Set(options.skills)].sort() : Object.keys(lock.skills ?? {}).sort();
  const unknown = selected.filter((name) => !lock.skills?.[name] && !catalog.skills[name]);
  if (unknown.length > 0) throw new Error(`Unknown selected skill(s): ${unknown.join(", ")}`);
  const skills = [];
  const blocking = [];
  const warnings = [];
  for (const name of selected) {
    const item = await skillPlan(root, name, incomingRoot, catalog, lock);
    item.removal = item.incomingHash === null;
    skills.push(item);
    blocking.push(...item.conflicts);
    if (item.removal && !options.allowSkillRemoval) {
      blocking.push(`${name}: incoming catalog removes this installed skill; review and pass --allow-skill-removal`);
    }
    if (item.risk.risky && !options.allowRiskyToolChanges) {
      blocking.push(`${name}: incoming skill adds executable, shell, network, or tool-permission behavior; review and pass --allow-risky-tool-changes`);
    }
  }
  const partial = Boolean(options.partial);
  const preconditionPaths = [".agentic/skills.lock.json"];
  for (const name of selected) preconditionPaths.push(`.agentic/skills/${name}`, `.agentic/skill-baselines/${name}`);
  const preconditions = await repositoryPreconditions(root, preconditionPaths, { allowDirty: options.allowDirty });
  if (partial && blocking.length > 0) warnings.push("Partial mode will skip conflicted or unapproved risky skills; every skipped skill remains unchanged.");

  return createPlan({
    command: "skills-update",
    root,
    scope: { skills: selected, incomingRoot },
    preconditions,
    approvals: {
      network: false,
      lifecycleScripts: false,
      semanticChanges: false,
      riskySkillPermissions: skills.some((item) => item.risk.risky),
      skillRemoval: skills.some((item) => item.removal),
      dirtyTree: Boolean(options.allowDirty),
    },
    verification: [{ kind: "skill-structure" }, { kind: "doctor" }, { kind: "projection-sync" }],
    rollback: { strategy: "staged-directory-swap" },
    warnings,
    conflicts: partial ? [] : blocking,
    canApply: partial || blocking.length === 0,
    skillUpdate: {
      incomingRoot,
      incomingCatalogHash: await hashDirectory(incomingRoot),
      sourceVersion: options.to ?? null,
      partial,
      allowRiskyToolChanges: Boolean(options.allowRiskyToolChanges),
      allowSkillRemoval: Boolean(options.allowSkillRemoval),
      blocking,
      skills,
    },
  });
}

export async function checkSkillUpdates(rootDirectory, options = {}) {
  const plan = await planSkillUpdate(rootDirectory, { ...options, partial: true });
  return {
    root: plan.root,
    incomingRoot: plan.skillUpdate.incomingRoot,
    skills: plan.skillUpdate.skills.map((skill) => ({
      name: skill.name,
      changed: skill.changed,
      conflicts: skill.conflicts,
      risk: skill.risk,
    })),
    blocking: plan.skillUpdate.blocking,
  };
}
