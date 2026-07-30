import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants as fsConstants,
  createReadStream,
  openSync,
} from "node:fs";
import {
  lstat,
  mkdtemp,
  open,
  readdir,
  readlink,
  realpath,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  GENERATED_DIRECTORY_POLICY_NAMES,
  isGeneratedDirectory,
} from "../generated-paths.js";
const WORKSPACE_STATE_IGNORES = [
  ".agent/leases",
  ".agentic/plans",
  ".agentic/transactions",
  ".agentic/reports",
];
const FILESYSTEM_IGNORES = [...GENERATED_DIRECTORY_POLICY_NAMES, ...WORKSPACE_STATE_IGNORES];
const EMPTY_HASH = createHash("sha256").digest("hex");

function stripRelativeDecorators(value) {
  return String(value).replace(/^\.\//u, "").replace(/\/+$/u, "");
}

function normalizeGitPath(value) {
  return stripRelativeDecorators(value);
}

function normalizeFilesystemPath(value) {
  return stripRelativeDecorators(String(value).split(path.sep).join("/"));
}

export function normalizeVerificationPath(value) {
  return stripRelativeDecorators(String(value).replaceAll("\\", "/"));
}

export function normalizedVerificationPaths(paths) {
  return [...new Set(paths.map(normalizeVerificationPath).filter(Boolean))].sort();
}

function sortedInventoryPaths(paths) {
  return [...new Set(paths.filter(Boolean))].sort();
}

function isAtOrBelow(relative, candidates) {
  return candidates.some((candidate) => relative === candidate || relative.startsWith(`${candidate}/`));
}

async function readNulPathInventory(filePath) {
  const paths = [];
  const directoryMarkers = [];
  let pending = Buffer.alloc(0);
  function recordPath(record) {
    const value = record.toString("utf8");
    if (value.endsWith("/")) directoryMarkers.push(normalizeGitPath(value));
    paths.push(normalizeGitPath(value));
  }
  for await (const chunk of createReadStream(filePath)) {
    pending = Buffer.concat([pending, chunk]);
    let separator = pending.indexOf(0);
    while (separator >= 0) {
      recordPath(pending.subarray(0, separator));
      pending = pending.subarray(separator + 1);
      separator = pending.indexOf(0);
    }
  }
  if (pending.length > 0) recordPath(pending);
  return {
    paths: sortedInventoryPaths(paths),
    directoryMarkers: sortedInventoryPaths(directoryMarkers),
  };
}

async function readNulPaths(filePath) {
  return (await readNulPathInventory(filePath)).paths;
}

async function readGitlinkPaths(filePath) {
  const paths = [];
  let pending = Buffer.alloc(0);
  for await (const chunk of createReadStream(filePath)) {
    pending = Buffer.concat([pending, chunk]);
    let separator = pending.indexOf(0);
    while (separator >= 0) {
      const record = pending.subarray(0, separator);
      const pathSeparator = record.indexOf(0x09);
      if (pathSeparator >= 0 && record.subarray(0, pathSeparator).toString("ascii").startsWith("160000 ")) {
        paths.push(normalizeGitPath(record.subarray(pathSeparator + 1).toString("utf8")));
      }
      pending = pending.subarray(separator + 1);
      separator = pending.indexOf(0);
    }
  }
  if (pending.length > 0) {
    throw new Error("Could not inventory Git submodules: unterminated git ls-files record");
  }
  return sortedInventoryPaths(paths);
}

async function gitInventory(root) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "workspace-template-git-inventory-"));
  const allPath = path.join(temporary, "all.paths");
  const trackedPath = path.join(temporary, "tracked.paths");
  const stagedPath = path.join(temporary, "staged.paths");
  try {
    function run(args, outputPath) {
      const output = openSync(outputPath, "wx");
      try {
        return spawnSync(
          "git",
          ["-c", "core.fsmonitor=false", "ls-files", ...args, "-z"],
          {
            cwd: root,
            windowsHide: true,
            stdio: ["ignore", output, "pipe"],
            encoding: "utf8",
            timeout: 30_000,
            maxBuffer: 64 * 1024,
          },
        );
      } finally {
        closeSync(output);
      }
    }

    const allResult = run(["--cached", "--others", "--exclude-standard"], allPath);
    if (allResult.error?.code === "ENOENT") {
      throw new Error("Could not inventory Git verification inputs: Git executable is unavailable");
    }
    const allError = allResult.stderr?.trim();
    if (allResult.status !== 0) {
      throw new Error(`Could not inventory Git verification inputs: ${allError || allResult.error?.message || `git exited with code ${allResult.status}`}`);
    }
    const trackedResult = run(["--cached"], trackedPath);
    if (trackedResult.status !== 0 || trackedResult.error) {
      throw new Error(`Could not inventory tracked Git verification inputs: ${trackedResult.stderr?.trim() || trackedResult.error?.message || `git exited with code ${trackedResult.status}`}`);
    }
    const stagedResult = run(["--stage"], stagedPath);
    if (stagedResult.status !== 0 || stagedResult.error) {
      throw new Error(`Could not inventory Git submodules: ${stagedResult.stderr?.trim() || stagedResult.error?.message || `git exited with code ${stagedResult.status}`}`);
    }
    const [all, tracked, gitlinks] = await Promise.all([
      readNulPathInventory(allPath),
      readNulPaths(trackedPath),
      readGitlinkPaths(stagedPath),
    ]);
    const trackedPaths = new Set(tracked);
    const workspaceState = normalizedVerificationPaths(WORKSPACE_STATE_IGNORES);
    return {
      paths: all.paths.filter((relative) => trackedPaths.has(relative) || !isAtOrBelow(relative, workspaceState)),
      gitlinks,
      embeddedRepositories: all.directoryMarkers.filter((relative) => !isAtOrBelow(relative, workspaceState)),
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function hasGitMarker(root) {
  if (process.env.GIT_DIR) return true;
  let current = path.resolve(root);
  while (true) {
    try {
      await lstat(path.join(current, ".git"));
      return true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

async function filesystemInventory(root, options = {}) {
  const paths = [];
  const workspaceState = normalizedVerificationPaths(WORKSPACE_STATE_IGNORES);
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const relative = normalizeFilesystemPath(path.relative(root, target));
      if (options.ignoreWorkspaceState !== false && isAtOrBelow(relative, workspaceState)) continue;
      if (options.ignoreGenerated !== false && entry.isDirectory() && await isGeneratedDirectory(target)) continue;
      if (entry.isDirectory()) await walk(target);
      else paths.push(relative);
    }
  }
  await walk(root);
  return sortedInventoryPaths(paths);
}

export async function inventoryCopiedVerificationInputs(root) {
  return filesystemInventory(root, {
    ignoreGenerated: false,
    ignoreWorkspaceState: false,
  });
}

export async function inventoryVerificationInputs(root) {
  if (!(await hasGitMarker(root))) {
    return {
      paths: await filesystemInventory(root),
      ignoredPaths: normalizedVerificationPaths(FILESYSTEM_IGNORES),
      unsupportedGitlinks: [],
      unsupportedEmbeddedRepositories: [],
    };
  }
  const inventory = await gitInventory(root);
  return {
    paths: inventory.paths,
    ignoredPaths: normalizedVerificationPaths(WORKSPACE_STATE_IGNORES),
    unsupportedGitlinks: inventory.gitlinks,
    unsupportedEmbeddedRepositories: inventory.embeddedRepositories,
  };
}

function updateFrame(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}

function updateRecord(hash, type, relative, size, digest) {
  updateFrame(hash, type);
  updateFrame(hash, relative);
  updateFrame(hash, size);
  updateFrame(hash, digest);
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function sameSnapshot(left, right) {
  return sameIdentity(left, right)
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

export async function captureVerificationRoot(root) {
  const canonicalRoot = await realpath(path.resolve(root));
  const details = await lstat(canonicalRoot, { bigint: true });
  if (details.isSymbolicLink() || !details.isDirectory()) {
    throw new Error(`Verification-input root must be a real directory: ${canonicalRoot}`);
  }
  return { path: canonicalRoot, details };
}

async function assertVerificationRootStable(rootState) {
  const current = await lstat(rootState.path, { bigint: true });
  if (current.isSymbolicLink() || !current.isDirectory() || !sameIdentity(current, rootState.details)) {
    throw new Error(`Verification-input root changed or became a link: ${rootState.path}`);
  }
}

function safeTarget(root, relative) {
  const components = relative.split("/");
  if (!relative || components.some((component) => !component || component === "." || component === "..")) {
    throw new Error(`Unsafe verification-input path '${relative}'`);
  }
  const target = path.resolve(root, ...components);
  const fromRoot = path.relative(root, target);
  if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) {
    throw new Error(`Verification-input path escapes the workspace: '${relative}'`);
  }
  return { target, components };
}

async function captureAncestors(rootState, components) {
  const snapshots = [{ path: rootState.path, details: rootState.details }];
  const root = rootState.path;
  let current = root;
  for (const component of components.slice(0, -1)) {
    current = path.join(current, component);
    let details;
    try {
      details = await lstat(current, { bigint: true });
    } catch (error) {
      if (error.code === "ENOENT") return { snapshots, missing: true };
      throw error;
    }
    if (details.isSymbolicLink() || !details.isDirectory()) {
      throw new Error(`Verification-input ancestor must be a real directory inside the workspace: ${current}`);
    }
    snapshots.push({ path: current, details });
  }
  return { snapshots, missing: false };
}

async function assertAncestorsStable(snapshots) {
  for (const snapshot of snapshots) {
    const current = await lstat(snapshot.path, { bigint: true });
    if (current.isSymbolicLink() || !current.isDirectory() || !sameIdentity(current, snapshot.details)) {
      throw new Error(`Verification-input ancestor changed or became a link: ${snapshot.path}`);
    }
  }
}

export async function existingVerificationInputPaths(root, paths) {
  const rootState = await captureVerificationRoot(root);
  const existing = [];
  await assertVerificationRootStable(rootState);
  for (const relative of sortedInventoryPaths(paths)) {
    const { target, components } = safeTarget(rootState.path, relative);
    const ancestorState = await captureAncestors(rootState, components);
    if (ancestorState.missing) continue;
    await assertAncestorsStable(ancestorState.snapshots);
    try {
      await lstat(target, { bigint: true });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    await assertAncestorsStable(ancestorState.snapshots);
    existing.push(relative);
  }
  await assertVerificationRootStable(rootState);
  return existing;
}

async function assertHandleContained(handle, root) {
  if (process.platform !== "linux") return;
  let openedPath;
  try {
    openedPath = await realpath(`/proc/self/fd/${handle.fd}`);
  } catch {
    return;
  }
  const relative = path.relative(root, openedPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Verification-input file handle escaped the workspace: ${openedPath}`);
  }
}

async function hashRegularFile(root, target, relative, before, ancestors, hooks) {
  await hooks?.afterTerminalLstat?.({ root, target, relative });
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await open(target, fsConstants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameSnapshot(opened, before)) {
      throw new Error(`Verification input changed between inspection and open: ${relative}`);
    }
    await assertAncestorsStable(ancestors);
    await assertHandleContained(handle, root);
    const currentPath = await lstat(target, { bigint: true });
    if (!currentPath.isFile() || !sameSnapshot(currentPath, opened)) {
      throw new Error(`Verification input path changed before hashing: ${relative}`);
    }
    const hash = createHash("sha256");
    let size = 0n;
    for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: 1024 * 1024 })) {
      size += BigInt(chunk.length);
      hash.update(chunk);
    }
    const after = await handle.stat({ bigint: true });
    const finalPath = await lstat(target, { bigint: true });
    await assertAncestorsStable(ancestors);
    if (size !== opened.size || !sameSnapshot(after, opened) || !sameSnapshot(finalPath, opened)) {
      throw new Error(`Verification input changed while hashing: ${relative}`);
    }
    return { size, digest: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

export async function hashVerificationInputs(root, paths, excludedPaths = [], options = {}) {
  const rootState = options.rootState ?? await captureVerificationRoot(root);
  const canonicalRoot = rootState.path;
  await assertVerificationRootStable(rootState);
  const aggregate = createHash("sha256");
  for (const relative of sortedInventoryPaths(paths)) {
    if (isAtOrBelow(relative, excludedPaths)) continue;
    const { target, components } = safeTarget(canonicalRoot, relative);
    const ancestorState = await captureAncestors(rootState, components);
    if (ancestorState.missing) {
      updateRecord(aggregate, "missing", relative, 0, EMPTY_HASH);
      continue;
    }
    const ancestors = ancestorState.snapshots;
    await options.hooks?.afterAncestorValidation?.({ root: canonicalRoot, target, relative });
    await assertAncestorsStable(ancestors);
    let details;
    try {
      details = await lstat(target, { bigint: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        updateRecord(aggregate, "missing", relative, 0, EMPTY_HASH);
        continue;
      }
      throw error;
    }
    if (details.isSymbolicLink()) {
      const linkTarget = await readlink(target, { encoding: "buffer" });
      await assertAncestorsStable(ancestors);
      const after = await lstat(target, { bigint: true });
      if (!after.isSymbolicLink() || !sameIdentity(details, after)) {
        throw new Error(`Verification-input symlink changed while hashing: ${relative}`);
      }
      updateRecord(aggregate, "symlink", relative, linkTarget.length, createHash("sha256").update(linkTarget).digest("hex"));
    } else if (details.isFile()) {
      const hashed = await hashRegularFile(canonicalRoot, target, relative, details, ancestors, options.hooks);
      updateRecord(aggregate, "file", relative, hashed.size, hashed.digest);
    } else {
      await assertAncestorsStable(ancestors);
      updateRecord(aggregate, "other", relative, details.size, EMPTY_HASH);
    }
  }
  await assertVerificationRootStable(rootState);
  return aggregate.digest("hex");
}

export async function sealVerificationInputSet(root, excludedPaths = [], options = {}) {
  const rootState = await captureVerificationRoot(root);
  const inventory = await inventoryVerificationInputs(rootState.path);
  await options.hooks?.afterInventory?.({ root: rootState.path });
  await assertVerificationRootStable(rootState);
  const hash = await hashVerificationInputs(
    rootState.path,
    inventory.paths,
    excludedPaths,
    { ...options, rootState },
  );
  await assertVerificationRootStable(rootState);
  const finalInventory = await inventoryVerificationInputs(rootState.path);
  if (JSON.stringify(finalInventory) !== JSON.stringify(inventory)) {
    throw new Error("Verification-input inventory changed while sealing");
  }
  await assertVerificationRootStable(rootState);
  return {
    hash,
    ignoredPaths: inventory.ignoredPaths,
    paths: inventory.paths,
    unsupportedGitlinks: inventory.unsupportedGitlinks,
    unsupportedEmbeddedRepositories: inventory.unsupportedEmbeddedRepositories,
  };
}
