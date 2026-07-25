import { lstat, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  exists,
  fromPosixPath,
  hashBuffer,
  isPathInside,
  listFiles,
  removePath,
  toPosixPath,
  writeBytesAtomic,
} from "../fs-utils.js";
import { commandExists, runCommandCapture } from "../process-utils.js";

export function mergePackageScripts(document, requestedScripts = {}, policy = "propose") {
  const value = structuredClone(document ?? {});
  value.scripts ??= {};
  const conflicts = [];
  const additions = [];
  const replacements = [];
  for (const [key, proposed] of Object.entries(requestedScripts).sort(([a], [b]) => a.localeCompare(b))) {
    const current = value.scripts[key];
    if (current === undefined) {
      value.scripts[key] = proposed;
      additions.push(key);
      continue;
    }
    if (current === proposed) continue;
    conflicts.push({ key, current, proposed });
    if (policy === "managed-block" || policy === "replace") {
      value.scripts[key] = proposed;
      replacements.push(key);
    }
  }
  return { value, conflicts, additions, replacements };
}

export async function planPackageScripts(root, module, scripts, policy = "propose") {
  if (!scripts || Object.keys(scripts).length === 0) return [];
  if (!["typescript", "javascript", "react"].includes(module.project)) return [];
  const relative = toPosixPath(path.posix.join(module.path === "." ? "" : module.path, "package.json"));
  const file = path.resolve(root, relative);
  const current = JSON.parse(await readFile(file, "utf8"));
  const merged = mergePackageScripts(current, scripts, policy);
  if (merged.conflicts.length > 0 && policy === "fail") {
    throw new Error(`Package script conflicts in ${relative}: ${merged.conflicts.map((item) => item.key).join(", ")}`);
  }
  return [{
    kind: "merge-package-scripts",
    path: relative,
    policy,
    scripts: Object.fromEntries(Object.entries(scripts).sort(([a], [b]) => a.localeCompare(b))),
    currentHash: hashBuffer(await readFile(file)),
    reason: "structured package-script integration",
    conflictKeys: merged.conflicts.map((item) => item.key),
  }];
}

export async function snapshotFiles(root, relativePaths) {
  const snapshot = {};
  for (const relative of [...new Set(relativePaths.filter(Boolean).map(toPosixPath))].sort()) {
    const target = path.resolve(root, relative);
    if (!isPathInside(root, target)) throw new Error(`Snapshot path escapes root: ${relative}`);
    if (!(await exists(target))) {
      snapshot[relative] = { exists: false };
      continue;
    }
    const details = await lstat(target);
    if (!details.isFile()) throw new Error(`Rollback snapshot supports files only: ${relative}`);
    const content = await readFile(target);
    snapshot[relative] = {
      exists: true,
      contentEncoding: "base64",
      content: content.toString("base64"),
      hash: hashBuffer(content),
      mode: details.mode,
    };
  }
  return snapshot;
}

