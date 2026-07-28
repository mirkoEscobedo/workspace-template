import { randomUUID } from "node:crypto";
import { lstat, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { createCheckpoint, createFileBackup, restoreFileBackup } from "../checkpoints/index.js";
import { doctorProject } from "../doctor.js";
import {
  ensureDirectory,
  isPathInside,
  hashDirectory,
  readJson,
  writeBytesAtomic,
  writeJson,
  removePath,
} from "../fs-utils.js";
import { assertPlanApplicable, assertValidPlan } from "../plans/index.js";
import {
  appendJournal,
  assertNotApplied,
  readJournal,
  writeReport,
} from "../plans/journal.js";
import { assertSafeUpgradePath, assertUpgradeQuiescent } from "./inspect.js";
import { assertLocalVerificationAuthority, sealVerificationInputs, upgradeVerificationAuthority } from "./plan.js";
import { UpgradeVerificationRunner, verifyWorkspace } from "../workspace/verify.js";
import { discoverWorkspace } from "../workspace/discover.js";
import { assetsRoot } from "../workspace-artifacts.js";
import { resolveProcessIdentity } from "../process-utils.js";

async function interruptedBackup(events) {
  const event = [...events].reverse().find((item) => item.event === "backup" && item.directory);
  if (!event) return undefined;
  return { directory: event.directory, digest: event.digest, manifest: await readJson(path.join(event.directory, "manifest.json")) };
}

function orderedOperations(operations) {
  const priority = (item) => item.path === ".agentic/managed-files.json" ? 40
    : [".agentic/config.json", ".agentic/profile.json"].includes(item.path) ? 30
      : [".agentic/skills.lock.json", ".agentic/managed-projections.json"].includes(item.path) ? 20
        : 10;
  return [...operations].sort((left, right) => priority(left) - priority(right) || left.path.localeCompare(right.path));
}

async function validateRecoveryBackup(plan, transaction, backup, reviewedPaths) {
  if (!isPathInside(transaction, backup.directory) || path.resolve(backup.manifest.root) !== path.resolve(plan.root)) {
    throw new Error("Interrupted upgrade backup is not bound to the sealed transaction");
  }
  if (!backup.digest || await hashDirectory(backup.directory) !== backup.digest) {
    throw new Error("Interrupted upgrade backup integrity check failed");
  }
  for (const record of Object.values(backup.manifest.files ?? {})) {
    if (!["absent", "directory", "symlink", "file"].includes(record.state)) throw new Error("Interrupted upgrade backup contains an invalid state");
  }
  const actual = Object.keys(backup.manifest.files ?? {}).sort();
  const expected = [...reviewedPaths].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Interrupted upgrade backup write set does not match the sealed plan");
  }
  for (const ancestor of backup.manifest.absentAncestors ?? []) {
    if (!ancestor || ancestor === "." || !actual.some((relative) => relative.startsWith(`${ancestor}/`) && backup.manifest.files[relative]?.state === "absent")) {
      throw new Error("Interrupted upgrade backup contains an invalid absent ancestor");
    }
  }
  for (const relative of actual) await assertSafeUpgradePath(plan.root, relative);
}

function validatePlannedState(operations) {
  for (const item of operations) {
    if (!item.content || !item.path.endsWith(".json")) continue;
    try {
      JSON.parse(Buffer.from(item.content, item.contentEncoding ?? "base64").toString("utf8"));
    } catch (error) {
      throw new Error(`Planned JSON is invalid for ${item.path}: ${error.message}`);
    }
  }
}

async function workspaceWithSealedVerificationAuthority(root, sealedAuthority) {
  const workspace = await discoverWorkspace(root, { workspace: "all", includeRootModule: true, includeOpaque: true });
  const currentAuthority = await upgradeVerificationAuthority(root, workspace);
  assertLocalVerificationAuthority(sealedAuthority);
  assertLocalVerificationAuthority(currentAuthority);
  if (JSON.stringify(currentAuthority) !== JSON.stringify(sealedAuthority)) {
    throw new Error("Workspace verification commands changed after the upgrade plan was sealed");
  }
  return workspace;
}

function assertPlannedVerificationInputsUntouched(plan) {
  const protectedPaths = plan.metadata?.verificationInputPaths ?? [];
  for (const operation of plan.operations) {
    const relative = operation.path?.replaceAll("\\", "/");
    if (relative && protectedPaths.some((input) => relative === input || relative.startsWith(`${input}/`))) {
      throw new Error(`Planned upgrade operation '${relative}' touches a sealed verification input`);
    }
  }
}

