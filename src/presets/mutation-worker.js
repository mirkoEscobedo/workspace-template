import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import {
  closeProcessLease,
  createProcessLease,
  newProcessLease,
  PRESET_NATIVE_DEADLINE_MS,
  PRESET_WORKER_DEADLINE_MS,
} from "./process-lease.js";

let outputClosed = false;
process.stdout.on("error", () => {
  outputClosed = true;
});

function send(value) {
  if (!outputClosed) process.stdout.write(`${JSON.stringify(value)}\n`);
}

function fail(error) {
  send({ type: "error", message: error?.message ?? String(error), code: error?.code ?? null });
  process.exitCode = error?.exitCode ?? 2;
}

let activeNativeChild = null;
let activeNativeExit = null;
let leaseDirectory = null;

function safeSegment(value) {
  return typeof value === "string"
    && value.length > 0
    && value !== "."
    && value !== ".."
    && !value.includes("/")
    && !value.includes("\\")
    && !value.includes("\0");
}

function identity(details) {
  return {
    dev: String(details.dev),
    ino: String(details.ino),
    birthtimeMs: details.birthtimeMs,
  };
}

function sameIdentity(left, right) {
  return left?.dev === right?.dev
    && left?.ino === right?.ino
    && left?.birthtimeMs === right?.birthtimeMs;
}

