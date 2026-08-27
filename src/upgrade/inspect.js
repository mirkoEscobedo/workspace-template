import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import {
  exists,
  listDirectories,
  listFiles,
  readJson,
  readTextIfExists,
} from "../fs-utils.js";

const SUPPORTED = Object.freeze({
  config: new Set([1, 2, 3, 4]),
  profile: new Set([1, 2, 3]),
  managed: new Set([1, 2, 3]),
  skills: new Set([1, 2]),
});

async function requiredJson(root, relative, label) {
  const file = path.join(root, ...relative.split("/"));
  if (!(await exists(file))) throw new Error(`${label} is missing; run workspace-template adopt . first`);
  try {
    return await readJson(file);
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error.message}`);
  }
}

function supported(value, versions, label) {
  if (!versions.has(value.version)) throw new Error(`Unsupported future ${label} version ${value.version}`);
}

export async function assertSafeUpgradePath(rootDirectory, relative) {
  const root = path.resolve(rootDirectory);
  let current = root;
  for (const segment of relative.split("/").filter(Boolean)) {
    current = path.join(current, segment);
    if (!(await exists(current))) continue;
    const stats = await lstat(current);
    if (stats.isSymbolicLink()) {
      const resolved = await realpath(current);
      throw new Error(`Upgrade path crosses a symlink (${relative} -> ${resolved}); replace it with an in-tree directory or file before upgrading`);
    }
  }
}

export async function assertUpgradeQuiescent(root, excludePlanId) {
  for (const directory of await listDirectories(path.join(root, ".agentic", "transactions"))) {
    if (path.basename(directory) === excludePlanId) continue;
    const raw = await readTextIfExists(path.join(directory, "journal.jsonl"));
    if (!raw) continue;
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const last = lines.length ? JSON.parse(lines.at(-1)) : undefined;
    const terminal = last?.status === "completed" || last?.status === "failed";
    if (!terminal) throw new Error(`Active transaction blocks upgrade: ${path.basename(directory)}`);
  }
  const leases = (await listFiles(path.join(root, ".agent", "leases")))
    .filter((file) => {
      const name = path.basename(file);
      return name !== ".gitkeep" && !name.endsWith(".final.json");
    });
  if (leases.length > 0) throw new Error(`Open process lease blocks upgrade: ${path.relative(root, leases[0])}`);
}

export async function inspectUpgradeWorkspace(rootDirectory, options = {}) {
  const root = path.resolve(rootDirectory);
  try {
    await assertUpgradeQuiescent(root);
  } catch (error) {
    if (options.reportRecovery) return { root, recoveryRequired: error.message };
    throw error;
  }
  const config = await requiredJson(root, ".agentic/config.json", ".agentic/config.json");
  const profile = await requiredJson(root, ".agentic/profile.json", ".agentic/profile.json");
  const managed = await requiredJson(root, ".agentic/managed-files.json", ".agentic/managed-files.json");
  const skillsLock = await requiredJson(root, ".agentic/skills.lock.json", ".agentic/skills.lock.json");
  if (config.generator !== "workspace-template" || managed.generator !== "workspace-template") {
    throw new Error("Repository is not owned by workspace-template; run workspace-template adopt . first");
  }
  supported(config, SUPPORTED.config, "config");
  supported(profile, SUPPORTED.profile, "profile");
  supported(managed, SUPPORTED.managed, "managed-files");
  supported(skillsLock, SUPPORTED.skills, "skills lock");
  const explicitModes = [config.mode, profile.mode].filter((value) => value !== undefined);
  if (explicitModes.some((value) => !["generated", "adopted"].includes(value))) {
    throw new Error(`Unsupported workspace mode '${explicitModes.find((value) => !["generated", "adopted"].includes(value))}'`);
  }
  if (new Set(explicitModes).size > 1) throw new Error("Config/profile workspace modes do not match");
  const hasCreatedAt = Object.hasOwn(config, "createdAt");
  const hasAdoptedAt = Object.hasOwn(config, "adoptedAt");
  if (hasCreatedAt && hasAdoptedAt) throw new Error("Workspace provenance is ambiguous: both createdAt and adoptedAt are present");
  let mode = explicitModes[0];
  if (!mode) {
    if (hasCreatedAt === hasAdoptedAt) throw new Error("Workspace provenance is ambiguous: exactly one origin timestamp is required");
    mode = hasCreatedAt ? "generated" : "adopted";
  }
  if ((mode === "generated" && hasAdoptedAt) || (mode === "adopted" && hasCreatedAt)) {
    throw new Error(`Workspace provenance contradicts explicit mode '${mode}'`);
  }
  return {
    root,
    config,
    profile,
    managed,
    skillsLock,
    mode,
    fromVersion: config.generatorVersion ?? managed.generatorVersion ?? skillsLock.source?.version ?? "legacy",
  };
}
