import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { copyTree, removePath } from "../fs-utils.js";

/** Create a bounded staged copy for mutation and verification. */
export async function createCopyCheckpoint(root, options = {}) {
  const sourceRoot = path.resolve(root);
  const directory = await mkdtemp(path.join(options.baseDirectory ?? os.tmpdir(), options.prefix ?? "workspace-template-checkpoint-"));
  const workRoot = path.join(directory, "worktree");
  await copyTree(sourceRoot, workRoot, {
    ignoreNames: options.ignoreNames ?? [
      ".git",
      "node_modules",
      ".agentic/transactions",
      ".agentic/leases",
    ],
  });
  return { mode: "copy", directory, workRoot, sourceRoot };
}

export async function disposeCopyCheckpoint(checkpoint) {
  if (checkpoint?.directory) await removePath(checkpoint.directory);
}
