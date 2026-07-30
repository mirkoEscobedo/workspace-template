import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { copyTree, removePath } from "../fs-utils.js";

/** Create a bounded staged copy for mutation and verification. */
export async function createCopyCheckpoint(root, options = {}) {
  const sourceRoot = path.resolve(root);
  const directory = await mkdtemp(path.join(options.baseDirectory ?? os.tmpdir(), options.prefix ?? "workspace-template-checkpoint-"));
  const workRoot = path.join(directory, "worktree");
  const callerFilter = options.filter;
  await copyTree(sourceRoot, workRoot, {
    includePaths: options.includePaths,
    ignoreNames: options.ignoreNames ?? [
      ".git",
      ".agentic/transactions",
    ],
    ignoreGeneratedDirectories: options.ignoreGeneratedDirectories ?? true,
    filter(candidate, relative) {
      if (relative.startsWith(".agent/leases/") && relative !== ".agent/leases/.gitkeep") return false;
      return callerFilter ? callerFilter(candidate, relative) : true;
    },
  });
  return { mode: "copy", directory, workRoot, sourceRoot };
}

export async function disposeCopyCheckpoint(checkpoint) {
  if (checkpoint?.directory) await removePath(checkpoint.directory);
}
