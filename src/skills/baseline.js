import path from "node:path";
import {
  copyDirectory,
  ensureDirectory,
  exists,
  hashDirectory,
  listDirectories,
  removePath,
  writeJson,
  readJson,
} from "../fs-utils.js";
import { PACKAGE_VERSION } from "../constants.js";
import { assetsSkills } from "../workspace-artifacts.js";
import { inspectSkillCatalog } from "./catalog.js";

export async function materializeSkillBaselines(root, sourceRoot = assetsSkills, options = {}) {
  const destinationRoot = path.join(root, ".agentic", "skill-baselines");
  await ensureDirectory(destinationRoot);
  for (const source of await listDirectories(sourceRoot)) {
    const name = path.basename(source);
    const destination = path.join(destinationRoot, name);
    if (await exists(destination)) {
      if (!options.replace) continue;
      await removePath(destination);
    }
    await copyDirectory(source, destination);
  }
  return destinationRoot;
}

export async function buildSkillsLock(root, source = {}) {
  const canonicalRoot = path.join(root, ".agentic", "skills");
  const baselineRoot = path.join(root, ".agentic", "skill-baselines");
  const catalog = await inspectSkillCatalog(canonicalRoot);
  const skills = {};
  for (const [name, entry] of Object.entries(catalog.skills)) {
    const baselinePath = path.join(baselineRoot, name);
    if (!(await exists(baselinePath))) throw new Error(`Missing baseline for skill '${name}'`);
    skills[name] = {
      path: `.agentic/skills/${name}`,
      baselinePath: `.agentic/skill-baselines/${name}`,
      baselineHash: await hashDirectory(baselinePath),
      installedHash: entry.hash,
      files: entry.files,
      risk: entry.risk,
      localEditsAllowed: true,
    };
  }
  const lock = {
    version: 2,
    source: {
      package: "workspace-template",
      version: source.version ?? PACKAGE_VERSION,
      catalogHash: source.catalogHash ?? (await hashDirectory(canonicalRoot)),
    },
    installedAt: source.installedAt ?? new Date().toISOString(),
    skills,
  };
  await writeJson(path.join(root, ".agentic", "skills.lock.json"), lock);
  return lock;
}

export const buildSkillLock = buildSkillsLock;

export async function ensureSkillBaselines(root, sourceRoot = assetsSkills) {
  const canonical = path.join(root, ".agentic", "skills");
  if (!(await exists(canonical))) throw new Error("Canonical .agentic/skills directory is missing; adopt the repository first");
  const baselineRoot = path.join(root, ".agentic", "skill-baselines");
  if (!(await exists(baselineRoot))) await materializeSkillBaselines(root, canonical);
  const lockPath = path.join(root, ".agentic", "skills.lock.json");
  if (!(await exists(lockPath))) return buildSkillsLock(root, { version: PACKAGE_VERSION });
  const lock = await readJson(lockPath);
  if (![1, 2].includes(lock.version)) throw new Error(`Unsupported skills lock version ${lock.version}`);
  // Version-1 locks had hashes but no committed baseline. Only adopt the current
  // canonical tree as baseline when a baseline directory is already present;
  // otherwise the provenance would be fabricated.
  for (const [name, record] of Object.entries(lock.skills ?? {})) {
    const baseline = path.join(root, record.baselinePath ?? `.agentic/skill-baselines/${name}`);
    if (!(await exists(baseline))) {
      const local = path.join(root, record.path ?? `.agentic/skills/${name}`);
      const localHash = await hashDirectory(local);
      if (record.baselineHash && record.baselineHash !== localHash) {
        throw new Error(`Cannot create a trustworthy baseline for locally edited skill '${name}'`);
      }
      await copyDirectory(local, baseline);
    }
  }
  if (lock.version === 1) return buildSkillsLock(root, { version: lock.source?.version ?? PACKAGE_VERSION, installedAt: lock.installedAt });
  return lock;
}

export async function skillBaselineArtifacts() {
  const output = [];
  for (const directory of await listDirectories(assetsSkills)) {
    output.push({ name: path.basename(directory), source: directory });
  }
  return output;
}
