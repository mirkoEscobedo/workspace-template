import path from "node:path";
import { hashBuffer, isPathInside } from "../fs-utils.js";
import {
  capturePresetParentIdentity,
  openPresetMutation,
  pinnedPresetFileCommand,
  readPresetFile,
  samePresetIdentity,
} from "./mutation-session.js";
import {
  desiredStagePath,
  PRESET_BOOTSTRAP_STAGE_PATH,
  PRESET_IGNORE_STAGE_PATH,
  PRESET_TRANSACTION_DIRECTORY,
  PRESET_TRANSACTION_IGNORE,
  PRESET_TRANSACTION_PATH,
  restoreStagePath,
  snapshotPath,
  transactionPrivateDirectory,
} from "./transaction-paths.js";

export {
  assertPresetParentIdentity,
  capturePresetParentIdentity,
  openPresetMutation,
  readPresetFile,
} from "./mutation-session.js";

export {
  PRESET_BOOTSTRAP_STAGE_PATH,
  PRESET_TRANSACTION_DIRECTORY,
  PRESET_TRANSACTION_PATH,
} from "./transaction-paths.js";

function absoluteTarget(root, relative) {
  const target = path.resolve(root, relative);
  if (!isPathInside(root, target)) throw new Error(`Preset transaction path escapes root: ${relative}`);
  return target;
}

function journalContent(journal) {
  const { journalHash: _journalHash, ...persisted } = journal;
  return Buffer.from(`${JSON.stringify(persisted, null, 2)}\n`, "utf8");
}

async function writeJournal(root, journal, options = {}) {
  const content = journalContent(journal);
  const expectedParents = await capturePresetParentIdentity(root, PRESET_TRANSACTION_PATH);
  await pinnedPresetFileCommand(
    root,
    PRESET_TRANSACTION_PATH,
    expectedParents,
    {
      action: "write",
      name: path.basename(PRESET_TRANSACTION_PATH),
      stagingName: path.basename(PRESET_BOOTSTRAP_STAGE_PATH),
      expectedHash: journal.journalHash ?? null,
      desiredHash: hashBuffer(content),
      content: content.toString("base64"),
      failurePoint: options.failurePoint,
    },
    { onWorkerSpawn: options.onWorkerSpawn },
  );
  journal.journalHash = hashBuffer(content);
}

async function readJournal(root) {
  const content = await readPresetFile(root, PRESET_TRANSACTION_PATH);
  if (content === null) return null;
  let journal;
  try {
    journal = JSON.parse(content.toString("utf8"));
  } catch (error) {
    throw new Error(`Preset transaction journal is invalid JSON: ${error.message}`);
  }
  if (
    journal?.version !== 5
    || journal.generator !== "workspace-template"
    || path.resolve(journal.root ?? "") !== path.resolve(root)
    || typeof journal.planId !== "string"
    || !["active", "committed"].includes(journal.phase)
    || journal.journalStagingPath !== PRESET_BOOTSTRAP_STAGE_PATH
    || journal.storage?.ignoreStagePath !== PRESET_IGNORE_STAGE_PATH
    || journal.storage?.transactionDirectory !== transactionPrivateDirectory(journal.planId)
    || !Array.isArray(journal.entries)
    || !Array.isArray(journal.createdParents)
  ) {
    throw new Error("Preset transaction journal is invalid");
  }
  absoluteTarget(root, journal.journalStagingPath);
  for (const entry of journal.entries) {
    absoluteTarget(root, entry.path);
    if (!["pending", "authoring", "authored", "restored"].includes(entry.state)) {
      throw new Error("Preset transaction journal entry state is invalid");
    }
    if (entry.stagingPath !== desiredStagePath(journal.planId, entry.index, entry.desiredHash)) {
      throw new Error("Preset transaction product staging declaration is invalid");
    }
    const expectedSnapshot = entry.original?.hash === null
      ? null
      : snapshotPath(journal.planId, entry.index);
    if (entry.original?.snapshotPath !== expectedSnapshot) {
      throw new Error("Preset transaction snapshot declaration is invalid");
    }
    if (
      entry.restoreStagePath
      !== restoreStagePath(journal.planId, entry.index, entry.original.hash)
    ) {
      throw new Error("Preset transaction restore staging declaration is invalid");
    }
    if (entry.stagingPath) absoluteTarget(root, entry.stagingPath);
    if (entry.restoreStagePath) absoluteTarget(root, entry.restoreStagePath);
    if (expectedSnapshot) absoluteTarget(root, expectedSnapshot);
  }
  for (const entry of journal.createdParents) {
    absoluteTarget(root, entry.path);
    if (!["managed", "private", "storage"].includes(entry.scope)) {
      throw new Error("Preset transaction created-parent scope is invalid");
    }
  }
  journal.journalHash = hashBuffer(content);
  return journal;
}

