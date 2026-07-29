import { randomUUID } from "node:crypto";
import { lstat, readFile, realpath, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { createCheckpoint } from "../checkpoints/index.js";
import { doctorProject } from "../doctor.js";
import {
  hashBuffer,
  hashDirectory,
  ensureDirectory,
  isPathInside,
  readJson,
  removePath,
  writeBytesAtomic,
} from "../fs-utils.js";
import { appendJournal } from "../plans/journal.js";
import { assertValidPlan, stableStringify } from "../plans/schema.js";
import { assertSafeUpgradePath } from "./inspect.js";
function samePath(left, right) {
  return path.relative(path.resolve(left), path.resolve(right)) === "";
}
async function assertRealDirectory(directory, label) {
  const details = await lstat(directory);
  if (!details.isDirectory() || details.isSymbolicLink() || !samePath(await realpath(directory), directory)) {
    throw new Error(`${label} must be a real non-symlink directory`);
  }
}
async function assertRealDirectoryIfPresent(directory, label, trustedRoot) {
  try {
    await assertRealDirectory(directory, label);
    if (!isPathInside(await realpath(trustedRoot), await realpath(directory))) {
      throw new Error(`${label} escapes its trusted root`);
    }
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
export async function ensureSafeRecoveryMarkerRoot(root) {
  const trustedRoot = path.resolve(root);
  await assertRealDirectory(trustedRoot, "Upgrade root");
  await assertRealDirectory(path.join(trustedRoot, ".agentic"), "Upgrade .agentic directory");
}
export async function ensureSafeTransactionDirectory(root, transaction) {
  const trustedRoot = path.resolve(root);
  const agentic = path.join(trustedRoot, ".agentic");
  const transactions = path.join(agentic, "transactions");
  const exactTransaction = path.resolve(transaction);
  if (!samePath(path.dirname(exactTransaction), transactions)) {
    throw new Error("Upgrade transaction directory escapes its trusted root");
  }
  await assertRealDirectory(trustedRoot, "Upgrade root");
  await assertRealDirectory(agentic, "Upgrade .agentic directory");
  if (!await assertRealDirectoryIfPresent(transactions, "Upgrade transactions directory", trustedRoot)) return;
  if (!await assertRealDirectoryIfPresent(exactTransaction, "Upgrade transaction directory", trustedRoot)) return;
  await assertRealDirectoryIfPresent(path.join(exactTransaction, "staging"), "Upgrade transaction staging directory", exactTransaction);
  for (const name of ["journal.jsonl", "plan.json"]) {
    await assertRegularFileIfPresent(exactTransaction, path.join(exactTransaction, name), `Upgrade transaction ${name}`);
  }
}
async function assertRegularFileUnder(root, file, label) {
  if (!isPathInside(root, file)) throw new Error(`${label} escapes its trusted root`);
  let ancestor = path.dirname(file);
  while (!samePath(ancestor, root)) {
    await assertRealDirectory(ancestor, `${label} ancestor`);
    ancestor = path.dirname(ancestor);
  }
  const details = await lstat(file);
  if (!details.isFile()
    || details.isSymbolicLink()
    || details.nlink !== 1
    || !isPathInside(await realpath(root), await realpath(file))) {
    throw new Error(`${label} must be a safe single-link regular file`);
  }
}
async function assertRegularFileIfPresent(root, file, label) {
  try {
    await lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  await assertRegularFileUnder(root, file, label);
}
export async function interruptedBackup(events, transaction) {
  const event = [...events].reverse().find((item) => item.event === "backup" && item.directory);
  if (!event) return undefined;
  const directory = path.resolve(event.directory);
  const expectedTransaction = path.resolve(transaction);
  await assertRealDirectory(expectedTransaction, "Upgrade transaction");
  await assertRealDirectory(directory, "Interrupted upgrade backup");
  if (!samePath(path.dirname(directory), expectedTransaction)) {
    throw new Error("Interrupted upgrade backup must be directly beneath the exact transaction");
  }
  const manifestPath = path.join(directory, "manifest.json");
  await assertRegularFileUnder(directory, manifestPath, "Interrupted upgrade backup manifest");
  return { directory, digest: event.digest, manifest: await readJson(manifestPath) };
}
export async function validateRecoveryBackup(plan, transaction, backup, operations) {
  assertValidPlan(plan, { command: "upgrade" });
  const exactTransaction = path.resolve(transaction);
  const backupDirectory = path.resolve(backup.directory);
  await ensureSafeTransactionDirectory(plan.root, exactTransaction);
  await assertRealDirectory(exactTransaction, "Upgrade transaction");
  await assertRealDirectory(backupDirectory, "Interrupted upgrade backup");
  if (!samePath(path.dirname(backupDirectory), exactTransaction)
    || path.resolve(backup.manifest.root) !== path.resolve(plan.root)) {
    throw new Error("Interrupted upgrade backup is not bound to the sealed transaction");
  }
  const storedPlanPath = path.join(transaction, "plan.json");
  await assertRegularFileUnder(transaction, storedPlanPath, "Stored transaction plan");
  const storedPlan = await readJson(storedPlanPath);
  assertValidPlan(storedPlan, { command: "upgrade" });
  if (stableStringify(storedPlan) !== stableStringify(plan)) {
    throw new Error("Stored transaction plan does not match the supplied sealed plan");
  }
  if (!backup.digest || await hashDirectory(backup.directory) !== backup.digest) {
    throw new Error("Interrupted upgrade backup integrity check failed");
  }
  const operationsByPath = new Map(operations.map((item) => [item.path, item]));
  if (operationsByPath.size !== operations.length) throw new Error("Sealed upgrade operations contain duplicate paths");
  const actual = Object.keys(backup.manifest.files ?? {}).sort();
  const expected = [...operationsByPath.keys()].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Interrupted upgrade backup write set does not match the sealed plan");
  }
  for (const [relative, operation] of operationsByPath) {
    const record = backup.manifest.files[relative];
    const source = path.join(backup.directory, "files", ...relative.split("/"));
    if ((operation.currentHash ?? null) === null) {
      if (record?.state !== "absent") throw new Error(`Backup record does not match absent prestate: ${relative}`);
      try {
        await lstat(source);
        throw new Error(`Backup unexpectedly stores bytes for absent prestate: ${relative}`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    } else {
      if (record?.state !== "file") throw new Error(`Backup record is not a regular file: ${relative}`);
      await assertRegularFileUnder(backup.directory, source, `Backup source '${relative}'`);
      if (hashBuffer(await readFile(source)) !== operation.currentHash) {
        throw new Error(`Backup file hash does not match sealed currentHash: ${relative}`);
      }
    }
  }
  for (const ancestor of backup.manifest.absentAncestors ?? []) {
    if (!ancestor
      || ancestor === "."
      || !actual.some((relative) => (
        relative.startsWith(`${ancestor}/`)
        && backup.manifest.files[relative]?.state === "absent"
      ))) {
      throw new Error("Interrupted upgrade backup contains an invalid absent ancestor");
    }
  }
  for (const relative of actual) await assertSafeUpgradePath(plan.root, relative);
}
export function validatePlannedState(operations) {
  for (const item of operations) {
    if (!item.content || !item.path.endsWith(".json")) continue;
    try {
      JSON.parse(Buffer.from(item.content, item.contentEncoding ?? "base64").toString("utf8"));
    } catch (error) {
      throw new Error(`Planned JSON is invalid for ${item.path}: ${error.message}`);
    }
  }
}
export async function validateStagedState(root, operations) {
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
async function operationCurrentState(target) {
  try {
    const details = await lstat(target);
    if (!details.isFile() || details.isSymbolicLink()) return { state: "other" };
    return { state: "file", hash: hashBuffer(await readFile(target)) };
  } catch (error) {
    if (error.code === "ENOENT") return { state: "absent" };
    throw error;
  }
}
function operationStateMatchesHash(state, expectedHash) {
  return expectedHash === null
    ? state.state === "absent"
    : state.state === "file" && state.hash === expectedHash;
}
export async function assertOperationCurrentState(root, operation) {
  const target = path.join(root, ...operation.path.split("/"));
  const state = await operationCurrentState(target);
  if (!operationStateMatchesHash(state, operation.currentHash ?? null)) {
    throw new Error(`Upgrade target changed after staged validation: ${operation.path}`);
  }
}
async function stageTransactionBytes(root, transaction, content, expectedHash) {
  await ensureSafeTransactionDirectory(root, transaction);
  const staging = path.join(transaction, "staging");
  await ensureDirectory(staging);
  await ensureSafeTransactionDirectory(root, transaction);
  const stagedPath = path.join(staging, `${randomUUID()}.stage`);
  await writeBytesAtomic(stagedPath, content);
  await ensureSafeTransactionDirectory(root, transaction);
  if (hashBuffer(await readFile(stagedPath)) !== expectedHash) {
    throw new Error("Upgrade transaction staging integrity check failed");
  }
  return stagedPath;
}
export async function stageUpgradeOperation(root, transaction, operation) {
  if (operation.kind === "delete-upgrade-managed") return undefined;
  return stageTransactionBytes(
    root,
    transaction,
    Buffer.from(operation.content, operation.contentEncoding ?? "base64"),
    operation.proposedHash,
  );
}
export async function commitStagedOperation(root, transaction, operation, stagedPath) {
  await ensureSafeTransactionDirectory(root, transaction);
  if (stagedPath) {
    await assertRegularFileUnder(transaction, stagedPath, "Upgrade staged operation");
    if (hashBuffer(await readFile(stagedPath)) !== operation.proposedHash) {
      throw new Error("Upgrade transaction staging integrity check failed");
    }
  }
  await assertSafeUpgradePath(root, operation.path);
  await assertOperationCurrentState(root, operation);
  const target = path.join(root, ...operation.path.split("/"));
  if (operation.kind === "delete-upgrade-managed") await removePath(target);
  else await rename(stagedPath, target);
}
async function removeEmptyBackupAncestors(root, ancestors) {
  for (const relative of [...ancestors].sort((left, right) => right.length - left.length)) {
    const target = path.resolve(root, ...relative.split("/"));
    if (!relative || relative === "." || !isPathInside(root, target)) {
      throw new Error("Backup ancestor must be a strict repository descendant");
    }
    try {
      await rmdir(target);
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
    }
  }
}
function assertJournalBinding(event, operation, expectedEvent, expectedStatus) {
  if (event.event !== expectedEvent
    || event.status !== expectedStatus
    || event.path !== operation.path
    || event.kind !== operation.kind
    || (event.currentHash ?? null) !== (operation.currentHash ?? null)
    || (event.proposedHash ?? null) !== (operation.proposedHash ?? null)) {
    throw new Error(`Interrupted upgrade journal is not bound to sealed operation: ${operation.path}`);
  }
}
export function operationJournalRecord(operation, event, status) {
  return {
    event,
    status,
    path: operation.path,
    kind: operation.kind,
    currentHash: operation.currentHash ?? null,
    proposedHash: operation.proposedHash ?? null,
  };
}
export function appliedOperationsFromJournal(operations, events) {
  events.forEach((event, index) => {
    if (event.sequence !== index + 1) throw new Error("Interrupted upgrade journal sequence is invalid");
  });
  const lastRestore = events.reduce((index, event, candidate) => (
    ["recovered", "rollback"].includes(event.event) && event.status === "restored"
      ? candidate
      : index
  ), -1);
  const pending = events.slice(lastRestore + 1);
  const backupIndex = pending.findIndex((event) => event.event === "backup" && event.status === "ready");
  const startIndex = pending.findIndex((event) => event.event === "start" && event.status === "running");
  const isOperation = (event) => event.event === "operation-intent" || event.event === "operation";
  const journalOperations = pending.filter(isOperation);
  const firstOperationIndex = pending.findIndex(isOperation);
  if (journalOperations.length > 0
    && (pending.filter((event) => event.event === "backup").length !== 1
      || pending.filter((event) => event.event === "start").length !== 1
      || backupIndex < 0
      || startIndex <= backupIndex
      || firstOperationIndex <= startIndex)) {
    throw new Error("Interrupted upgrade journal operation order lacks unique backup/start authority");
  }
  const candidates = [];
  let operationIndex = 0, intent;
  for (const event of journalOperations) {
    if (event.event === "operation-intent") {
      if (intent || operationIndex >= operations.length) {
        throw new Error("Interrupted upgrade journal intent order is invalid");
      }
      const operation = operations[operationIndex];
      assertJournalBinding(event, operation, "operation-intent", "pending");
      intent = operation;
      candidates.push(operation);
      operationIndex += 1;
    } else {
      if (!intent) throw new Error("Interrupted upgrade journal applied event lacks write-ahead intent");
      assertJournalBinding(event, intent, "operation", "applied");
      intent = undefined;
    }
  }
  return candidates;
}
function classifyOperationState(state, operation) {
  if (operationStateMatchesHash(state, operation.currentHash ?? null)) return "prestate";
  if (operationStateMatchesHash(state, operation.proposedHash ?? null)) return "proposal";
  return "other";
}
async function validatedBackupBytes(backup, operation) {
  const source = path.join(backup.directory, "files", ...operation.path.split("/"));
  await assertRegularFileUnder(backup.directory, source, `Backup source '${operation.path}'`);
  const content = await readFile(source);
  if (hashBuffer(content) !== operation.currentHash) {
    throw new Error(`Backup file hash does not match sealed currentHash: ${operation.path}`);
  }
  return content;
}
export async function restoreAppliedOperations(root, backup, operations, hooks = {}) {
  const appliedByPath = new Map(operations.map((item) => [item.path, item]));
  const ownershipLost = [];
  const restoredPaths = [];
  const cleanupPaths = new Set();
  const transaction = path.dirname(backup.directory);
  for (const item of appliedByPath.values()) {
    const target = path.join(root, ...item.path.split("/"));
    const backupBytes = (item.currentHash ?? null) === null
      ? undefined
      : await validatedBackupBytes(backup, item);
    const stagedPath = backupBytes === undefined
      ? undefined
      : await stageTransactionBytes(root, transaction, backupBytes, item.currentHash);
    await assertSafeUpgradePath(root, item.path);
    const classifiedState = await operationCurrentState(target);
    await hooks.afterRecoveryClassification?.({
      operation: item,
      state: classifiedState,
      classification: classifyOperationState(classifiedState, item),
    });
    await assertSafeUpgradePath(root, item.path);
    const currentState = await operationCurrentState(target);
    const classification = classifyOperationState(currentState, item);
    if (classification === "prestate") {
      if (stagedPath) await rm(stagedPath, { force: true });
      if ((item.currentHash ?? null) === null) cleanupPaths.add(item.path);
      continue;
    }
    if (classification === "other") {
      if (stagedPath) await rm(stagedPath, { force: true });
      ownershipLost.push(item.path);
      continue;
    }
    await ensureSafeTransactionDirectory(root, transaction);
    if (stagedPath) {
      await assertRegularFileUnder(transaction, stagedPath, "Upgrade staged restoration");
      if (hashBuffer(await readFile(stagedPath)) !== item.currentHash) {
        throw new Error(`Upgrade staged restoration integrity check failed: ${item.path}`);
      }
    }
    await assertSafeUpgradePath(root, item.path);
    const finalState = await operationCurrentState(target);
    if (classifyOperationState(finalState, item) !== "proposal") {
      if (stagedPath) await rm(stagedPath, { force: true });
      ownershipLost.push(item.path);
      continue;
    }
    if (stagedPath) await rename(stagedPath, target);
    else {
      await rm(target, { force: true });
      cleanupPaths.add(item.path);
    }
    restoredPaths.push(item.path);
  }
  const absentAncestors = [...new Set(backup.manifest.absentAncestors ?? [])]
    .filter((ancestor) => [...cleanupPaths].some((relative) => relative.startsWith(`${ancestor}/`)));
  await removeEmptyBackupAncestors(root, absentAncestors);
  return { ownershipLost, restoredPaths };
}
export function assertAutomaticRecoveryAllowed(events, planId) {
  if (events.some((event) => event.event === "manual-recovery-required")) {
    throw new Error(`Manual recovery required for upgrade ${planId}; automatic recovery refused`);
  }
}
export async function appendUpgradeJournal(root, planId, event) {
  await ensureSafeTransactionDirectory(root, path.join(root, ".agentic", "transactions", planId));
  return appendJournal(root, planId, event);
}
