import path from "node:path";
import { hashBuffer, isPathInside } from "../fs-utils.js";
import { assertPlanApplicable } from "../plans/index.js";
import { assertValidPlan } from "../plans/schema.js";
import {
  capturePresetParentIdentity,
  completePresetTransaction,
  ensurePresetDesiredStage,
  ensurePresetSnapshot,
  openPresetMutation,
  PRESET_TRANSACTION_DIRECTORY,
  preparePresetTransaction,
  readPresetFile,
  recordCreatedParents,
  recoverPendingPresetTransaction,
  updatePresetTransaction,
} from "./transaction.js";

function contentFor(operation) {
  if (!Object.hasOwn(operation, "content")) throw new Error(`Preset operation ${operation.kind} ${operation.path} has no content`);
  const content = Buffer.from(operation.content, operation.contentEncoding ?? "base64");
  if (operation.proposedHash && hashBuffer(content) !== operation.proposedHash) throw new Error(`Preset content hash mismatch: ${operation.path}`);
  return content;
}

function expectedCurrent(operation) {
  if (["create-preset-managed", "create-preset-report"].includes(operation.kind)) return null;
  return operation.currentHash;
}

function deletesTarget(operation) {
  return operation.kind === "delete-preset-managed";
}

function isWriteOperation(operation) {
  return operation.kind !== "noop";
}

function reportContent(plan, operations) {
  const applied = operations
    .filter((operation) => isWriteOperation(operation) && !operation.kind.endsWith("preset-report"))
    .map((operation) => operation.path);
  const unchanged = operations.filter((operation) => operation.kind === "noop").map((operation) => operation.path);
  return {
    version: 1,
    generator: "workspace-template",
    planId: plan.planId,
    appliedAt: new Date().toISOString(),
    preset: plan.metadata.preset,
    previousPreset: plan.metadata.previousPreset,
    applied,
    unchanged,
    sessionRestartRequired: true,
    ok: true,
  };
}