export function recordCreatedParents(journal, createdParents, scope = "managed") {
  for (const entry of createdParents) {
    const known = journal.createdParents.find((item) => item.path === entry.path);
    if (known) {
      if (!samePresetIdentity(known, entry)) {
        throw new Error(`Preset transaction created-parent identity changed: ${entry.path}`);
      }
      continue;
    }
    journal.createdParents.push({
      path: entry.path,
      dev: entry.dev,
      ino: entry.ino,
      birthtimeMs: entry.birthtimeMs,
      scope,
    });
  }
}

function createdParentMap(journal) {
  return Object.fromEntries(journal.createdParents.map((entry) => [entry.path, entry]));
}

async function assertDeclaredPathsAbsent(root, journal) {
  for (const relative of [
    journal.journalStagingPath,
    journal.storage.ignoreStagePath,
    ...journal.entries.flatMap((entry) => (
      [entry.stagingPath, entry.restoreStagePath, entry.original.snapshotPath].filter(Boolean)
    )),
  ]) {
    if (await readPresetFile(root, relative) !== null) {
      throw new Error(`Preset transaction staging path already exists: ${relative}`);
    }
  }
}

async function initializeTransactionStorage(root, journal, options = {}) {
  const ignore = Buffer.from("*\n", "utf8");
  const current = await readPresetFile(root, PRESET_TRANSACTION_IGNORE);
  const currentHash = current === null ? null : hashBuffer(current);
  if (currentHash !== null && currentHash !== hashBuffer(ignore)) {
    throw new Error("Preset transaction ignore marker is drifted");
  }
  const expectedParents = await capturePresetParentIdentity(
    root,
    PRESET_TRANSACTION_IGNORE,
    { allowMissing: true },
  );
  const session = await openPresetMutation(
    root,
    PRESET_TRANSACTION_IGNORE,
    expectedParents,
    { allowCreate: true, secureFinal: true },
  );
  journal.storage.restrictedBy = session.security;
  try {
    options.hooks?.onWorkerSpawn?.({ stage: "ignore", pid: session.pid });
    const bootstrapFailure = await options.hooks?.workerFailurePoint?.({
      stage: "bootstrap",
      path: PRESET_BOOTSTRAP_STAGE_PATH,
    });
    const bootstrapWorker = (pid) => options.hooks?.onWorkerSpawn?.({
      stage: "bootstrap",
      pid,
    });
    if (session.createdParents.length > 0) {
      await options.hooks?.afterStorageParentCreated?.({
        workerPid: session.pid,
        createdParents: structuredClone(session.createdParents),
      });
      await session.acceptCreatedParents(
        async (createdParents) => {
          recordCreatedParents(journal, createdParents, "storage");
          await writeJournal(root, journal, {
            failurePoint: bootstrapFailure,
            onWorkerSpawn: bootstrapWorker,
          });
        },
        () => options.hooks?.afterJournalParentSeal?.({
          workerPid: session.pid,
          journal: structuredClone(journal),
        }),
      );
    } else {
      await writeJournal(root, journal, {
        failurePoint: bootstrapFailure,
        onWorkerSpawn: bootstrapWorker,
      });
      await session.acceptCreatedParents();
    }
    await options.hooks?.afterBootstrapJournal?.({
      workerPid: session.pid,
      journal: structuredClone(journal),
    });
    await session.execute(
      currentHash === hashBuffer(ignore)
        ? { action: "read", name: ".gitignore", expectedHash: currentHash }
        : {
            action: "write",
            name: ".gitignore",
            stagingName: path.basename(PRESET_IGNORE_STAGE_PATH),
            expectedHash: null,
            desiredHash: hashBuffer(ignore),
            content: ignore.toString("base64"),
            failurePoint: await options.hooks?.workerFailurePoint?.({
              stage: "ignore",
              path: PRESET_IGNORE_STAGE_PATH,
            }),
          },
    );
  } finally {
    await session.close();
  }
}

export async function assertNoPendingPresetTransaction(rootDirectory) {
  const root = path.resolve(rootDirectory);
  const journal = await readJournal(root);
  if (journal) {
    throw new Error(
      `Preset transaction recovery is pending at ${PRESET_TRANSACTION_PATH}; apply the sealed plan to recover before planning again`,
    );
  }
  await assertBootstrapStageAbsent(root);
}

