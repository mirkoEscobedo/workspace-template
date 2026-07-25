import { createHash, randomUUID } from "node:crypto";
import {
  access,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDirectory(directory) {
  await mkdir(directory, { recursive: true });
}

export async function isDirectoryEmpty(directory) {
  if (!(await exists(directory))) return true;
  const entries = await readdir(directory);
  return entries.length === 0;
}

export async function readText(filePath) {
  return readFile(filePath, "utf8");
}

export async function readTextIfExists(filePath) {
  return (await exists(filePath)) ? readText(filePath) : undefined;
}

export async function writeBytesAtomic(filePath, content) {
  await ensureDirectory(path.dirname(filePath));
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  await writeFile(temporary, content);
  try {
    await rename(temporary, filePath);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function writeText(filePath, content) {
  const normalized = content.endsWith("\n") ? content : `${content}\n`;
  await writeBytesAtomic(filePath, Buffer.from(normalized, "utf8"));
}

export async function writeJson(filePath, value) {
  await writeText(filePath, JSON.stringify(value, null, 2));
}

export async function copyDirectory(source, destination, options = {}) {
  await ensureDirectory(path.dirname(destination));
  await cp(source, destination, {
    recursive: true,
    force: options.force ?? true,
    errorOnExist: options.errorOnExist ?? false,
    dereference: options.dereference ?? false,
    filter: options.filter,
  });
}

export async function copyTree(source, destination, options = {}) {
  const ignored = new Set(options.ignoreNames ?? [".git", "node_modules", ".agentic/transactions"]);
  const root = path.resolve(source);
  return copyDirectory(root, destination, {
    ...options,
    filter(candidate) {
      const relative = toPosixPath(path.relative(root, candidate));
      if (!relative) return true;
      for (const name of ignored) {
        const normalized = toPosixPath(name).replace(/^\.\//, "");
        if (relative === normalized || relative.startsWith(`${normalized}/`)) return false;
      }
      return options.filter ? options.filter(candidate, relative) : true;
    },
  });
}

export async function removePath(target) {
  await rm(target, { recursive: true, force: true });
}

export async function listFiles(directory, options = {}) {
  const output = [];
  if (!(await exists(directory))) return output;
  const ignored = new Set(options.ignoreNames ?? []);

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) output.push(full);
      else if (entry.isSymbolicLink() && options.includeSymlinks) output.push(full);
    }
  }

  await walk(directory);
  return output;
}

export async function listDirectories(directory) {
  if (!(await exists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(directory, entry.name)).sort();
}

export function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function hashText(text) {
  return hashBuffer(Buffer.from(text, "utf8"));
}

export async function hashFile(filePath) {
  return hashBuffer(await readFile(filePath));
}

export async function hashDirectory(directory) {
  const files = await listFiles(directory, { includeSymlinks: true });
  const hash = createHash("sha256");
  for (const file of files) {
    const relative = toPosixPath(path.relative(directory, file));
    hash.update(relative);
    hash.update("\0");
    const details = await lstat(file);
    if (details.isSymbolicLink()) {
      hash.update(`symlink:${await readlink(file)}`);
    } else {
      hash.update(await readFile(file));
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function hashPath(target) {
  const details = await lstat(target);
  if (details.isDirectory()) return hashDirectory(target);
  if (details.isSymbolicLink()) return hashText(`symlink:${await readlink(target)}`);
  return hashFile(target);
}

export async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function readJsonIfExists(filePath) {
  if (!(await exists(filePath))) return undefined;
  return readJson(filePath);
}

export async function fileSize(filePath) {
  const details = await stat(filePath);
  return details.size;
}

export function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

export function fromPosixPath(value) {
  return path.join(...value.split("/"));
}

export function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function assertPathInside(root, candidate, label = "path") {
  if (!isPathInside(root, candidate)) throw new Error(`${label} escapes root: ${candidate}`);
  return candidate;
}

export async function realPathInside(root, candidate) {
  const resolvedRoot = await realpath(root);
  const resolved = await realpath(candidate);
  return isPathInside(resolvedRoot, resolved);
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

export async function snapshotFiles(root, relativePaths) {
  const snapshot = {};
  for (const relative of [...new Set(relativePaths.map(toPosixPath))].sort()) {
    const target = path.join(root, fromPosixPath(relative));
    if (!(await exists(target))) {
      snapshot[relative] = null;
      continue;
    }
    snapshot[relative] = await hashPath(target);
  }
  return snapshot;
}