export async function applyPresetPlan(plan, options = {}) {
  assertValidPlan(plan, { command: "preset", subcommand: "apply" });
  await recoverPendingPresetTransaction(plan.root);
  await assertPlanApplicable(plan, { allowedDirtyPaths: options.allowedDirtyPaths });
  if (plan.operations.at(-1)?.path !== ".agentic/managed-files.json") {
    throw new Error("Preset plan must commit .agentic/managed-files.json last");
  }

  const seen = new Set();
  const snapshots = new Map();
  const parentIdentities = new Map();
  const contents = new Map();
  const report = reportContent(plan, plan.operations);
  for (const operation of plan.operations) {
    if (seen.has(operation.path)) throw new Error(`Duplicate preset operation path: ${operation.path}`);
    seen.add(operation.path);
    const target = path.resolve(plan.root, operation.path);
    if (!isPathInside(plan.root, target)) throw new Error(`Preset operation escapes root: ${operation.path}`);
    const parentIdentity = await capturePresetParentIdentity(
      plan.root,
      operation.path,
      { allowMissing: true },
    );
    parentIdentities.set(operation.path, parentIdentity);
    const current = await readPresetFile(plan.root, operation.path);
    snapshots.set(operation.path, current);
    if (operation.kind === "noop") {
      if (!current || hashBuffer(current) !== operation.proposedHash) {
        throw new Error(`Preset noop target changed: ${operation.path}`);
      }
      continue;
    }
    if (![
      "create-preset-managed",
      "update-preset-managed",
      "delete-preset-managed",
      "create-preset-report",
      "update-preset-report",
    ].includes(operation.kind)) {
      throw new Error(`Unsupported preset operation: ${operation.kind}`);
    }
    const expected = expectedCurrent(operation);
    const actual = current ? hashBuffer(current) : null;
    if (actual !== expected) {
      throw new Error(`Preset ${operation.kind.startsWith("create") ? "create" : "update"} target changed: ${operation.path}`);
    }
    contents.set(
      operation.path,
      deletesTarget(operation)
        ? null
        : operation.kind.endsWith("preset-report")
        ? Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8")
        : contentFor(operation),
    );
  }

  const writeOperations = plan.operations.filter(isWriteOperation);
  const journal = await preparePresetTransaction(
    plan.root,
    plan.planId,
    writeOperations.map((operation) => ({
      path: operation.path,
      original: snapshots.get(operation.path),
      desiredHash: contents.get(operation.path) === null
        ? null
        : hashBuffer(contents.get(operation.path)),
    })),
    { hooks: options.hooks },
  );
  try {
    await options.hooks?.afterJournal?.({
      journal: structuredClone(journal),
      transactionDirectory: path.join(plan.root, ...PRESET_TRANSACTION_DIRECTORY.split("/")),
    });
    for (let index = 0; index < writeOperations.length; index += 1) {
      const operation = writeOperations[index];
      const entry = journal.entries[index];
      const prior = snapshots.get(operation.path);
      await ensurePresetSnapshot(plan.root, journal, index, prior, {
        failurePoint: await options.hooks?.workerFailurePoint?.({
          stage: "snapshot",
          index,
          operation,
          path: entry.original.snapshotPath,
        }),
        onWorkerSpawn(pid) {
          options.hooks?.onWorkerSpawn?.({ stage: "snapshot", index, operation, pid });
        },
      });
      await options.hooks?.afterSnapshot?.({
        index,
        operation,
        entry: structuredClone(entry),
        journal: structuredClone(journal),
        transactionDirectory: path.join(plan.root, ...PRESET_TRANSACTION_DIRECTORY.split("/")),
      });
      const content = contents.get(operation.path);
      await ensurePresetDesiredStage(plan.root, journal, index, content, {
        failurePoint: await options.hooks?.workerFailurePoint?.({
          stage: "product",
          index,
          operation,
          path: entry.stagingPath,
        }),
        onWorkerSpawn(pid) {
          options.hooks?.onWorkerSpawn?.({ stage: "product", index, operation, pid });
        },
      });
      if (content !== null) {
        await options.hooks?.afterPrivateStage?.({
          index,
          operation,
          entry: structuredClone(entry),
          journal: structuredClone(journal),
        });
      }
      const knownCreated = Object.fromEntries(
        journal.createdParents.map((item) => [item.path, item]),
      );
      const session = await openPresetMutation(
        plan.root,
        operation.path,
        parentIdentities.get(operation.path),
        {
          allowCreate: true,
          knownCreated,
        },
      );
      try {
        if (session.createdParents.length > 0) {
          await options.hooks?.beforeCreatedParentSeal?.({
            index,
            operation,
            workerPid: session.pid,
            createdParents: structuredClone(session.createdParents),
          });
          const acknowledgement = await session.acceptCreatedParents(async (createdParents) => {
            recordCreatedParents(journal, createdParents, "managed");
            entry.state = "authoring";
            await updatePresetTransaction(plan.root, journal);
          });
          await options.hooks?.afterCreatedParentSeal?.({
            index,
            operation,
            workerPid: session.pid,
            acknowledgement,
            createdParents: structuredClone(session.createdParents),
          });
        } else {
          entry.state = "authoring";
          await updatePresetTransaction(plan.root, journal);
          await session.acceptCreatedParents();
        }
        await options.hooks?.beforeMutation?.({ index, operation });
        await session.execute(
          content === null
            ? {
                action: "delete",
                name: path.basename(operation.path),
                expectedHash: entry.original.hash,
              }
            : {
                action: "installPrivateStage",
                name: path.basename(operation.path),
                sourceRelative: entry.stagingPath,
                expectedHash: entry.original.hash,
                desiredHash: entry.desiredHash,
              },
        );
      } finally {
        await session.close();
      }
      entry.state = "authored";
      await updatePresetTransaction(plan.root, journal);
      await options.hooks?.afterWrite?.({ index, operation });
    }
    await completePresetTransaction(plan.root, journal, {
      afterCleanup: options.hooks?.afterTransactionCleanup,
    });
  } catch (error) {
    try {
      await recoverPendingPresetTransaction(plan.root);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `Preset apply failed and rollback was incomplete: ${error.message}; ${rollbackError.message}`,
      );
    }
    throw error;
  }
  return report;
}