export async function preparePresetTransaction(rootDirectory, planId, entries, options = {}) {
  const root = path.resolve(rootDirectory);
  if (await readJournal(root)) throw new Error("A preset transaction recovery is already pending");
  await assertBootstrapStageAbsent(root);
  const journal = {
    version: 5,
    generator: "workspace-template",
    root,
    planId,
    phase: "active",
    journalStagingPath: PRESET_BOOTSTRAP_STAGE_PATH,
    storage: {
      directory: PRESET_TRANSACTION_DIRECTORY,
      transactionDirectory: transactionPrivateDirectory(planId),
      ignoredBy: PRESET_TRANSACTION_IGNORE,
      ignoreStagePath: PRESET_IGNORE_STAGE_PATH,
      restrictedBy: null,
    },
    createdParents: [],
    entries: entries.map((entry, index) => ({
      index,
      path: entry.path,
      stagingPath: desiredStagePath(planId, index, entry.desiredHash),
      restoreStagePath: restoreStagePath(
        planId,
        index,
        entry.original === null ? null : hashBuffer(entry.original),
      ),
      state: "pending",
      original: {
        hash: entry.original === null ? null : hashBuffer(entry.original),
        snapshotPath: entry.original === null ? null : snapshotPath(planId, index),
      },
      desiredHash: entry.desiredHash,
    })),
  };
  await assertDeclaredPathsAbsent(root, journal);
  try {
    await initializeTransactionStorage(root, journal, options);
  } catch (error) {
    try {
      await assertBootstrapStageAbsent(root);
    } catch (bootstrapError) {
      throw new AggregateError(
        [error, bootstrapError],
        `${error.message}; ${bootstrapError.message}`,
      );
    }
    throw error;
  }
  return journal;
}

async function writePrivateStage(rootDirectory, journal, relative, content, options = {}) {
  const root = path.resolve(rootDirectory);
  const expectedParents = await capturePresetParentIdentity(root, relative, { allowMissing: true });
  const session = await openPresetMutation(
    root,
    relative,
    expectedParents,
    {
      allowCreate: true,
      secureFinal: true,
      knownCreated: createdParentMap(journal),
      onWorkerSpawn: options.onWorkerSpawn,
    },
  );
  try {
    await session.acceptCreatedParents(async (createdParents) => {
      recordCreatedParents(journal, createdParents, "private");
      await writeJournal(root, journal);
    });
    await session.execute({
      action: "writeExclusive",
      name: path.basename(relative),
      desiredHash: hashBuffer(content),
      content: content.toString("base64"),
      failurePoint: options.failurePoint,
    });
  } finally {
    await session.close();
  }
}

export async function ensurePresetSnapshot(rootDirectory, journal, index, original, options = {}) {
  if (original === null) return;
  const root = path.resolve(rootDirectory);
  await writePrivateStage(
    root,
    journal,
    journal.entries[index].original.snapshotPath,
    original,
    options,
  );
}

export async function ensurePresetDesiredStage(
  rootDirectory,
  journal,
  index,
  content,
  options = {},
) {
  if (content === null) return;
  const root = path.resolve(rootDirectory);
  await writePrivateStage(root, journal, journal.entries[index].stagingPath, content, options);
}

export async function updatePresetTransaction(rootDirectory, journal) {
  await writeJournal(path.resolve(rootDirectory), journal);
}

async function pinnedCurrent(root, entry, journal) {
  const expectedParents = await capturePresetParentIdentity(
    root,
    entry.path,
    { allowMissing: true },
  );
  if (expectedParents.some((parent) => parent.missing)) return null;
  const current = await readPresetFile(root, entry.path);
  const currentHash = current === null ? null : hashBuffer(current);
  const response = await pinnedPresetFileCommand(
    root,
    entry.path,
    expectedParents,
    { action: "read", name: path.basename(entry.path), expectedHash: currentHash },
    { knownCreated: createdParentMap(journal) },
  );
  return response.result.content === null ? null : Buffer.from(response.result.content, "base64");
}

async function readSnapshot(root, entry) {
  const relative = entry.original.snapshotPath;
  if (!relative) throw new Error(`Preset recovery snapshot is missing: ${entry.path}`);
  const expectedParents = await capturePresetParentIdentity(root, relative);
  const response = await pinnedPresetFileCommand(
    root,
    relative,
    expectedParents,
    { action: "read", name: path.basename(relative), expectedHash: entry.original.hash },
  );
  return Buffer.from(response.result.content, "base64");
}

async function restoreEntry(root, journal, entry, original) {
  const expectedParents = await capturePresetParentIdentity(root, entry.path);
  if (original !== null) {
    await writePrivateStage(root, journal, entry.restoreStagePath, original);
  }
  await pinnedPresetFileCommand(
    root,
    entry.path,
    expectedParents,
    original === null
      ? { action: "delete", name: path.basename(entry.path), expectedHash: entry.desiredHash }
      : {
          action: "installPrivateStage",
          name: path.basename(entry.path),
          sourceRelative: entry.restoreStagePath,
          expectedHash: entry.desiredHash,
          desiredHash: entry.original.hash,
        },
    { knownCreated: createdParentMap(journal) },
  );
}

