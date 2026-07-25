import { createFileBackup, disposeBackup, restoreFileBackup } from "./backups.js";
import { createCopyCheckpoint, disposeCopyCheckpoint } from "./copy.js";
import { createGitWorktree, disposeGitWorktree } from "./worktree.js";

export {
  createCopyCheckpoint,
  createFileBackup,
  createGitWorktree,
  disposeBackup,
  disposeCopyCheckpoint,
  disposeGitWorktree,
  restoreFileBackup,
};

/**
 * Create an isolated checkpoint for high-risk mutations.
 *
 * `worktree` prefers a detached Git worktree and safely falls back to a copy
 * when Git or a clean repository root is unavailable. `copy` and `patch`
 * always use a staged copy; patch mode intentionally leaves patch emission to
 * the operation-specific report so no mutation path bypasses staged checking.
 */
export async function createCheckpoint(root, mode = "worktree", options = {}) {
  if (!["worktree", "copy", "patch"].includes(mode)) {
    throw new Error(`Unsupported checkpoint mode '${mode}'. Choose worktree, copy, or patch.`);
  }
  if (mode === "worktree") {
    try {
      const checkpoint = await createGitWorktree(root, options);
      return {
        ...checkpoint,
        requestedMode: mode,
        root: checkpoint.workRoot,
        cleanup: () => disposeGitWorktree(checkpoint),
      };
    } catch (error) {
      if (options.strict) throw error;
      const checkpoint = await createCopyCheckpoint(root, options);
      return {
        ...checkpoint,
        requestedMode: mode,
        fallbackReason: String(error.message ?? error),
        root: checkpoint.workRoot,
        cleanup: () => disposeCopyCheckpoint(checkpoint),
      };
    }
  }
  const checkpoint = await createCopyCheckpoint(root, options);
  return {
    ...checkpoint,
    mode: mode === "patch" ? "patch-copy" : "copy",
    requestedMode: mode,
    root: checkpoint.workRoot,
    cleanup: () => disposeCopyCheckpoint(checkpoint),
  };
}
