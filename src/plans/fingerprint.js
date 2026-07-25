import path from "node:path";
import { exists, hashPath, readJsonIfExists, snapshotFiles, toPosixPath } from "../fs-utils.js";
import { runCommandCapture } from "../process-utils.js";
export async function loadWorkspaceOverrides(root) {
  const value = await readJsonIfExists(path.join(root, ".agentic", "workspace.overrides.json"));
  if (value === undefined) return { version: 1, modules: {} };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(".agentic/workspace.overrides.json must be an object");
  if (value.modules !== undefined && (!value.modules || typeof value.modules !== "object" || Array.isArray(value.modules))) {
    throw new Error("workspace overrides 'modules' must be an object keyed by normalized path");
  }
  return { version: value.version ?? 1, modules: value.modules ?? {}, ...value };
}


export async function gitSnapshot(root) {
  const top = runCommandCapture("git", ["rev-parse", "--show-toplevel"], { cwd: root });
  if (top.status !== 0) return { repository: false };
  const head = runCommandCapture("git", ["rev-parse", "HEAD"], { cwd: root });
  const status = runCommandCapture("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root });
  return {
    repository: true,
    root: path.resolve(top.stdout.trim()),
    head: head.status === 0 ? head.stdout.trim() : null,
    dirtyEntries: status.status === 0 ? status.stdout.split(/\r?\n/).filter(Boolean) : [],
  };
}

export async function filePrecondition(root, relative) {
  const normalized = toPosixPath(relative);
  const target = path.resolve(root, relative);
  return { kind: "path-hash", path: normalized, value: (await exists(target)) ? await hashPath(target) : null };
}

export async function repositoryPreconditions(root, paths = [], options = {}) {
  const output = [{ kind: "root", value: path.resolve(root) }];
  const git = await gitSnapshot(root);
  if (git.repository) {
    output.push({ kind: "git-root", value: git.root });
    output.push({ kind: "git-head", value: git.head });
    output.push({ kind: "git-dirty", value: git.dirtyEntries, allowDirty: Boolean(options.allowDirty) });
  }
  const hashes = await snapshotFiles(root, paths);
  output.push({ kind: "files", value: hashes });
  if (options.workspaceFingerprint !== undefined) output.push({ kind: "workspace", value: options.workspaceFingerprint });
  if (options.catalogPath) output.push(await filePrecondition(root, options.catalogPath));
  return output;
}

export const buildPreconditions = repositoryPreconditions;

function statusPath(entry) {
  const raw = entry.length > 3 ? entry.slice(3).trim() : entry.trim();
  const renamed = raw.includes(" -> ") ? raw.split(" -> ").at(-1) : raw;
  return renamed?.replace(/^"|"$/g, "").replaceAll("\\", "/");
}

export async function verifyPreconditions(plan, options = {}) {
  const errors = [];
  const root = path.resolve(plan.root);
  let git;
  for (const precondition of plan.preconditions ?? []) {
    if (precondition.kind === "root" && path.resolve(precondition.value) !== root) errors.push("repository root changed");
    if (["git-root", "git-head", "git-dirty"].includes(precondition.kind)) git ??= await gitSnapshot(root);
    if (precondition.kind === "git-root" && (!git.repository || path.resolve(git.root) !== path.resolve(precondition.value))) errors.push("Git root changed");
    if (precondition.kind === "git-head" && git.head !== precondition.value) errors.push("Git HEAD changed");
    if (precondition.kind === "git-dirty") {
      const expected = new Set(precondition.value ?? []);
      const allowed = new Set((options.allowedDirtyPaths ?? []).map(toPosixPath));
      const unexpected = (git.dirtyEntries ?? []).filter((entry) => !expected.has(entry) && !allowed.has(statusPath(entry)));
      if (unexpected.length > 0) errors.push(`working tree changed: ${unexpected.join(", ")}`);
    }
    if (precondition.kind === "files") {
      for (const [relative, expected] of Object.entries(precondition.value ?? {})) {
        const target = path.resolve(root, relative);
        const current = (await exists(target)) ? await hashPath(target) : null;
        if (current !== expected) errors.push(`fingerprinted path changed: ${relative}`);
      }
    }
    if (precondition.kind === "path-hash") {
      const target = path.resolve(root, precondition.path);
      const current = (await exists(target)) ? await hashPath(target) : null;
      if (current !== precondition.value) errors.push(`fingerprinted path changed: ${precondition.path}`);
    }
    if (precondition.kind === "workspace" && options.workspaceFingerprint !== undefined && precondition.value !== options.workspaceFingerprint) {
      errors.push("workspace fingerprint changed");
    }
  }
  return errors;
}

export const validatePreconditions = verifyPreconditions;
