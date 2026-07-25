import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { commandExists, runCommandCapture } from "../process-utils.js";
import { removePath } from "../fs-utils.js";

function requireGit(args, cwd, timeout = 120_000) {
  const result = runCommandCapture("git", args, { cwd, timeout });
  if (result.status !== 0 || result.error) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout || result.error?.message || "unknown Git error").trim()}`);
  }
  return (result.stdout ?? "").trim();
}

/**
 * Create a detached worktree at reviewed HEAD. Dirty trees are intentionally
 * rejected because a detached worktree cannot faithfully represent their
 * uncommitted state; createCheckpoint may fall back to a staged copy.
 */
export async function createGitWorktree(root, options = {}) {
  if (!commandExists("git")) throw new Error("git is not available");
  const sourceRoot = path.resolve(root);
  const top = path.resolve(requireGit(["rev-parse", "--show-toplevel"], sourceRoot));
  if (top !== sourceRoot) throw new Error(`checkpoint target must be the Git root (${top})`);
  const status = requireGit(["status", "--porcelain", "--untracked-files=all"], sourceRoot);
  if (status) throw new Error("Git worktree checkpoint requires a clean source worktree");

  const directory = await mkdtemp(path.join(options.baseDirectory ?? os.tmpdir(), options.prefix ?? "workspace-template-worktree-"));
  const workRoot = path.join(directory, "worktree");
  try {
    requireGit(["worktree", "add", "--detach", workRoot, "HEAD"], sourceRoot);
  } catch (error) {
    await removePath(directory).catch(() => {});
    throw error;
  }
  return { mode: "worktree", directory, workRoot, sourceRoot };
}

export async function disposeGitWorktree(checkpoint) {
  if (!checkpoint) return;
  if (checkpoint.sourceRoot && checkpoint.workRoot) {
    const removed = runCommandCapture("git", ["worktree", "remove", "--force", checkpoint.workRoot], {
      cwd: checkpoint.sourceRoot,
      timeout: 120_000,
    });
    if (removed.status !== 0) {
      runCommandCapture("git", ["worktree", "prune"], { cwd: checkpoint.sourceRoot, timeout: 120_000 });
    }
  }
  if (checkpoint.directory) await removePath(checkpoint.directory).catch(() => {});
}
