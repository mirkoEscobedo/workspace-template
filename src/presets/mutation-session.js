import { spawn } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isPathInside } from "../fs-utils.js";
import {
  closeProcessLease,
  newProcessLease,
  PRESET_WORKER_DEADLINE_MS,
} from "./process-lease.js";

const WORKER_PATH = fileURLToPath(new URL("./mutation-worker.js", import.meta.url));
const WORKER_TIMEOUT_MS = PRESET_WORKER_DEADLINE_MS + 3_000;
const WORKER_CLOSE_GRACE_MS = 2_000;

function missing(error) {
  return error?.code === "ENOENT";
}

function identity(details) {
  return {
    dev: String(details.dev),
    ino: String(details.ino),
    birthtimeMs: details.birthtimeMs,
  };
}

export function samePresetIdentity(left, right) {
  return left?.dev === right?.dev
    && left?.ino === right?.ino
    && left?.birthtimeMs === right?.birthtimeMs;
}

function absoluteTarget(root, relative) {
  const target = path.resolve(root, relative);
  if (!isPathInside(root, target)) throw new Error(`Preset transaction path escapes root: ${relative}`);
  return target;
}

function relativeSegments(root, relative) {
  const parent = path.dirname(absoluteTarget(root, relative));
  const value = path.relative(root, parent);
  if (value.startsWith("..") || path.isAbsolute(value)) {
    throw new Error(`Preset target parent escapes root: ${relative}`);
  }
  return value ? value.split(path.sep) : [];
}

async function directoryDetails(target, label) {
  const details = await lstat(target);
  if (details.isSymbolicLink() || !details.isDirectory()) {
    throw new Error(`Preset target ancestor must be a real directory: ${label}`);
  }
  return details;
}

export async function capturePresetParentIdentity(rootDirectory, relative, options = {}) {
  const root = path.resolve(rootDirectory);
  const segments = relativeSegments(root, relative);
  const chain = [];
  let current = root;
  chain.push({ path: ".", ...identity(await directoryDetails(current, ".")) });
  let parentMissing = false;
  for (const segment of segments) {
    current = path.join(current, segment);
    const relativePath = path.relative(root, current).split(path.sep).join("/");
    if (parentMissing) {
      chain.push({ path: relativePath, missing: true });
      continue;
    }
    try {
      chain.push({
        path: relativePath,
        ...identity(await directoryDetails(current, relativePath)),
      });
    } catch (error) {
      if (!missing(error) || !options.allowMissing) throw error;
      parentMissing = true;
      chain.push({ path: relativePath, missing: true });
    }
  }
  return chain;
}

export async function assertPresetParentIdentity(rootDirectory, relative, expected) {
  const actual = await capturePresetParentIdentity(rootDirectory, relative);
  if (actual.length !== expected.length) {
    throw new Error(`Preset target parent identity changed: ${relative}`);
  }
  for (let index = 0; index < actual.length; index += 1) {
    if (
      expected[index].missing
      || actual[index].path !== expected[index].path
      || !samePresetIdentity(actual[index], expected[index])
    ) {
      throw new Error(`Preset target parent identity changed: ${relative}`);
    }
  }
}

