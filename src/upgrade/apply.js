import { randomUUID } from "node:crypto";
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCheckpoint, createFileBackup } from "../checkpoints/index.js";
import { doctorProject } from "../doctor.js";
import {
  ensureDirectory,
  isPathInside,
  hashDirectory,
  writeJson,
} from "../fs-utils.js";
import { assertPlanApplicable, assertValidPlan } from "../plans/index.js";
import {
  assertNotApplied,
  readJournal,
  writeReport,
} from "../plans/journal.js";
import { assertSafeUpgradePath, assertUpgradeQuiescent } from "./inspect.js";
import { assertLocalVerificationAuthority, sealVerificationInputs, upgradeVerificationAuthority } from "./plan.js";
import { UpgradeVerificationRunner, verifyWorkspace } from "../workspace/verify.js";
import { discoverWorkspace } from "../workspace/discover.js";
import { hashManagedAssetCatalog } from "../workspace-artifacts.js";
import { resolveProcessIdentity } from "../process-utils.js";
import { loadEffectiveUpgradeWorkspace } from "./workspace.js";
import {
  appendUpgradeJournal,
  assertAutomaticRecoveryAllowed,
  commitStagedOperation,
  ensureSafeTransactionDirectory,
  operationJournalRecord,
  stageUpgradeOperation,
  validatePlannedState,
  validateRecoveryBackup,
  validateStagedState,
} from "./transaction-safety.js";
import {
  assertDurableManualRecoveryAllowed,
  recoverAppliedTransaction,
  recoverInterruptedTransaction,
} from "./transaction-recovery.js";
import {
  existingVerificationInputPaths,
  hashVerificationInputs,
  inventoryCopiedVerificationInputs,
} from "./verification-inputs.js";
function orderedOperations(operations) {
  const priority = (item) => item.path === ".agentic/managed-files.json" ? 40
    : [".agentic/config.json", ".agentic/profile.json"].includes(item.path) ? 30
      : [".agentic/skills.lock.json", ".agentic/managed-projections.json"].includes(item.path) ? 20
        : 10;
  return [...operations].sort((left, right) => priority(left) - priority(right) || left.path.localeCompare(right.path));
}
async function workspaceWithSealedVerificationAuthority(root, sealedAuthority) {
  const discoveredWorkspace = await discoverWorkspace(root, { workspace: "all", includeRootModule: true, includeOpaque: true });
  const workspace = await loadEffectiveUpgradeWorkspace(root, discoveredWorkspace, { mergeDiscovered: true });
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
  const current = await sealVerificationInputs(root, sealed.excludedPaths, { includeInventory: true });
  const { inventoryPaths, ...comparable } = current;
  if (JSON.stringify(comparable) !== JSON.stringify(sealed)) {
    throw new Error("Repository-local verification inputs changed after the upgrade plan was sealed");
  }
  return inventoryPaths;
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
async function initializeVerificationGit(root, runner, options, context) {
  const results = [];
  const run = async (args, stepId) => {
    const result = await runner("git", args, {
      cwd: root,
      timeout: options.timeout,
      maxOutputBytes: options.maxOutputBytes,
      signal: options.signal,
      phaseId: context.phaseId,
      stepId,
    });
    const recorded = { ...result, state: result.status === 0 ? "passed" : "failed" };
    results.push(recorded);
    if (result.status !== 0) {
      throw new Error(`Git initialization failed in disposable verification copy at ${stepId}`);
    }
  };
  await run(["init", "--quiet"], "git-checkpoint:init");
  const excludePath = path.join(root, ".git", "info", "exclude");
  await ensureDirectory(path.dirname(excludePath));
  await writeFile(excludePath, [
    ".agent/",
    ".agentic/verification-scratch/",
    ".agentic/transactions/",
    "node_modules/",
    "",
  ].join("\n"));
  await run([
    "fetch", "--quiet", "--no-tags",
    context.gitRepository.root,
    context.gitRepository.head,
  ], "git-checkpoint:fetch");
  await run(["reset", "--mixed", "FETCH_HEAD"], "git-checkpoint:reset");
  await run(["add", "-A"], "git-checkpoint:add");
  await run([
    "-c", "user.name=workspace-template",
    "-c", "user.email=workspace-template@example.invalid",
    "commit", "--quiet", "--allow-empty", "--no-gpg-sign", "--no-verify",
    "-m", "workspace-template verification checkpoint",
  ], "git-checkpoint:commit");
  return results;
}

export function buildUpgradeVerificationEnvironment(
  root,
  phaseId,
  plan,
  ambientEnvironment = process.env,
) {
  const scratchRoot = path.join(root, ".agentic", "verification-scratch", phaseId);
  const environment = {
    ...ambientEnvironment,
    HOME: path.join(scratchRoot, "home"),
    USERPROFILE: path.join(scratchRoot, "home"),
    APPDATA: path.join(scratchRoot, "appdata"),
    LOCALAPPDATA: path.join(scratchRoot, "localappdata"),
    TEMP: path.join(scratchRoot, "temp"),
    TMP: path.join(scratchRoot, "temp"),
    TMPDIR: path.join(scratchRoot, "temp"),
  };
  delete environment.CARGO_HOME;
  delete environment.RUSTUP_HOME;
  delete environment.RUSTUP_TOOLCHAIN;
  if (plan?.approvals?.network) {
    const originalProfile = ambientEnvironment.USERPROFILE ?? ambientEnvironment.HOME;
    if (ambientEnvironment.CARGO_HOME ?? originalProfile) {
      environment.CARGO_HOME = ambientEnvironment.CARGO_HOME ?? path.join(originalProfile, ".cargo");
    }
    if (ambientEnvironment.RUSTUP_HOME ?? originalProfile) {
      environment.RUSTUP_HOME = ambientEnvironment.RUSTUP_HOME ?? path.join(originalProfile, ".rustup");
    }
    if (ambientEnvironment.RUSTUP_TOOLCHAIN) {
      environment.RUSTUP_TOOLCHAIN = ambientEnvironment.RUSTUP_TOOLCHAIN;
    }
  }
  return environment;
}

function verificationFailure(report) {
  const nonPassing = report.results.filter((item) => item.state !== "passed");
  const summary = nonPassing.map((item) => `${item.module}: ${item.state}`).join(", ");
  const moduleWithStep = nonPassing.find((item) => item.results.some((step) =>
    step.state === "failed" || step.state === "unknown" || step.status !== 0));
  const step = moduleWithStep?.results.find((item) =>
    item.state === "failed" || item.state === "unknown" || item.status !== 0);
  const command = step ? [step.command, ...(step.args ?? [])].join(" ") : undefined;
  const rawExcerpt = step?.stderr?.trim() || step?.reason?.trim();
  const excerpt = rawExcerpt
    ? rawExcerpt.replace(/\s+/gu, " ").slice(0, 240)
    : undefined;
  const detail = command
    ? `; first failing command: ${command}${step.cwd ? ` (cwd: ${step.cwd})` : ""}${excerpt ? `; stderr: ${excerpt}` : ""}`
    : "";
  const error = new Error(`Full workspace verification failed: ${summary}${detail}`);
  error.verificationReport = report;
  return error;
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
    const scratchEnvironment = buildUpgradeVerificationEnvironment(
      root,
      context.phaseId,
      context.plan,
    );
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
  const gitCheckpointResults = context.gitRepository && !runtime.verifier
    ? await initializeVerificationGit(root, runner, options, context)
    : [];
  const dependencyInstallResults = dependencyInstalls.length > 0
    ? await installVerificationDependencies(root, sealedAuthority, runner, options, context)
    : [];
  if (runtime.verifier) {
    return {
      ...await runtime.verifier(root),
      gitCheckpoint: gitCheckpointResults,
      dependencyInstalls: dependencyInstallResults,
    };
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
  report.gitCheckpoint = gitCheckpointResults;
  report.dependencyInstalls = dependencyInstallResults;
  if (!report.ok || report.results.some((item) => item.state !== "passed")) {
    throw verificationFailure(report);
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
    report.rootAggregate = rootReport;
    if (!rootReport.ok || rootReport.results.some((item) => item.state !== "passed")) {
      throw verificationFailure({
        ...rootReport,
        gitCheckpoint: gitCheckpointResults,
        dependencyInstalls: dependencyInstallResults,
      });
    }
  }
  return report;
}

async function runAtomicVerification(root, options, sealedAuthority, context, frozenWorkspace, runtime) {
  await workspaceWithSealedVerificationAuthority(root, sealedAuthority);
  const inventoryPaths = await assertVerificationInputsUnchanged(root, context.plan);
  await runtime.hooks?.afterVerificationInputSeal?.({ root, plan: context.plan, phaseId: context.phaseId });
  const copiedPaths = await existingVerificationInputPaths(root, inventoryPaths);
  const checkpoint = await createCheckpoint(root, "copy", { includePaths: copiedPaths });
  try {
    const copiedInventory = await inventoryCopiedVerificationInputs(checkpoint.root);
    if (JSON.stringify(copiedInventory) !== JSON.stringify(copiedPaths)) {
      throw new Error("Disposable verification copy does not match the sealed verification-input inventory");
    }
    const checkpointHash = await hashVerificationInputs(
      checkpoint.root,
      inventoryPaths,
      context.plan.metadata.verificationInputs.excludedPaths,
    );
    if (checkpointHash !== context.plan.metadata.verificationInputs.hash) {
      throw new Error("Disposable verification copy does not match the sealed verification-input hash");
    }
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

async function applyUpgradePlanInternal(plan, options = {}, runtime = {}) {
  assertValidPlan(plan, { command: "upgrade" });
  const root = path.resolve(plan.root);
  await assertDurableManualRecoveryAllowed(root, plan.planId);
  assertPlannedVerificationInputsUntouched(plan);
  if (!runtime.verifier && !plan.approvals?.network) {
    throw new Error("Full verification requires the sealed --allow-network approval");
  }
  await assertVerificationInputsUnchanged(root, plan);
  const writeOperations = orderedOperations(plan.operations.filter((item) => item.kind !== "noop" && (item.content || item.kind === "delete-upgrade-managed")));
  const paths = [...new Set(writeOperations.map((item) => item.path))];
  const transaction = path.join(root, ".agentic", "transactions", plan.planId);
  const lockPath = path.join(root, ".agentic", "transactions", "upgrade.lock");
  await ensureSafeTransactionDirectory(root, transaction);
  await assertUpgradeQuiescent(root, plan.planId);
  await ensureSafeTransactionDirectory(root, transaction);
  const existingEvents = await readJournal(root, plan.planId);
  const alreadyCompleted = existingEvents.some((event) => event.event === "finish" && event.status === "completed");
  const existingPrior = alreadyCompleted && writeOperations.length === 0 && options.allowCurrentReplay
    ? []
    : (await ensureSafeTransactionDirectory(root, transaction), await assertNotApplied(root, plan.planId));
  assertAutomaticRecoveryAllowed(existingPrior, plan.planId);
  if (plan.metadata?.incomingCatalogHash !== await hashManagedAssetCatalog()) {
    throw new Error("Incoming package catalog changed after the upgrade plan was sealed");
  }
  assertLocalVerificationAuthority(plan.metadata.verificationCommands);
  if (existingPrior.length === 0) {
    await assertPlanApplicable(plan, { expected: { command: "upgrade" }, allowedDirtyPaths: options.allowedDirtyPaths });
  }
  const frozenWorkspace = await workspaceWithSealedVerificationAuthority(root, plan.metadata.verificationCommands);
  const gitRoot = plan.preconditions.find((item) => item.kind === "git-root")?.value;
  const gitHead = plan.preconditions.find((item) => item.kind === "git-head")?.value;
  const gitRepository = gitRoot && gitHead ? { root: gitRoot, head: gitHead } : undefined;

  await ensureDirectory(path.dirname(lockPath));
  await ensureSafeTransactionDirectory(root, transaction);
  const transactionLock = await acquireUpgradeMutex(lockPath, { planId: plan.planId });
  const lockedDirtyPaths = [
    ...(options.allowedDirtyPaths ?? []),
    ".agentic/transactions/upgrade.lock/owner/owner.json",
  ];
  try {
    await ensureSafeTransactionDirectory(root, transaction);
    await assertUpgradeQuiescent(root, plan.planId);
    await ensureSafeTransactionDirectory(root, transaction);
    const lockedEvents = await readJournal(root, plan.planId);
    const lockedCompleted = lockedEvents.some((event) => event.event === "finish" && event.status === "completed");
    const prior = lockedCompleted && writeOperations.length === 0 && options.allowCurrentReplay
      ? []
      : (await ensureSafeTransactionDirectory(root, transaction), await assertNotApplied(root, plan.planId));
    assertAutomaticRecoveryAllowed(prior, plan.planId);
    if (prior.length > 0) {
      const recovery = await recoverInterruptedTransaction({
        root, plan, transaction, operations: writeOperations, events: prior, hooks: runtime.hooks,
      });
      await appendUpgradeJournal(root, plan.planId, {
        event: "recovered",
        status: "restored",
        paths: recovery.restoredPaths,
      });
    }
    if (plan.metadata?.incomingCatalogHash !== await hashManagedAssetCatalog()) {
      throw new Error("Incoming package catalog changed after the upgrade plan was sealed");
    }
    await assertPlanApplicable(plan, { expected: { command: "upgrade" }, allowedDirtyPaths: lockedDirtyPaths });
    await assertVerificationInputsUnchanged(root, plan);
    await ensureSafeTransactionDirectory(root, transaction);
    await ensureDirectory(transaction);
    await ensureSafeTransactionDirectory(root, transaction);
    const preDoctor = await doctorProject(root);
    const repairable = new Set(writeOperations.filter((item) => item.kind === "create-upgrade-managed").map((item) => item.path));
    const blockingDoctorErrors = preDoctor.errors.filter((error) => ![...repairable].some((relative) => error.includes(relative)));
    if (blockingDoctorErrors.length > 0 && writeOperations.length === 0) {
      throw new Error(`Pre-upgrade doctor failed:\n- ${blockingDoctorErrors.join("\n- ")}`);
    }
    if (writeOperations.length > 0) {
      validatePlannedState(writeOperations);
      await validateStagedState(root, writeOperations);
    }
    let preVerification;
    try {
      preVerification = await runAtomicVerification(
        root,
        options,
        plan.metadata.verificationCommands,
        {
          plan,
          planId: plan.planId,
          phaseId: "pre-mutation",
          gitRepository,
        },
        frozenWorkspace,
        runtime,
      );
    } catch (error) {
      await writeReport(root, plan.planId, {
        ok: false,
        command: "upgrade",
        planId: plan.planId,
        root,
        status: "verification-failed",
        phase: "pre-mutation",
        applied: [],
        preVerification: error.verificationReport ?? null,
        error: {
          name: error.name,
          message: error.message,
        },
      }, "upgrade");
      throw error;
    }
    await assertVerificationInputsUnchanged(root, plan);
    await assertUpgradeQuiescent(root, plan.planId);
    await assertPlanApplicable(plan, { expected: { command: "upgrade" }, allowedDirtyPaths: lockedDirtyPaths });
    validatePlannedState(writeOperations);
    await validateStagedState(root, writeOperations);
    await runtime.hooks?.afterFinalStagedValidation?.({ root, plan, operations: writeOperations });
    await assertVerificationInputsUnchanged(root, plan);
    await assertUpgradeQuiescent(root, plan.planId);
    await assertPlanApplicable(plan, { expected: { command: "upgrade" }, allowedDirtyPaths: lockedDirtyPaths });
    await ensureSafeTransactionDirectory(root, transaction);
    await writeJson(path.join(transaction, "plan.json"), plan);
    for (const relative of paths) await assertSafeUpgradePath(root, relative);
    await ensureSafeTransactionDirectory(root, transaction);
    const backup = await createFileBackup(root, paths, { baseDirectory: transaction });
    await ensureSafeTransactionDirectory(root, transaction);
    backup.digest = await hashDirectory(backup.directory);
    await runtime.hooks?.afterBackupDigest?.({ root, plan, operations: writeOperations, backup });
    await validateRecoveryBackup(plan, transaction, backup, writeOperations);
    await appendUpgradeJournal(root, plan.planId, { event: "backup", status: "ready", directory: backup.directory, digest: backup.digest });
    await appendUpgradeJournal(root, plan.planId, { event: "start", status: "running", operationCount: writeOperations.length });
    const appliedOperations = [];
    try {
      await runtime.hooks?.afterBackupReady?.({ root, plan, operations: writeOperations });
      for (const item of writeOperations) {
        await assertSafeUpgradePath(root, item.path);
        const stagingPath = await stageUpgradeOperation(root, transaction, item);
        await runtime.hooks?.afterOperationStaged?.({ root, plan, operation: item, stagingPath });
        await appendUpgradeJournal(root, plan.planId, operationJournalRecord(item, "operation-intent", "pending"));
        await commitStagedOperation(root, transaction, item, stagingPath);
        appliedOperations.push(item);
        await appendUpgradeJournal(root, plan.planId, operationJournalRecord(item, "operation", "applied"));
        await runtime.hooks?.afterOperationApplied?.({ root, plan, operation: item, backup });
      }
      const doctor = await doctorProject(root);
      if (!doctor.ok) throw new Error(`Post-upgrade doctor failed:\n- ${doctor.errors.join("\n- ")}`);
      await assertVerificationInputsUnchanged(root, plan);
      const postVerification = await runAtomicVerification(
        root,
        options,
        plan.metadata.verificationCommands,
        {
          plan,
          planId: plan.planId,
          phaseId: "post-apply",
          gitRepository,
        },
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
      await appendUpgradeJournal(root, plan.planId, { event: "finish", status: "completed" });
      return report;
    } catch (error) {
      const recovery = await recoverAppliedTransaction({
        root, plan, transaction, backup, operations: writeOperations,
        appliedOperations, hooks: runtime.hooks, cause: error,
      });
      await appendUpgradeJournal(root, plan.planId, {
        event: "rollback",
        status: "restored",
        paths: recovery.restoredPaths,
      });
      await appendUpgradeJournal(root, plan.planId, { event: "finish", status: "failed", message: error.message });
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
        hooks: dependencies.hooks,
      });
    },
  };
}