async function assertVerificationInputsUnchanged(root, plan) {
  const sealed = plan.metadata?.verificationInputs;
  if (!sealed?.hash || !Array.isArray(sealed.excludedPaths)) {
    throw new Error("Upgrade plan does not contain sealed verification inputs");
  }
  const current = await sealVerificationInputs(root, sealed.excludedPaths);
  if (JSON.stringify(current) !== JSON.stringify(sealed)) {
    throw new Error("Repository-local verification inputs changed after the upgrade plan was sealed");
  }
}

function sealedDependencyInstalls(authority) {
  const seen = new Set();
  return [...authority.modules, authority.root]
    .filter(Boolean)
    .map((entry) => entry.dependencyInstall)
    .filter((install) => {
      if (!install) return false;
      const key = JSON.stringify([install.command, install.args, install.cwd]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function installVerificationDependencies(root, authority, runner, options, context) {
  const results = [];
  for (const [index, install] of sealedDependencyInstalls(authority).entries()) {
    const cwd = path.join(root, ...install.cwd.split("/"));
    if (!isPathInside(root, cwd)) {
      throw new Error(`Sealed dependency install cwd escapes disposable verification copy: ${install.cwd}`);
    }
    const result = await runner(install.command, install.args, {
      cwd,
      timeout: options.timeout,
      maxOutputBytes: options.maxOutputBytes,
      signal: options.signal,
      phaseId: context.phaseId,
      stepId: `dependency-install:${index + 1}`,
    });
    const recorded = { ...result, state: result.status === 0 ? "passed" : "failed" };
    results.push(recorded);
    if (result.status !== 0) {
      throw new Error(`Dependency installation failed in disposable verification copy at ${install.cwd}`);
    }
  }
  return results;
}

async function fullVerification(root, options, sealedAuthority, context, frozenWorkspace, runtime) {
  const checkpointAuthority = await upgradeVerificationAuthority(root, frozenWorkspace);
  assertLocalVerificationAuthority(checkpointAuthority);
  if (JSON.stringify(checkpointAuthority) !== JSON.stringify(sealedAuthority)) {
    throw new Error("Disposable verification copy does not match the sealed verification authority");
  }
  const dependencyInstalls = sealedDependencyInstalls(sealedAuthority);
  let runner = runtime.runner;
  if (dependencyInstalls.length > 0 || !runtime.verifier) {
    const scratchRoot = path.join(root, ".agentic", "verification-scratch", context.phaseId);
    const scratchEnvironment = {
      ...process.env,
      HOME: path.join(scratchRoot, "home"),
      USERPROFILE: path.join(scratchRoot, "home"),
      APPDATA: path.join(scratchRoot, "appdata"),
      LOCALAPPDATA: path.join(scratchRoot, "localappdata"),
      TEMP: path.join(scratchRoot, "temp"),
      TMP: path.join(scratchRoot, "temp"),
      TMPDIR: path.join(scratchRoot, "temp"),
    };
    for (const directory of new Set(Object.values(scratchEnvironment)
      .filter((value) => typeof value === "string" && value.startsWith(scratchRoot)))) {
      await ensureDirectory(directory);
    }
    if (!runner) {
      const ownedRunner = new UpgradeVerificationRunner({
        root,
        runId: options.runId ?? `upgrade-${context.planId}`,
        planId: context.planId,
        phaseId: context.phaseId,
        timeoutMs: options.timeout,
        terminationGraceMs: options.terminationGraceMs,
        maxOutputBytes: options.maxOutputBytes,
        signal: options.signal,
        environment: scratchEnvironment,
      });
      runner = ownedRunner.run.bind(ownedRunner);
    }
  }
  const dependencyInstallResults = dependencyInstalls.length > 0
    ? await installVerificationDependencies(root, sealedAuthority, runner, options, context)
    : [];
  if (runtime.verifier) {
    return { ...await runtime.verifier(root), dependencyInstalls: dependencyInstallResults };
  }
  const report = await verifyWorkspace(root, frozenWorkspace, {
    scope: "all",
    concurrency: 1,
    timeoutMs: options.timeout,
    maxOutputBytes: options.maxOutputBytes,
    signal: options.signal,
    phaseId: context.phaseId,
    runner,
  });
  if (!report.ok || report.results.some((item) => item.state !== "passed")) {
    const failed = report.results.filter((item) => item.state !== "passed").map((item) => `${item.module}: ${item.state}`).join(", ");
    throw new Error(`Full workspace verification failed: ${failed}`);
  }
  if (frozenWorkspace.rootModule) {
    const rootReport = await verifyWorkspace(root, frozenWorkspace, {
      scope: "root",
      concurrency: 1,
      timeoutMs: options.timeout,
      maxOutputBytes: options.maxOutputBytes,
      signal: options.signal,
      phaseId: context.phaseId,
      runner,
    });
    if (!rootReport.ok || rootReport.results.some((item) => item.state !== "passed")) {
      throw new Error("Full workspace root verification failed");
    }
    report.rootAggregate = rootReport;
  }
  report.dependencyInstalls = dependencyInstallResults;
  return report;
}

async function runAtomicVerification(root, options, sealedAuthority, context, frozenWorkspace, runtime) {
  await workspaceWithSealedVerificationAuthority(root, sealedAuthority);
  const checkpoint = await createCheckpoint(root, "copy");
  try {
    return await fullVerification(
      checkpoint.root,
      options,
      sealedAuthority,
      context,
      frozenWorkspace,
      runtime,
    );
  } finally {
    await checkpoint.cleanup();
  }
}

function validMutexOwner(owner) {
  return owner?.version === 2
    && Number.isInteger(owner.pid) && owner.pid > 0
    && typeof owner.processStartIdentity === "string" && owner.processStartIdentity.length > 0
    && typeof owner.token === "string" && owner.token.length > 0
    && typeof owner.planId === "string" && owner.planId.length > 0;
}

async function readMutexOwner(ownerPath) {
  try {
    const details = await lstat(ownerPath);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error("Another workspace upgrade owns a non-directory transaction claim");
    }
    return JSON.parse(await readFile(path.join(ownerPath, "owner.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    if (/Another workspace upgrade/u.test(error.message)) throw error;
    throw new Error("Another workspace upgrade owns an unreadable transaction claim");
  }
}

async function createMutexOwnerClaim(lockPath, owner) {
  const ownerPath = path.join(lockPath, "owner");
  const candidate = path.join(lockPath, `.candidate-${owner.token}-${randomUUID()}`);
  await ensureDirectory(candidate);
  await writeJson(path.join(candidate, "owner.json"), owner);
  try {
    await rename(candidate, ownerPath);
    return true;
  } catch (error) {
    if (await readMutexOwner(ownerPath)) return false;
    throw error;
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
}

/**
 * Acquire the repository upgrade mutex. The start identity prevents PID reuse
 * from making a stale owner look live; the random token protects release from
 * unlinking a replacement owner.
 */
export async function acquireUpgradeMutex(lockPath, options) {
  const resolveIdentity = options.resolveIdentity ?? resolveProcessIdentity;
  const self = options.processStartIdentity
    ? { state: "alive", identity: options.processStartIdentity }
    : await resolveIdentity(options.pid ?? process.pid);
  if (self.state !== "alive" || !self.identity) {
    throw new Error(`Cannot acquire workspace upgrade lock: current process identity is unresolved${self.reason ? ` (${self.reason})` : ""}`);
  }
  const owner = {
    version: 2,
    pid: options.pid ?? process.pid,
    processStartIdentity: self.identity,
    token: options.token ?? randomUUID(),
    planId: options.planId,
  };
  if (!validMutexOwner(owner)) throw new Error("Cannot acquire workspace upgrade lock with invalid owner identity");
  await ensureDirectory(path.dirname(lockPath));
  try {
    const details = await lstat(lockPath);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error("Another workspace upgrade owns a legacy or non-directory transaction lock; refusing unsafe migration");
    }
  } catch (error) {
    if (error.code === "ENOENT") await ensureDirectory(lockPath);
    else throw error;
  }
  const ownerPath = path.join(lockPath, "owner");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await createMutexOwnerClaim(lockPath, owner)) {
      return {
        owner,
        async release() {
          const current = await readMutexOwner(ownerPath);
          if (!validMutexOwner(current)
            || current.pid !== owner.pid
            || current.processStartIdentity !== owner.processStartIdentity
            || current.token !== owner.token
            || current.planId !== owner.planId) return false;
          const claimed = path.join(lockPath, `.release-${owner.token}-${randomUUID()}`);
          try {
            await rename(ownerPath, claimed);
          } catch (error) {
            if (error.code === "ENOENT") return false;
            throw error;
          }
          const moved = await readMutexOwner(claimed);
          if (!validMutexOwner(moved)
            || moved.pid !== owner.pid
            || moved.processStartIdentity !== owner.processStartIdentity
            || moved.token !== owner.token
            || moved.planId !== owner.planId) {
            if (!(await readMutexOwner(ownerPath))) await rename(claimed, ownerPath);
            return false;
          }
          await options.hooks?.afterReleaseClaim?.({ lockPath, claimedPath: claimed, owner });
          await rm(claimed, { recursive: true, force: true });
          return true;
        },
      };
    }

    const existing = await readMutexOwner(ownerPath);
    if (!existing) continue;
    if (!validMutexOwner(existing)) {
      throw new Error("Another workspace upgrade owns an invalid transaction claim; refusing stale recovery");
    }
    const identity = await resolveIdentity(existing.pid);
    if (identity.state === "unknown") {
      throw new Error(`Another workspace upgrade may be active (PID ${existing.pid}); its live process identity is unresolved`);
    }
    if (identity.state === "alive" && identity.identity === existing.processStartIdentity) {
      throw new Error(`Another workspace upgrade is active (PID ${existing.pid})`);
    }

    const reclaimed = path.join(lockPath, `.reclaim-${owner.token}-${randomUUID()}`);
    try {
      await rename(ownerPath, reclaimed);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const moved = await readMutexOwner(reclaimed);
    if (!moved) throw new Error("Workspace upgrade lock changed during stale recovery");
    if (moved.token !== existing.token
      || moved.pid !== existing.pid
      || moved.processStartIdentity !== existing.processStartIdentity) {
      if (!(await readMutexOwner(ownerPath))) await rename(reclaimed, ownerPath);
      throw new Error("Workspace upgrade lock owner changed during stale recovery");
    }
    await options.hooks?.afterReclaimClaim?.({ lockPath, claimedPath: reclaimed, owner: existing });
    await rm(reclaimed, { recursive: true, force: true });
  }
  throw new Error("Could not acquire the workspace upgrade lock");
}

async function validateStagedState(root, operations) {
  if (operations.length === 0) return;
  const checkpoint = await createCheckpoint(root, "copy");
  try {
    for (const item of operations) {
      const target = path.join(checkpoint.root, ...item.path.split("/"));
      if (item.kind === "delete-upgrade-managed") await removePath(target);
      else await writeBytesAtomic(target, Buffer.from(item.content, item.contentEncoding ?? "base64"));
    }
    const report = await doctorProject(checkpoint.root);
    if (!report.ok) throw new Error(`Staged upgrade doctor failed:\n- ${report.errors.join("\n- ")}`);
  } finally {
    await checkpoint.cleanup();
  }
}

async function applyUpgradePlanInternal(plan, options = {}, runtime = {}) {
  assertValidPlan(plan, { command: "upgrade" });
  const root = path.resolve(plan.root);
  assertPlannedVerificationInputsUntouched(plan);
  if (!runtime.verifier && !plan.approvals?.network) {
    throw new Error("Full verification requires the sealed --allow-network approval");
  }
  await assertVerificationInputsUnchanged(root, plan);
  const writeOperations = orderedOperations(plan.operations.filter((item) => item.kind !== "noop" && (item.content || item.kind === "delete-upgrade-managed")));
  const paths = [...new Set(writeOperations.map((item) => item.path))];
  await assertUpgradeQuiescent(root, plan.planId);
  const existingEvents = await readJournal(root, plan.planId);
  const alreadyCompleted = existingEvents.some((event) => event.event === "finish" && event.status === "completed");
  const existingPrior = alreadyCompleted && writeOperations.length === 0 && options.allowCurrentReplay
    ? []
    : await assertNotApplied(root, plan.planId);
  if (plan.metadata?.incomingCatalogHash !== await hashDirectory(assetsRoot)) {
    throw new Error("Incoming package catalog changed after the upgrade plan was sealed");
  }
  assertLocalVerificationAuthority(plan.metadata.verificationCommands);
  if (existingPrior.length === 0) {
    await assertPlanApplicable(plan, { expected: { command: "upgrade" }, allowedDirtyPaths: options.allowedDirtyPaths });
  }
  const frozenWorkspace = await workspaceWithSealedVerificationAuthority(root, plan.metadata.verificationCommands);

  const transaction = path.join(root, ".agentic", "transactions", plan.planId);
  const lockPath = path.join(root, ".agentic", "transactions", "upgrade.lock");
  await ensureDirectory(path.dirname(lockPath));
  const transactionLock = await acquireUpgradeMutex(lockPath, { planId: plan.planId });
  try {
    await assertUpgradeQuiescent(root, plan.planId);
    const lockedEvents = await readJournal(root, plan.planId);
    const lockedCompleted = lockedEvents.some((event) => event.event === "finish" && event.status === "completed");
    const prior = lockedCompleted && writeOperations.length === 0 && options.allowCurrentReplay
      ? []
      : await assertNotApplied(root, plan.planId);
    if (prior.length > 0) {
      const backup = await interruptedBackup(prior);
      if (!backup) throw new Error(`Interrupted upgrade ${plan.planId} has no recoverable backup`);
      await validateRecoveryBackup(plan, transaction, backup, paths);
      await restoreFileBackup(backup);
      await appendJournal(root, plan.planId, { event: "recovered", status: "restored" });
    }
    if (plan.metadata?.incomingCatalogHash !== await hashDirectory(assetsRoot)) {
      throw new Error("Incoming package catalog changed after the upgrade plan was sealed");
    }
    await assertPlanApplicable(plan, { expected: { command: "upgrade" }, allowedDirtyPaths: options.allowedDirtyPaths });
    await assertVerificationInputsUnchanged(root, plan);
    await ensureDirectory(transaction);
    const preDoctor = await doctorProject(root);
    const repairable = new Set(writeOperations.filter((item) => item.kind === "create-upgrade-managed").map((item) => item.path));
    const blockingDoctorErrors = preDoctor.errors.filter((error) => ![...repairable].some((relative) => error.includes(relative)));
    if (blockingDoctorErrors.length > 0) throw new Error(`Pre-upgrade doctor failed:\n- ${blockingDoctorErrors.join("\n- ")}`);
    const preVerification = await runAtomicVerification(
      root,
      options,
      plan.metadata.verificationCommands,
      { planId: plan.planId, phaseId: "pre-mutation" },
      frozenWorkspace,
      runtime,
    );
    await assertVerificationInputsUnchanged(root, plan);
    await assertUpgradeQuiescent(root, plan.planId);
    await assertPlanApplicable(plan, { expected: { command: "upgrade" }, allowedDirtyPaths: options.allowedDirtyPaths });
    validatePlannedState(writeOperations);
    await validateStagedState(root, writeOperations);
    await writeJson(path.join(transaction, "plan.json"), plan);
    for (const relative of paths) await assertSafeUpgradePath(root, relative);
    const backup = await createFileBackup(root, paths, { baseDirectory: transaction });
    backup.digest = await hashDirectory(backup.directory);
    await appendJournal(root, plan.planId, { event: "backup", status: "ready", directory: backup.directory, digest: backup.digest });
    await appendJournal(root, plan.planId, { event: "start", status: "running", operationCount: writeOperations.length });
    try {
      for (const item of writeOperations) {
        await assertSafeUpgradePath(root, item.path);
        const target = path.join(root, ...item.path.split("/"));
        if (item.kind === "delete-upgrade-managed") await removePath(target);
        else await writeBytesAtomic(target, Buffer.from(item.content, item.contentEncoding ?? "base64"));
        await appendJournal(root, plan.planId, { event: "operation", status: "applied", kind: item.kind, path: item.path });
      }
      const doctor = await doctorProject(root);
      if (!doctor.ok) throw new Error(`Post-upgrade doctor failed:\n- ${doctor.errors.join("\n- ")}`);
      await assertVerificationInputsUnchanged(root, plan);
      const postVerification = await runAtomicVerification(
        root,
        options,
        plan.metadata.verificationCommands,
        { planId: plan.planId, phaseId: "post-apply" },
        frozenWorkspace,
        runtime,
      );
      await assertVerificationInputsUnchanged(root, plan);
      await assertUpgradeQuiescent(root, plan.planId);
      const report = {
        ok: true, command: "upgrade", planId: plan.planId, root,
        status: writeOperations.length === 0 ? "current" : "upgraded",
        applied: paths, doctor, preVerification, postVerification, transactionPlan: path.join(transaction, "plan.json"),
      };
      await writeReport(root, plan.planId, report, "upgrade");
      await assertUpgradeQuiescent(root, plan.planId);
      await appendJournal(root, plan.planId, { event: "finish", status: "completed" });
      return report;
    } catch (error) {
      await validateRecoveryBackup(plan, transaction, backup, paths);
      await restoreFileBackup(backup);
      await appendJournal(root, plan.planId, { event: "rollback", status: "restored" });
      await appendJournal(root, plan.planId, { event: "finish", status: "failed", message: error.message });
      throw error;
    }
  } finally {
    await transactionLock.release();
  }
}

export async function applyUpgradePlan(plan, options = {}) {
  return applyUpgradePlanInternal(plan, options, {});
}

/** Package-internal test harness; intentionally not re-exported from src/index.js. */
export function createUpgradeApplyTestHarness(dependencies = {}) {
  return {
    apply(plan, options = {}) {
      return applyUpgradePlanInternal(plan, options, {
        verifier: dependencies.verifier,
        runner: dependencies.runner,
      });
    },
  };
}