export async function readPresetFile(rootDirectory, relative) {
  const root = path.resolve(rootDirectory);
  const parents = await capturePresetParentIdentity(root, relative, { allowMissing: true });
  if (parents.some((entry) => entry.missing)) return null;
  const target = absoluteTarget(root, relative);
  try {
    const details = await lstat(target);
    if (details.isSymbolicLink() || !details.isFile()) {
      throw new Error(`Preset target must be a regular file: ${relative}`);
    }
    return await readFile(target);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

function workerChannel(child) {
  const messages = [];
  const waiters = [];
  let stderr = "";
  let buffer = "";
  let closed = false;
  let closeResult;

  function deliver(message) {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(message);
    else messages.push(message);
  }

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n");
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim()) {
        try {
          deliver(JSON.parse(line));
        } catch (error) {
          while (waiters.length > 0) waiters.shift().reject(error);
        }
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  child.once("close", (code, signal) => {
    closed = true;
    closeResult = { code, signal };
    while (waiters.length > 0) {
      waiters.shift().reject(
        new Error(`Pinned mutation worker exited before responding (${code ?? signal}): ${stderr}`),
      );
    }
  });

  return {
    next() {
      if (messages.length > 0) return Promise.resolve(messages.shift());
      if (closed) {
        return Promise.reject(
          new Error(`Pinned mutation worker already exited (${closeResult.code ?? closeResult.signal}): ${stderr}`),
        );
      }
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    stderr() {
      return stderr;
    },
  };
}

function validateReady(relative, expected, ready, knownCreated = {}) {
  if (!Array.isArray(ready.chain) || ready.chain.length !== expected.length) {
    throw new Error(`Pinned mutation parent chain changed: ${relative}`);
  }
  const created = [];
  for (let index = 0; index < expected.length; index += 1) {
    const before = expected[index];
    const current = ready.chain[index];
    if (before.path !== current.path) {
      throw new Error(`Pinned mutation parent chain changed: ${relative}`);
    }
    if (before.missing) {
      const known = knownCreated[current.path];
      if (!current.created && (!known || !samePresetIdentity(known, current))) {
        throw new Error(`Pinned mutation missing parent was not transaction-created: ${current.path}`);
      }
      if (current.created) created.push(current);
      continue;
    }
    if (!samePresetIdentity(before, current)) {
      throw new Error(`Pinned mutation parent identity changed: ${relative}`);
    }
  }
  return created;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function closeAndReap(child, exited, timeout) {
  clearTimeout(timeout);
  if (!child.stdin.destroyed) child.stdin.end();
  if (child.exitCode === null && child.signalCode === null) {
    await Promise.race([exited, delay(WORKER_CLOSE_GRACE_MS)]);
  }
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await exited;
}

export async function openPresetMutation(rootDirectory, relative, expected, options = {}) {
  const root = path.resolve(rootDirectory);
  const workerLease = newProcessLease(
    "preset-mutation-worker",
    {
      relative,
      allowCreate: Boolean(options.allowCreate),
      secureFinal: Boolean(options.secureFinal),
    },
    root,
    PRESET_WORKER_DEADLINE_MS,
  );
  const workerOptions = {
    segments: relativeSegments(root, relative),
    allowCreate: Boolean(options.allowCreate),
    secureFinal: Boolean(options.secureFinal),
    lease: workerLease,
    leasePath: path.join(root, ".agent", "leases", `preset-worker-${workerLease.runId}.json`),
  };
  const workerLeasePath = workerOptions.leasePath;
  const encoded = Buffer.from(JSON.stringify(workerOptions), "utf8").toString("base64url");
  const child = spawn(process.execPath, [WORKER_PATH, encoded], {
    cwd: root,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const exited = new Promise((resolve) => child.once(
    "close",
    (code, signal) => resolve({ code, signal }),
  ));
  const channel = workerChannel(child);
  const timeout = setTimeout(() => child.kill("SIGKILL"), WORKER_TIMEOUT_MS);
  async function closeLeaseAfterVerifiedExit(reason) {
    try {
      await closeProcessLease(
        workerLeasePath,
        { ...workerLease, pid: child.pid },
        { outcome: "reaped-by-parent", reason },
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  let ready;
  let createdParents;
  try {
    options.onWorkerSpawn?.(child.pid);
    ready = await channel.next();
    while (["native-spawn", "native-final"].includes(ready.type)) {
      if (ready.type === "native-spawn") await options.onNativeSpawn?.(ready);
      else await options.onNativeFinal?.(ready);
      ready = await channel.next();
    }
    if (ready.type === "error") throw new Error(ready.message);
    if (ready.type !== "ready" || ready.pid !== child.pid) {
      throw new Error(`Pinned mutation worker identity mismatch: ${relative}`);
    }
    createdParents = validateReady(relative, expected, ready, options.knownCreated);
    await options.onWorkerLease?.({ leasePath: ready.leasePath, lease: ready.lease });
  } catch (error) {
    await closeAndReap(child, exited, timeout);
    await closeLeaseAfterVerifiedExit("readiness-failure");
    throw error;
  }

  let finished = false;
  let acknowledgement = null;

  async function close() {
    if (finished) return;
    finished = true;
    await closeAndReap(child, exited, timeout);
    await closeLeaseAfterVerifiedExit("session-close");
  }

  return {
    pid: child.pid,
    createdParents,
    security: ready.security,
    async acceptCreatedParents(seal, afterSeal) {
      if (acknowledgement) return acknowledgement;
      if (createdParents.length > 0 && typeof seal !== "function") {
        throw new Error("Created preset parents require a durable ownership seal");
      }
      if (createdParents.length > 0) await seal(createdParents);
      await afterSeal?.();
      child.stdin.write(`${JSON.stringify({ type: "accept" })}\n`);
      const message = await channel.next();
      if (message.type !== "accepted" || message.pid !== child.pid) {
        await close();
        throw new Error(`Pinned mutation worker acceptance mismatch: ${relative}`);
      }
      acknowledgement = { type: "accepted", pid: child.pid };
      return acknowledgement;
    },
    async execute(command) {
      if (finished) throw new Error("Pinned mutation worker is closed");
      if (!acknowledgement) throw new Error("Pinned mutation worker was not durably accepted");
      let preparedCommand = command;
      if (command.sourceRelative) {
        await capturePresetParentIdentity(root, command.sourceRelative);
        const sourcePath = absoluteTarget(root, command.sourceRelative);
        const sourceDetails = await lstat(sourcePath);
        if (sourceDetails.isSymbolicLink() || !sourceDetails.isFile()) {
          throw new Error(`Preset private stage must be a regular file: ${command.sourceRelative}`);
        }
        const { sourceRelative: _sourceRelative, ...rest } = command;
        preparedCommand = {
          ...rest,
          sourcePath,
          sourceIdentity: identity(sourceDetails),
        };
      }
      child.stdin.end(`${JSON.stringify({ type: "execute", command: preparedCommand })}\n`);
      let message;
      try {
        message = await channel.next();
      } catch (error) {
        await close();
        throw error;
      }
      const exit = await exited;
      finished = true;
      clearTimeout(timeout);
      if (message.type === "error") throw new Error(message.message);
      if (message.type !== "result") {
        throw new Error(`Pinned mutation worker protocol error: ${relative}`);
      }
      if (exit.code !== 0) {
        throw new Error(`Pinned mutation worker exited with ${exit.code ?? exit.signal}: ${channel.stderr()}`);
      }
      return message.result;
    },
    close,
  };
}

export async function pinnedPresetFileCommand(root, relative, expectedParents, command, options = {}) {
  const session = await openPresetMutation(root, relative, expectedParents, options);
  try {
    await session.acceptCreatedParents(options.sealCreatedParents);
    return {
      result: await session.execute(command),
      createdParents: session.createdParents,
      security: session.security,
      pid: session.pid,
    };
  } finally {
    await session.close();
  }
}
