import { mkdtemp, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  appendJournal,
  assertNotApplied,
  assertPlanApplicable,
  assertValidPlan,
  writeReport,
} from "../plans/index.js";
import {
  copyDirectory,
  ensureDirectory,
  exists,
  hashBuffer,
  hashDirectory,
  readJson,
  removePath,
  writeBytesAtomic,
  writeJson,
} from "../fs-utils.js";
import { validateSkillTree } from "../doctor.js";
import { syncSkills } from "../sync.js";
import { PACKAGE_VERSION } from "../constants.js";
import { buildSkillsLock } from "./baseline.js";

function decode(record) {
  if (!record.content) throw new Error(`Missing merged content for ${record.path}`);
  const content = Buffer.from(record.content, record.encoding ?? "base64");
  if (record.hash && hashBuffer(content) !== record.hash) throw new Error(`Merged content hash mismatch for ${record.path}`);
  return content;
}

async function writeSkillTree(root, skill) {
  await ensureDirectory(root);
  for (const file of skill.files) {
    if (["delete", "delete-incoming", "delete-local"].includes(file.action)) continue;
    if (file.action === "conflict") throw new Error(`Unresolved skill conflict: ${skill.name}/${file.path}`);
    await writeBytesAtomic(path.join(root, ...file.path.split("/")), decode(file));
  }
}

async function swapDirectory(staged, destination) {
  const backup = `${destination}.caw-backup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const present = await exists(destination);
  if (present) await rename(destination, backup);
  try {
    await rename(staged, destination);
    return { destination, backup: present ? backup : null };
  } catch (error) {
    if (present && await exists(backup)) await rename(backup, destination);
    throw error;
  }
}

async function restoreSwap(record) {
  if (!record) return;
  await removePath(record.destination);
  if (record.backup && await exists(record.backup)) await rename(record.backup, record.destination);
}

async function finalizeSwap(record) {
  if (record?.backup) await removePath(record.backup);
}

export async function applySkillUpdatePlan(plan, options = {}) {
  assertValidPlan(plan, { command: "skills-update" });
  await assertNotApplied(plan.root, plan.planId);
  await assertPlanApplicable(plan, { allowDirty: options.allowDirty, allowedDirtyPaths: options.allowedDirtyPaths });
  if (plan.approvals.riskySkillPermissions && !options.allowRiskyToolChanges) {
    throw new Error("Skill update contains risky executable/tool/network changes; pass --allow-risky-tool-changes after review");
  }
  if (plan.approvals.skillRemoval && !options.allowSkillRemoval) {
    throw new Error("Skill update removes one or more installed skills; pass --allow-skill-removal after reviewing the incoming catalog");
  }
  const incomingRoot = path.resolve(plan.skillUpdate.incomingRoot);
  if (!(await exists(incomingRoot))) throw new Error(`Incoming skill catalog no longer exists: ${incomingRoot}`);
  const incomingCatalogHash = await hashDirectory(incomingRoot);
  if (incomingCatalogHash !== plan.skillUpdate.incomingCatalogHash) {
    throw new Error("Incoming skill catalog changed after planning; create and review a new update plan");
  }

  const partial = Boolean(plan.skillUpdate.partial || options.partial);
  const eligible = plan.skillUpdate.skills.filter((skill) => skill.conflicts.length === 0
    && (!skill.risk.risky || options.allowRiskyToolChanges)
    && (!skill.removal || options.allowSkillRemoval));
  const skipped = plan.skillUpdate.skills.filter((skill) => !eligible.includes(skill));
  if (!partial && skipped.length > 0) throw new Error(`Atomic skill update blocked by: ${skipped.map((skill) => skill.name).join(", ")}`);

  const stagingParent = path.join(plan.root, ".agentic");
  await ensureDirectory(stagingParent);
  const temp = await mkdtemp(path.join(stagingParent, ".caw-skill-update-"));
  const stagedCanonical = path.join(temp, "skills");
  const stagedBaselines = path.join(temp, "baselines");
  const canonicalDestination = path.join(plan.root, ".agentic", "skills");
  const baselineDestination = path.join(plan.root, ".agentic", "skill-baselines");
  const lockPath = path.join(plan.root, ".agentic", "skills.lock.json");
  const oldLock = await readJson(lockPath);
  let canonicalSwap;
  let baselineSwap;
  await appendJournal(plan.root, plan.planId, { status: "running", event: "stage" });
  try {
    await copyDirectory(canonicalDestination, stagedCanonical);
    await copyDirectory(baselineDestination, stagedBaselines);
    for (const skill of eligible) {
      const stagedCanonicalSkill = path.join(stagedCanonical, skill.name);
      const stagedBaselineSkill = path.join(stagedBaselines, skill.name);
      await rm(stagedCanonicalSkill, { recursive: true, force: true });
      await rm(stagedBaselineSkill, { recursive: true, force: true });

      // Canonical is the project-owned merge. Baseline is the exact incoming
      // upstream snapshot so future updates can still distinguish local edits.
      if (skill.incomingHash === null) continue;
      await writeSkillTree(stagedCanonicalSkill, skill);
      const incomingSkill = path.join(plan.skillUpdate.incomingRoot, skill.name);
      if (!(await exists(incomingSkill))) throw new Error(`Incoming skill disappeared after planning: ${skill.name}`);
      await copyDirectory(incomingSkill, stagedBaselineSkill);
    }
    const validation = await validateSkillTree(stagedCanonical);
    if (!validation.ok && validation.errors.length > 0) {
      throw new Error(`Staged skill catalog is invalid:\n- ${validation.errors.join("\n- ")}`);
    }

    // Projection preflight occurs before canonical replacement.
    await syncSkills(plan.root, undefined, { dryRun: true, canonicalRoot: stagedCanonical });
    canonicalSwap = await swapDirectory(stagedCanonical, canonicalDestination);
    baselineSwap = await swapDirectory(stagedBaselines, baselineDestination);
    await buildSkillsLock(plan.root, {
      version: plan.skillUpdate.sourceVersion ?? PACKAGE_VERSION,
      catalogHash: plan.skillUpdate.incomingCatalogHash,
    });
    const projection = await syncSkills(plan.root);
    await finalizeSwap(canonicalSwap);
    await finalizeSwap(baselineSwap);

    const report = {
      version: 1,
      planId: plan.planId,
      command: plan.command,
      status: "completed",
      appliedAt: new Date().toISOString(),
      appliedSkills: eligible.map((skill) => skill.name),
      skippedSkills: skipped.map((skill) => ({ name: skill.name, conflicts: skill.conflicts, risk: skill.risk })),
      projection,
      ok: true,
    };
    await writeReport(plan.root, plan.planId, report, "skills-update");
    await appendJournal(plan.root, plan.planId, { status: "completed", event: "finish" });
    return report;
  } catch (error) {
    await restoreSwap(baselineSwap).catch(() => {});
    await restoreSwap(canonicalSwap).catch(() => {});
    await writeJson(lockPath, oldLock).catch(() => {});
    const report = {
      version: 1,
      planId: plan.planId,
      command: plan.command,
      status: "failed",
      failedAt: new Date().toISOString(),
      error: String(error.message ?? error),
      ok: false,
    };
    await writeReport(plan.root, plan.planId, report, "skills-update");
    await appendJournal(plan.root, plan.planId, { status: "failed", event: "failed", error: report.error });
    throw error;
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
}
