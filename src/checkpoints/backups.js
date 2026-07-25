import { lstat, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertPathInside,
  copyDirectory,
  ensureDirectory,
  exists,
  fromPosixPath,
  removePath,
  toPosixPath,
  writeJson,
} from "../fs-utils.js";

/** Create a file/directory/symlink backup for an explicit reviewed path set. */
export async function createFileBackup(root, relativePaths, options = {}) {
  const resolvedRoot = path.resolve(root);
  const directory = await mkdtemp(path.join(options.baseDirectory ?? os.tmpdir(), "workspace-template-backup-"));
  const manifest = { version: 1, root: resolvedRoot, files: {} };
  for (const raw of [...new Set(relativePaths.map(toPosixPath))].sort()) {
    const source = assertPathInside(resolvedRoot, path.resolve(resolvedRoot, fromPosixPath(raw)), "backup path");
    if (!(await exists(source))) {
      manifest.files[raw] = { state: "absent" };
      continue;
    }
    const destination = path.join(directory, "files", fromPosixPath(raw));
    await ensureDirectory(path.dirname(destination));
    const stats = await lstat(source);
    if (stats.isDirectory()) {
      await copyDirectory(source, destination, { dereference: false });
      manifest.files[raw] = { state: "directory" };
    } else if (stats.isSymbolicLink()) {
      const target = await readlink(source);
      await symlink(target, destination);
      manifest.files[raw] = { state: "symlink", target };
    } else if (stats.isFile()) {
      await writeFile(destination, await readFile(source));
      manifest.files[raw] = { state: "file" };
    } else {
      await removePath(directory);
      throw new Error(`Unsupported backup path type: ${raw}`);
    }
  }
  await writeJson(path.join(directory, "manifest.json"), manifest);
  return { mode: "backup", directory, manifest };
}

export async function restoreFileBackup(backup) {
  const root = path.resolve(backup.manifest.root);
  for (const [relative, record] of Object.entries(backup.manifest.files)) {
    const destination = assertPathInside(root, path.resolve(root, fromPosixPath(relative)), "backup restore path");
    await rm(destination, { recursive: true, force: true });
    if (record.state === "absent") continue;
    const source = path.join(backup.directory, "files", fromPosixPath(relative));
    await ensureDirectory(path.dirname(destination));
    if (record.state === "directory") await copyDirectory(source, destination, { dereference: false });
    else if (record.state === "symlink") await symlink(record.target, destination);
    else await writeFile(destination, await readFile(source));
  }
}

export async function disposeBackup(backup) {
  if (backup?.directory) await removePath(backup.directory);
}
