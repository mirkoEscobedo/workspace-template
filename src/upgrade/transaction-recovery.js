import { lstat } from "node:fs/promises";
import path from "node:path";
import { writeBytesAtomic } from "../fs-utils.js";
import {
  appliedOperationsFromJournal,
  appendUpgradeJournal,
  ensureSafeRecoveryMarkerRoot,
  interruptedBackup,
  restoreAppliedOperations,
  validateRecoveryBackup,
} from "./transaction-safety.js";

function recoveryMarker(root, planId) {
  if (path.basename(planId) !== planId) throw new Error("Invalid upgrade recovery marker plan ID");
  return path.join(root, ".agentic", `manual-recovery-required-${planId}.json`);
}

export async function assertDurableManualRecoveryAllowed(root, planId) {
  await ensureSafeRecoveryMarkerRoot(root);
  try {
    await lstat(recoveryMarker(root, planId));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Manual recovery required for upgrade ${planId}; automatic recovery refused`);
}

export async function latchDurableManualRecovery(root, planId, paths, cause) {
  const error = new Error(
    `Manual recovery required; updater-owned paths changed after apply: ${paths.join(", ")}`,
    { cause },
  );
  await ensureSafeRecoveryMarkerRoot(root);
  await writeBytesAtomic(
    recoveryMarker(root, planId),
    Buffer.from(`${JSON.stringify({ planId, paths, message: error.message }, null, 2)}\n`),
  );
  await appendUpgradeJournal(root, planId, {
    event: "manual-recovery-required",
    status: "blocked",
    paths,
    message: error.message,
  }).catch(() => {});
  return error;
}

async function requireManualRecovery(root, planId, paths, cause) {
  const error = await latchDurableManualRecovery(root, planId, paths, cause);
  await appendUpgradeJournal(root, planId, {
    event: "finish",
    status: "failed",
    message: error.message,
  }).catch(() => {});
  throw error;
}

export async function recoverAppliedTransaction(context) {
  const {
    root, plan, transaction, backup, operations, appliedOperations, hooks, cause,
  } = context;
  let recovery;
  try {
    await validateRecoveryBackup(plan, transaction, backup, operations);
    recovery = await restoreAppliedOperations(root, backup, appliedOperations, hooks);
  } catch (recoveryFailure) {
    return requireManualRecovery(
      root,
      plan.planId,
      appliedOperations.map((item) => item.path),
      new AggregateError([cause, recoveryFailure], "Automatic rollback trust failed"),
    );
  }
  if (recovery.ownershipLost.length > 0) {
    return requireManualRecovery(root, plan.planId, recovery.ownershipLost, cause);
  }
  return recovery;
}

export async function recoverInterruptedTransaction(context) {
  const { root, plan, transaction, operations, events, hooks } = context;
  let backup;
  let appliedOperations;
  try {
    backup = await interruptedBackup(events, transaction);
    if (!backup) throw new Error(`Interrupted upgrade ${plan.planId} has no recoverable backup`);
    appliedOperations = appliedOperationsFromJournal(operations, events);
  } catch (error) {
    throw await latchDurableManualRecovery(
      root,
      plan.planId,
      (appliedOperations ?? operations).map((item) => item.path),
      error,
    );
  }
  return recoverAppliedTransaction({
    root, plan, transaction, backup, operations, appliedOperations, hooks,
    cause: new Error(`Interrupted upgrade ${plan.planId} requires recovery`),
  });
}