async function removeDeclaredFile(root, relative) {
  if (!relative) return false;
  const expectedParents = await capturePresetParentIdentity(root, relative, { allowMissing: true });
  if (expectedParents.some((parent) => parent.missing)) return false;
  if (await readPresetFile(root, relative) === null) return false;
  await pinnedPresetFileCommand(
    root,
    relative,
    expectedParents,
    { action: "deleteOwned", name: path.basename(relative) },
  );
  return true;
}

async function assertBootstrapStageAbsent(root) {
  try {
    if (await readPresetFile(root, PRESET_BOOTSTRAP_STAGE_PATH) === null) return;
  } catch (error) {
    throw new Error(
      `Preset bootstrap ownership is unknown; manual recovery for ${PRESET_BOOTSTRAP_STAGE_PATH} requires preserving it and removing only that exact path after inspection: ${error.message}`,
    );
  }
  throw new Error(
    `Preset bootstrap ownership is unknown; manual recovery for ${PRESET_BOOTSTRAP_STAGE_PATH} requires preserving it and removing only that exact path after inspection`,
  );
}

async function cleanupStaging(root, journal) {
  await removeDeclaredFile(root, journal.journalStagingPath);
  await removeDeclaredFile(root, journal.storage.ignoreStagePath);
  for (const entry of journal.entries) {
    await removeDeclaredFile(root, entry.stagingPath);
    await removeDeclaredFile(root, entry.restoreStagePath);
  }
}

async function removeCreatedParents(root, journal, scopes) {
  const removable = journal.createdParents
    .filter((entry) => scopes.has(entry.scope))
    .sort((left, right) => right.path.length - left.path.length);
  for (const entry of removable) {
    const parentRelative = path.posix.dirname(entry.path);
    const parentTarget = parentRelative === "." ? "placeholder" : `${parentRelative}/placeholder`;
    const expectedParents = await capturePresetParentIdentity(
      root,
      parentTarget,
      { allowMissing: true },
    );
    if (expectedParents.some((parent) => parent.missing)) continue;
    try {
      await pinnedPresetFileCommand(
        root,
        parentTarget,
        expectedParents,
        {
          action: "rmdir",
          name: path.posix.basename(entry.path),
          expectedIdentity: entry,
          allowMissing: true,
        },
      );
    } catch (error) {
      if (!/Generator-created directory is not empty/.test(error.message)) throw error;
    }
  }
}

async function clearTransaction(root, journal, options = {}) {
  await cleanupStaging(root, journal);
  for (const entry of journal.entries) {
    if (await removeDeclaredFile(root, entry.original.snapshotPath)) {
      await options.afterCleanup?.({ kind: "snapshot", path: entry.original.snapshotPath });
    }
  }
  await removeCreatedParents(
    root,
    journal,
    options.rollback
      ? new Set(["managed", "private", "storage"])
      : new Set(["private"]),
  );
  const current = await readPresetFile(root, PRESET_TRANSACTION_PATH);
  if (current === null) return;
  const expectedParents = await capturePresetParentIdentity(root, PRESET_TRANSACTION_PATH);
  await pinnedPresetFileCommand(
    root,
    PRESET_TRANSACTION_PATH,
    expectedParents,
    {
      action: "delete",
      name: path.basename(PRESET_TRANSACTION_PATH),
      expectedHash: journal.journalHash,
    },
  );
}

export async function recoverPendingPresetTransaction(rootDirectory) {
  const root = path.resolve(rootDirectory);
  const journal = await readJournal(root);
  if (!journal) {
    await assertBootstrapStageAbsent(root);
    return null;
  }
  await cleanupStaging(root, journal);
  if (journal.phase === "committed") {
    await clearTransaction(root, journal);
    return journal;
  }
  for (const entry of [...journal.entries].reverse()) {
    const current = await pinnedCurrent(root, entry, journal);
    const currentHash = current === null ? null : hashBuffer(current);
    if (currentHash === entry.original.hash) {
      if (entry.state !== "restored") {
        entry.state = "restored";
        await writeJournal(root, journal);
      }
      continue;
    }
    if (entry.state === "pending" || currentHash !== entry.desiredHash) {
      throw new Error(`Preset recovery found third-party drift: ${entry.path}`);
    }
    const original = entry.original.hash === null ? null : await readSnapshot(root, entry);
    await restoreEntry(root, journal, entry, original);
    entry.state = "restored";
    await writeJournal(root, journal);
  }
  await clearTransaction(root, journal, { rollback: true });
  return journal;
}

export async function completePresetTransaction(rootDirectory, journal, options = {}) {
  const root = path.resolve(rootDirectory);
  journal.phase = "committed";
  await writeJournal(root, journal);
  await clearTransaction(root, journal, { afterCleanup: options.afterCleanup });
}