export async function restoreFiles(root, snapshot) {
  for (const [relative, record] of Object.entries(snapshot ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    const target = path.resolve(root, relative);
    if (!isPathInside(root, target)) throw new Error(`Restore path escapes root: ${relative}`);
    if (!record.exists) {
      await rm(target, { recursive: true, force: true });
      continue;
    }
    const content = Buffer.from(record.content, record.contentEncoding ?? "base64");
    if (record.hash && hashBuffer(content) !== record.hash) throw new Error(`Rollback snapshot is corrupt: ${relative}`);
    await writeBytesAtomic(target, content);
  }
}

export function applyJsonPointer(document, pointer, value) {
  const parts = pointer
    .replace(/^\//, "")
    .split("/")
    .filter(Boolean)
    .map((item) => item.replaceAll("~1", "/").replaceAll("~0", "~"));
  if (parts.length === 0) return value;
  let current = document;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    current = current[part] ??= {};
  }
  current[parts.at(-1)] = value;
  return document;
}


function pointerParts(pointer) {
  if (typeof pointer !== "string" || !pointer.startsWith("/")) throw new Error(`Structured config patch path must be a JSON pointer: ${pointer}`);
  return pointer
    .slice(1)
    .split("/")
    .filter(Boolean)
    .map((item) => item.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function serializeYamlScalar(value) {
  if (Array.isArray(value)) return `[${value.map(serializeYamlScalar).join(", ")}]`;
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const text = String(value);
  if (/^[A-Za-z0-9_./@:+-][A-Za-z0-9_./@:+*?-]*$/.test(text)) return text;
  return JSON.stringify(text);
}

function parseYamlSimple(value) {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null" || trimmed === "~") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const body = trimmed.slice(1, -1).trim();
    return body ? body.split(",").map((item) => parseYamlSimple(item.trim())) : [];
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

function yamlIndex(lines) {
  const output = new Map();
  const stack = [];
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const match = /^(\s*)([A-Za-z0-9_.@/-]+):(?:\s*(.*?))?\s*$/.exec(raw.replace(/\s+#.*$/, ""));
    if (!match) continue;
    const indent = match[1].length;
    while (stack.length > 0 && stack.at(-1).indent >= indent) stack.pop();
    const path = [...(stack.at(-1)?.path ?? []), match[2]];
    const value = match[3] ?? "";
    output.set(path.join("/"), { index, indent, key: match[2], value, path });
    if (!value) stack.push({ indent, path });
  }
  return output;
}

function yamlSubtreeEnd(lines, record) {
  let index = record.index + 1;
  while (index < lines.length) {
    const text = lines[index];
    if (!text.trim()) { index += 1; continue; }
    const indent = text.match(/^\s*/)?.[0].length ?? 0;
    if (indent <= record.indent) break;
    index += 1;
  }
  return index;
}

function patchYaml(text, patches, policy) {
  const lines = String(text ?? "").replaceAll("\r\n", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const conflicts = [];
  const additions = [];
  const replacements = [];
  for (const patch of patches) {
    const parts = pointerParts(patch.path);
    if (parts.length === 0) throw new Error("YAML config patches must target a key");
    let index = yamlIndex(lines);
    const key = parts.join("/");
    const existing = index.get(key);
    if (existing) {
      if (!existing.value) {
        conflicts.push({ path: patch.path, current: "<mapping>", proposed: patch.value, reason: "existing YAML value is a nested mapping" });
        continue;
      }
      const current = parseYamlSimple(existing.value);
      if (sameValue(current, patch.value)) continue;
      conflicts.push({ path: patch.path, current, proposed: patch.value });
      if (["managed-block", "replace"].includes(policy)) {
        lines[existing.index] = `${" ".repeat(existing.indent)}${existing.key}: ${serializeYamlScalar(patch.value)}`;
        replacements.push(patch.path);
      }
      continue;
    }
    let parentPath = parts.slice(0, -1);
    let parent;
    while (parentPath.length > 0 && !(parent = index.get(parentPath.join("/")))) parentPath = parentPath.slice(0, -1);
    if (parentPath.length !== parts.length - 1) {
      // Add missing mapping chain at the end. This conservative writer does not
      // attempt to merge complex anchors, tags, or flow mappings.
      let indent = 0;
      const newLines = [];
      for (let position = 0; position < parts.length - 1; position += 1) {
        const prefix = parts.slice(0, position + 1).join("/");
        if (!index.has(prefix)) newLines.push(`${" ".repeat(indent)}${parts[position]}:`);
        indent += 2;
      }
      newLines.push(`${" ".repeat(indent)}${parts.at(-1)}: ${serializeYamlScalar(patch.value)}`);
      if (lines.length > 0 && lines.at(-1).trim()) lines.push("");
      lines.push(...newLines);
    } else if (parent) {
      const insertion = yamlSubtreeEnd(lines, parent);
      lines.splice(insertion, 0, `${" ".repeat(parent.indent + 2)}${parts.at(-1)}: ${serializeYamlScalar(patch.value)}`);
    } else {
      lines.push(`${parts.at(-1)}: ${serializeYamlScalar(patch.value)}`);
    }
    additions.push(patch.path);
  }
  return { content: `${lines.join("\n")}\n`, conflicts, additions, replacements };
}

function serializeTomlScalar(value) {
  if (Array.isArray(value)) return `[${value.map(serializeTomlScalar).join(", ")}]`;
  if (value === null) throw new Error("TOML does not support null scalar values");
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(String(value));
}

function parseTomlSimple(value) {
  const trimmed = value.trim().replace(/\s+#.*$/, "");
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const body = trimmed.slice(1, -1).trim();
    return body ? body.split(",").map((item) => parseTomlSimple(item.trim())) : [];
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

function tomlIndex(lines) {
  const sections = new Map([["", { start: 0, end: lines.length }]]);
  let current = "";
  for (let index = 0; index < lines.length; index += 1) {
    const section = /^\s*\[([^\]]+)\]\s*$/.exec(lines[index]);
    if (section) {
      if (sections.has(current)) sections.get(current).end = index;
      current = section[1].trim();
      sections.set(current, { start: index + 1, header: index, end: lines.length });
    }
  }
  const keys = new Map();
  for (const [section, range] of sections) {
    for (let index = range.start; index < range.end; index += 1) {
      const pair = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.*?)\s*$/.exec(lines[index]);
      if (pair) keys.set(`${section}/${pair[1]}`, { section, key: pair[1], value: pair[2], index });
    }
  }
  return { sections, keys };
}

function patchToml(text, patches, policy) {
  const lines = String(text ?? "").replaceAll("\r\n", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const conflicts = [];
  const additions = [];
  const replacements = [];
  for (const patch of patches) {
    const parts = pointerParts(patch.path);
    if (parts.length === 0) throw new Error("TOML config patches must target a key");
    const section = parts.length === 1 ? "" : parts.slice(0, -1).join(".");
    const key = parts.at(-1);
    let index = tomlIndex(lines);
    const existing = index.keys.get(`${section}/${key}`);
    if (existing) {
      const current = parseTomlSimple(existing.value);
      if (sameValue(current, patch.value)) continue;
      conflicts.push({ path: patch.path, current, proposed: patch.value });
      if (["managed-block", "replace"].includes(policy)) {
        lines[existing.index] = `${key} = ${serializeTomlScalar(patch.value)}`;
        replacements.push(patch.path);
      }
      continue;
    }
    if (!index.sections.has(section)) {
      if (lines.length > 0 && lines.at(-1).trim()) lines.push("");
      if (section) lines.push(`[${section}]`);
      lines.push(`${key} = ${serializeTomlScalar(patch.value)}`);
    } else {
      const range = index.sections.get(section);
      lines.splice(range.end, 0, `${key} = ${serializeTomlScalar(patch.value)}`);
    }
    additions.push(patch.path);
  }
  return { content: `${lines.join("\n")}\n`, conflicts, additions, replacements };
}

function patchJson(text, patches, policy) {
  const document = String(text ?? "").trim() ? JSON.parse(text) : {};
  const conflicts = [];
  const additions = [];
  const replacements = [];
  for (const patch of patches) {
    const parts = pointerParts(patch.path);
    let current = document;
    for (let index = 0; index < parts.length - 1; index += 1) {
      if (current[parts[index]] === undefined) current[parts[index]] = {};
      if (!current[parts[index]] || typeof current[parts[index]] !== "object" || Array.isArray(current[parts[index]])) {
        conflicts.push({ path: patch.path, current: current[parts[index]], proposed: patch.value, reason: "parent is not a mapping" });
        current = undefined;
        break;
      }
      current = current[parts[index]];
    }
    if (!current) continue;
    const key = parts.at(-1);
    const existing = current[key];
    if (existing === undefined) {
      current[key] = structuredClone(patch.value);
      additions.push(patch.path);
    } else if (!sameValue(existing, patch.value)) {
      conflicts.push({ path: patch.path, current: existing, proposed: patch.value });
      if (["managed-block", "replace"].includes(policy)) {
        current[key] = structuredClone(patch.value);
        replacements.push(patch.path);
      }
    }
  }
  return { content: `${JSON.stringify(document, null, 2)}\n`, conflicts, additions, replacements };
}

export function mergeStructuredConfig(text, format, patches, policy = "propose") {
  if (!["propose", "preserve", "managed-block", "replace", "fail"].includes(policy)) throw new Error(`Unknown structured config policy: ${policy}`);
  const normalizedPatches = [...(patches ?? [])]
    .map((patch) => ({ path: patch.path, value: structuredClone(patch.value) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const mergePolicy = policy === "fail" ? "preserve" : policy;
  let result;
  if (format === "json") result = patchJson(text, normalizedPatches, mergePolicy);
  else if (format === "yaml" || format === "yml") result = patchYaml(text, normalizedPatches, mergePolicy);
  else if (format === "toml") result = patchToml(text, normalizedPatches, mergePolicy);
  else throw new Error(`Unsupported structured config format: ${format}`);
  const proposal = result.conflicts.length > 0 && policy === "propose"
    ? (format === "json" ? patchJson(text, normalizedPatches, "replace") : format === "toml" ? patchToml(text, normalizedPatches, "replace") : patchYaml(text, normalizedPatches, "replace"))
    : result;
  return { ...result, proposedContent: proposal.content };
}

function inferConfigFormat(relative, explicit) {
  if (explicit) return explicit.toLowerCase();
  const extension = path.extname(relative).toLowerCase();
  if (extension === ".json") return "json";
  if ([".yaml", ".yml"].includes(extension)) return "yaml";
  if (extension === ".toml") return "toml";
  throw new Error(`Cannot infer structured config format for ${relative}`);
}

export async function planStructuredConfigs(root, module, configs = [], policy = "propose") {
  const operations = [];
  const conflicts = [];
  for (const config of configs) {
    const relative = toPosixPath(path.posix.join(module.path === "." ? "" : module.path, config.path));
    const target = path.resolve(root, relative);
    const present = await exists(target);
    const current = present ? await readFile(target) : Buffer.from("");
    const format = inferConfigFormat(relative, config.format);
    const merged = mergeStructuredConfig(current.toString("utf8"), format, config.patches ?? [], policy);
    const proposalPath = `.agentic/proposals/tooling/${module.id}/${toPosixPath(config.path)}`;
    const operation = {
      kind: "merge-structured-config",
      path: relative,
      moduleId: module.id,
      format,
      policy,
      patches: config.patches ?? [],
      currentHash: present ? hashBuffer(current) : null,
      contentEncoding: "base64",
      content: Buffer.from(merged.content, "utf8").toString("base64"),
      proposedHash: hashBuffer(Buffer.from(merged.content, "utf8")),
      proposalPath,
      proposalContentEncoding: "base64",
      proposalContent: Buffer.from(merged.proposedContent, "utf8").toString("base64"),
      proposalHash: hashBuffer(Buffer.from(merged.proposedContent, "utf8")),
      conflicts: merged.conflicts,
      additions: merged.additions,
      replacements: merged.replacements,
      reason: "structured JSON/YAML/TOML tooling configuration integration",
    };
    operations.push(operation);
    if (policy === "fail" && merged.conflicts.length > 0) {
      conflicts.push(`${module.id}: ${relative} conflicts at ${merged.conflicts.map((item) => item.path).join(", ")}`);
    }
  }
  return { operations, conflicts };
}


const MUTATION_IGNORE_NAMES = Object.freeze([
  ".git",
  ".agentic",
  "node_modules",
  "target",
  "build",
  "dist",
  "coverage",
  ".dart_tool",
  ".gradle",
  ".next",
  ".turbo",
]);

function normalizeApprovedPaths(paths) {
  return [...new Set((paths ?? []).filter(Boolean).map((item) => toPosixPath(item).replace(/^\.\//, "").replace(/\/$/, "")))].sort();
}

function pathApproved(relative, approved) {
  const normalized = toPosixPath(relative).replace(/^\.\//, "");
  return approved.some((candidate) => normalized === candidate || normalized.startsWith(`${candidate}/`));
}

function unquoteGitPath(value) {
  const trimmed = value.trim();
  if (!(trimmed.startsWith('"') && trimmed.endsWith('"'))) return trimmed.replaceAll("\\", "/");
  // `git status --porcelain` uses C-style quoting. JSON parsing handles the
  // common escaped forms and keeps argv/path handling shell-free.
  try {
    return JSON.parse(trimmed).replaceAll("\\", "/");
  } catch {
    return trimmed.slice(1, -1).replaceAll("\\", "/");
  }
}

function parseGitStatus(text) {
  const records = [];
  for (const line of String(text ?? "").split(/\r?\n/).filter(Boolean)) {
    const code = line.slice(0, 2);
    const body = line.length > 3 ? line.slice(3) : "";
    const pieces = body.includes(" -> ") ? body.split(" -> ") : [body];
    const paths = pieces.map(unquoteGitPath).filter(Boolean);
    records.push({ code, paths });
  }
  return records;
}

async function readRecord(root, relative) {
  const target = path.join(root, fromPosixPath(relative));
  if (!(await exists(target))) return { exists: false };
  const details = await lstat(target);
  if (!details.isFile()) return { exists: true, kind: details.isDirectory() ? "directory" : "other" };
  const content = await readFile(target);
  return {
    exists: true,
    kind: "file",
    hash: hashBuffer(content),
    content: content.toString("base64"),
    encoding: "base64",
    mode: details.mode,
  };
}

function statusMap(records) {
  const output = new Map();
  for (const record of records) for (const relative of record.paths) output.set(relative, record.code);
  return output;
}

async function gitBoundary(root, approved) {
  if (!commandExists("git")) return undefined;
  const top = runCommandCapture("git", ["rev-parse", "--show-toplevel"], { cwd: root });
  if (top.status !== 0 || path.resolve(top.stdout.trim()) !== path.resolve(root)) return undefined;
  const status = runCommandCapture("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root });
  if (status.status !== 0) return undefined;
  const beforeRecords = parseGitStatus(status.stdout);
  const beforePaths = [...new Set(beforeRecords.flatMap((record) => record.paths))].sort();
  const before = {};
  for (const relative of beforePaths) before[relative] = await readRecord(root, relative);
  return { mode: "git", root: path.resolve(root), approved, beforeRecords, before };
}

async function copyBoundary(root, approved, options = {}) {
  const files = await listFiles(root, { ignoreNames: options.ignoreNames ?? MUTATION_IGNORE_NAMES });
  const before = {};
  let totalBytes = 0;
  const maxBytes = options.maxSnapshotBytes ?? 256 * 1024 * 1024;
  for (const file of files) {
    const relative = toPosixPath(path.relative(root, file));
    const content = await readFile(file);
    totalBytes += content.length;
    if (totalBytes > maxBytes) {
      throw new Error(`Repository mutation snapshot exceeds ${maxBytes} bytes outside ignored build/cache paths; use a clean Git repository for transactional tooling changes`);
    }
    const details = await lstat(file);
    before[relative] = {
      exists: true,
      kind: "file",
      hash: hashBuffer(content),
      content: content.toString("base64"),
      encoding: "base64",
      mode: details.mode,
    };
  }
  return { mode: "copy", root: path.resolve(root), approved, before, totalBytes };
}

/**
 * Capture a boundary used to prove that a package-manager transaction changed
 * only the paths recorded in its reviewed plan. Git repositories avoid a full
 * source copy: clean tracked files can be restored from HEAD, while existing
 * dirty/untracked files are snapshotted byte-for-byte. Non-Git repositories
 * receive a bounded content snapshot outside common caches/build outputs.
 */
export async function snapshotMutationBoundary(root, approvedPaths = [], options = {}) {
  const approved = normalizeApprovedPaths(approvedPaths);
  return (await gitBoundary(root, approved)) ?? copyBoundary(root, approved, options);
}

async function currentCopyRecords(boundary) {
  const files = await listFiles(boundary.root, { ignoreNames: MUTATION_IGNORE_NAMES });
  const output = {};
  for (const file of files) {
    const relative = toPosixPath(path.relative(boundary.root, file));
    const content = await readFile(file);
    output[relative] = { exists: true, kind: "file", hash: hashBuffer(content) };
  }
  return output;
}

export async function inspectMutationBoundary(boundary) {
  const changed = [];
  if (boundary.mode === "git") {
    const status = runCommandCapture("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: boundary.root });
    if (status.status !== 0) throw new Error(`Unable to inspect tooling transaction diff: ${status.stderr || status.stdout}`);
    const afterRecords = parseGitStatus(status.stdout);
    const beforeStatus = statusMap(boundary.beforeRecords);
    const afterStatus = statusMap(afterRecords);
    const candidates = new Set([...beforeStatus.keys(), ...afterStatus.keys()]);
    for (const relative of candidates) {
      const beforeRecord = boundary.before[relative];
      const current = await readRecord(boundary.root, relative);
      const statusChanged = beforeStatus.get(relative) !== afterStatus.get(relative);
      const contentChanged = beforeRecord
        ? beforeRecord.exists !== current.exists || beforeRecord.hash !== current.hash || beforeRecord.kind !== current.kind
        : Boolean(current.exists);
      if (!statusChanged && !contentChanged) continue;
      changed.push({
        path: relative,
        approved: pathApproved(relative, boundary.approved),
        before: beforeRecord ?? { exists: false },
        after: current,
        beforeStatus: beforeStatus.get(relative),
        afterStatus: afterStatus.get(relative),
        trackedBefore: beforeStatus.get(relative) !== "??" && beforeStatus.has(relative),
      });
    }
  } else {
    const after = await currentCopyRecords(boundary);
    for (const relative of new Set([...Object.keys(boundary.before), ...Object.keys(after)])) {
      const beforeRecord = boundary.before[relative] ?? { exists: false };
      const current = after[relative] ?? { exists: false };
      if (beforeRecord.exists === current.exists && beforeRecord.hash === current.hash && beforeRecord.kind === current.kind) continue;
      changed.push({ path: relative, approved: pathApproved(relative, boundary.approved), before: beforeRecord, after: current });
    }
  }
  changed.sort((a, b) => a.path.localeCompare(b.path));
  const unexpected = changed.filter((entry) => !entry.approved);
  return { ok: unexpected.length === 0, changed, unexpected };
}

async function restoreRecord(root, relative, record) {
  const target = path.join(root, fromPosixPath(relative));
  if (!record?.exists) {
    await removePath(target);
    return;
  }
  if (record.kind !== "file" || !record.content) throw new Error(`Cannot restore non-file tooling mutation at ${relative}`);
  const content = Buffer.from(record.content, record.encoding ?? "base64");
  if (record.hash && hashBuffer(content) !== record.hash) throw new Error(`Mutation snapshot is corrupt: ${relative}`);
  await writeBytesAtomic(target, content);
}

export async function restoreUnexpectedMutations(boundary, inspection) {
  const errors = [];
  for (const change of inspection?.unexpected ?? []) {
    try {
      if (change.before?.content) {
        await restoreRecord(boundary.root, change.path, change.before);
        continue;
      }
      if (boundary.mode === "git" && change.afterStatus !== "??") {
        // The path was clean before the transaction, so restoring from HEAD is
        // safe. Existing dirty/untracked paths always carry a byte snapshot.
        const result = runCommandCapture("git", ["checkout", "--", change.path], { cwd: boundary.root });
        if (result.status !== 0) throw new Error(result.stderr || result.stdout || "git checkout failed");
        continue;
      }
      await restoreRecord(boundary.root, change.path, change.before ?? { exists: false });
    } catch (error) {
      errors.push(`${change.path}: ${error.message ?? error}`);
    }
  }
  if (errors.length > 0) throw new Error(`Unable to restore unexpected tooling mutations:\n- ${errors.join("\n- ")}`);
}