function hash(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function currentFile(name) {
  try {
    const details = await lstat(name);
    if (details.isSymbolicLink() || !details.isFile()) {
      throw new Error(`Pinned mutation target must be a regular file: ${name}`);
    }
    return await readFile(name);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function currentDirectoryIdentity() {
  const details = await lstat(".");
  if (details.isSymbolicLink() || !details.isDirectory()) {
    throw new Error("Pinned mutation cwd must remain a real directory");
  }
  return identity(details);
}

async function syncDirectory() {
  let handle;
  try {
    handle = await open(".", "r");
    await handle.sync();
  } catch (error) {
    if (!["EINVAL", "EISDIR", "EPERM", "EACCES"].includes(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}

async function writeExclusive(name, content, failurePoint) {
  const handle = await open(name, "wx", 0o600);
  let writeError;
  try {
    if (failurePoint === "partial") {
      await handle.write(content.subarray(0, Math.max(1, Math.floor(content.length / 2))));
    } else {
      await handle.writeFile(content);
    }
    await handle.sync();
  } catch (error) {
    writeError = error;
  } finally {
    await handle.close();
  }
  if (writeError) throw writeError;
  await syncDirectory();
  if (failurePoint === "partial") {
    const error = new Error("Pinned mutation worker exited after partial stage fsync");
    error.exitCode = 86;
    throw error;
  }
}

async function writeStaged(name, stagingName, expectedHash, content, failurePoint) {
  if (!safeSegment(stagingName) || stagingName === name) {
    throw new Error(`Unsafe pinned staging name: ${stagingName}`);
  }
  if (await currentFile(stagingName) !== null) {
    throw new Error(`Pinned mutation staging path already exists: ${stagingName}`);
  }
  await writeExclusive(stagingName, content, failurePoint);
  const current = await currentFile(name);
  if ((current === null ? null : hash(current)) !== expectedHash) {
    throw new Error(`Pinned mutation target changed before rename: ${name}`);
  }
  await rename(stagingName, name);
  await syncDirectory();
}

async function runNative(executable, args) {
  const lease = newProcessLease(
    "preset-acl-child",
    { executable, args },
    process.cwd(),
    PRESET_NATIVE_DEADLINE_MS,
  );
  const leasePath = path.join(
    leaseDirectory,
    `preset-native-${lease.runId}.json`,
  );
  const child = spawn(executable, args, {
    cwd: process.cwd(),
    detached: false,
    stdio: "ignore",
    windowsHide: true,
  });
  activeNativeChild = child;
  activeNativeExit = new Promise((resolve) => child.once(
    "close",
    (code, signal) => resolve({ code, signal }),
  ));
  let record;
  try {
    record = await createProcessLease(leasePath, lease, child.pid);
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await activeNativeExit;
    activeNativeChild = null;
    activeNativeExit = null;
    throw error;
  }
  send({
    type: "native-spawn",
    leasePath,
    lease: record,
    owner: {
      pid: process.pid,
      leasePath: workerLeasePath,
      lease: workerLeaseRecord,
    },
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }, PRESET_NATIVE_DEADLINE_MS);
  const exit = await activeNativeExit;
  clearTimeout(timeout);
  activeNativeChild = null;
  activeNativeExit = null;
  const finalRecord = await closeProcessLease(
    leasePath,
    record,
    { code: exit.code, signal: exit.signal, timedOut },
  );
  send({ type: "native-final", leasePath, lease: finalRecord });
  if (timedOut || exit.code !== 0) {
    throw new Error(`${executable} failed with ${exit.code ?? exit.signal}`);
  }
}

async function secureCurrentDirectory() {
  if (process.platform === "win32") {
    const account = os.userInfo().username;
    await runNative(
      "icacls.exe",
      [".", "/inheritance:r", "/grant:r", `${account}:(OI)(CI)F`],
    );
    return "windows-acl";
  }
  return chmod(".", 0o700).then(() => "posix-mode-0700");
}

async function traverse(options) {
  const chain = [{ path: ".", ...identity(await lstat(".")), created: false }];
  const traversed = [];
  for (const segment of options.segments) {
    if (!safeSegment(segment)) throw new Error(`Unsafe pinned directory segment: ${segment}`);
    let created = false;
    try {
      const details = await lstat(segment);
      if (details.isSymbolicLink() || !details.isDirectory()) {
        throw new Error(`Pinned mutation ancestor must be a real directory: ${segment}`);
      }
    } catch (error) {
      if (error.code !== "ENOENT" || !options.allowCreate) throw error;
      await mkdir(segment, { mode: 0o700 });
      const createdDetails = await lstat(segment);
      if (createdDetails.isSymbolicLink() || !createdDetails.isDirectory()) {
        throw new Error(`Pinned created ancestor must be a real directory: ${segment}`);
      }
      created = identity(createdDetails);
    }
    process.chdir(segment);
    traversed.push(segment);
    const details = await lstat(".");
    const currentIdentity = identity(details);
    if (created && !sameIdentity(created, currentIdentity)) {
      throw new Error(`Pinned created ancestor identity changed after chdir: ${segment}`);
    }
    chain.push({
      path: traversed.join("/"),
      ...currentIdentity,
      created: Boolean(created),
    });
  }
  const security = options.secureFinal ? await secureCurrentDirectory() : null;
  return {
    chain,
    security,
    pinnedDirectoryIdentity: await currentDirectoryIdentity(),
    segments: options.segments,
  };
}

async function assertPostOperation(command, pinnedDirectoryIdentity, result) {
  if (!sameIdentity(await currentDirectoryIdentity(), pinnedDirectoryIdentity)) {
    throw new Error("Pinned mutation directory identity changed after operation");
  }
  if (command.action === "rmdir") {
    try {
      await lstat(command.name);
    } catch (error) {
      if (error.code === "ENOENT") return result;
      throw error;
    }
    throw new Error(`Pinned directory still exists after removal: ${command.name}`);
  }
  const current = await currentFile(command.name);
  const expectedHash = ["write", "installPrivateStage"].includes(command.action)
    ? command.desiredHash : (
    command.action === "delete" ? null : command.expectedHash
  );
  const currentHash = current === null ? null : hash(current);
  if (currentHash !== expectedHash) {
    throw new Error(`Pinned mutation target drifted after operation: ${command.name}`);
  }
  if (command.stagingName && await currentFile(command.stagingName) !== null) {
    throw new Error(`Pinned mutation staging path survived operation: ${command.stagingName}`);
  }
  if (command.sourcePath && await currentFile(command.sourcePath) !== null) {
    throw new Error(`Preset private stage survived installation: ${command.sourcePath}`);
  }
  return result;
}

async function execute(command, pinnedDirectoryIdentity) {
  if (!safeSegment(command.name)) throw new Error(`Unsafe pinned target name: ${command.name}`);
  if (command.action === "rmdir") {
    let details;
    try {
      details = await lstat(command.name);
    } catch (error) {
      if (error.code === "ENOENT" && command.allowMissing) {
        return assertPostOperation(command, pinnedDirectoryIdentity, { removed: false });
      }
      throw error;
    }
    if (
      details.isSymbolicLink()
      || !details.isDirectory()
      || !sameIdentity(identity(details), command.expectedIdentity)
    ) {
      throw new Error(`Pinned directory identity changed: ${command.name}`);
    }
    if ((await readdir(command.name)).length > 0) {
      throw new Error(`Generator-created directory is not empty: ${command.name}`);
    }
    await rmdir(command.name);
    await syncDirectory();
    return assertPostOperation(command, pinnedDirectoryIdentity, { removed: true });
  }

  const current = await currentFile(command.name);
  const currentHash = current === null ? null : hash(current);
  const expectedCurrentHash = command.action === "writeExclusive"
    ? null
    : command.action === "deleteOwned"
    ? currentHash
    : command.expectedHash;
  if (currentHash !== expectedCurrentHash) {
    throw new Error(`Pinned mutation target changed: ${command.name}`);
  }
  if (command.action === "read") {
    return assertPostOperation(
      command,
      pinnedDirectoryIdentity,
      { content: current?.toString("base64") ?? null, hash: currentHash },
    );
  }
  if (command.action === "delete") {
    if (current !== null) {
      await rm(command.name, { force: true });
      await syncDirectory();
    }
    return assertPostOperation(command, pinnedDirectoryIdentity, { hash: null });
  }
  if (command.action === "deleteOwned") {
    if (current !== null) {
      await rm(command.name);
      await syncDirectory();
    }
    return assertPostOperation(
      { ...command, action: "delete" },
      pinnedDirectoryIdentity,
      { hash: null },
    );
  }
  if (command.action === "writeExclusive") {
    if (current !== null) throw new Error(`Pinned exclusive target already exists: ${command.name}`);
    const content = Buffer.from(command.content, "base64");
    if (hash(content) !== command.desiredHash) throw new Error("Pinned mutation content hash mismatch");
    await writeExclusive(command.name, content, command.failurePoint);
    return assertPostOperation(
      { ...command, action: "write" },
      pinnedDirectoryIdentity,
      { hash: command.desiredHash },
    );
  }
  if (command.action === "write") {
    const content = Buffer.from(command.content, "base64");
    if (hash(content) !== command.desiredHash) throw new Error("Pinned mutation content hash mismatch");
    await writeStaged(
      command.name,
      command.stagingName,
      command.expectedHash,
      content,
      command.failurePoint,
    );
    return assertPostOperation(command, pinnedDirectoryIdentity, { hash: command.desiredHash });
  }
  if (command.action === "installPrivateStage") {
    const sourceDetails = await lstat(command.sourcePath);
    if (
      sourceDetails.isSymbolicLink()
      || !sourceDetails.isFile()
      || !sameIdentity(identity(sourceDetails), command.sourceIdentity)
    ) {
      throw new Error("Preset private stage identity changed before installation");
    }
    if (String(sourceDetails.dev) !== pinnedDirectoryIdentity.dev) {
      throw new Error("Preset private stage and target are on different devices");
    }
    const source = await readFile(command.sourcePath);
    if (hash(source) !== command.desiredHash) {
      throw new Error("Preset private stage hash changed before installation");
    }
    await rename(command.sourcePath, command.name);
    await syncDirectory();
    return assertPostOperation(command, pinnedDirectoryIdentity, { hash: command.desiredHash });
  }
  throw new Error(`Unsupported pinned mutation action: ${command.action}`);
}

async function cleanupUnacceptedParents(traversal) {
  for (let index = traversal.segments.length - 1; index >= 0; index -= 1) {
    process.chdir("..");
    const created = traversal.chain[index + 1];
    if (!created.created) continue;
    const name = traversal.segments[index];
    try {
      const details = await lstat(name);
      if (
        details.isSymbolicLink()
        || !details.isDirectory()
        || !sameIdentity(identity(details), created)
        || (await readdir(name)).length > 0
      ) {
        continue;
      }
      await rmdir(name);
      await syncDirectory();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

let workerDeadline;
let workerLeaseRecord;
let workerLeasePath;
let finalState = { outcome: "starting" };
try {
  const options = JSON.parse(Buffer.from(process.argv[2], "base64url").toString("utf8"));
  if (!Array.isArray(options.segments)) throw new Error("Pinned mutation segments are required");
  workerLeasePath = options.leasePath;
  leaseDirectory = path.dirname(workerLeasePath);
  workerLeaseRecord = await createProcessLease(workerLeasePath, options.lease, process.pid);
  workerDeadline = setTimeout(() => {
    const error = new Error("Pinned mutation worker exceeded its 15 second deadline");
    error.exitCode = 3;
    if (activeNativeChild?.exitCode === null && activeNativeChild?.signalCode === null) {
      activeNativeChild.kill("SIGTERM");
    }
    process.stdin.destroy(error);
  }, PRESET_WORKER_DEADLINE_MS);
  const traversal = await traverse(options);
  send({
    type: "ready",
    pid: process.pid,
    chain: traversal.chain,
    security: traversal.security,
    lease: workerLeaseRecord,
    leasePath: workerLeasePath,
  });
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let accepted = false;
  let received = false;
  for await (const line of input) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (!accepted) {
      if (message.type !== "accept") throw new Error("Pinned mutation worker requires accept");
      accepted = true;
      send({ type: "accepted", pid: process.pid });
      continue;
    }
    if (received) throw new Error("Pinned mutation worker accepts one command");
    if (message.type !== "execute") throw new Error("Pinned mutation worker requires execute");
    received = true;
    const result = await execute(message.command, traversal.pinnedDirectoryIdentity);
    send({ type: "result", result });
    break;
  }
  if (!accepted) await cleanupUnacceptedParents(traversal);
  finalState = { outcome: "completed", accepted, received };
} catch (error) {
  finalState = {
    outcome: "failed",
    message: error?.message ?? String(error),
    exitCode: error?.exitCode ?? 2,
  };
  fail(error);
} finally {
  clearTimeout(workerDeadline);
  if (activeNativeChild?.exitCode === null && activeNativeChild?.signalCode === null) {
    activeNativeChild.kill("SIGTERM");
    await activeNativeExit;
  }
  if (workerLeaseRecord) {
    try {
      await closeProcessLease(workerLeasePath, workerLeaseRecord, finalState);
    } catch (error) {
      fail(error);
    }
  }
}
