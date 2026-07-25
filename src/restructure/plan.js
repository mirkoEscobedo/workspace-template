import { readFile } from "node:fs/promises";
import path from "node:path";
import { createPlan, filePrecondition, repositoryPreconditions } from "../plans/index.js";
import { discoverWorkspace } from "../workspace/discover.js";
import { exists, hashBuffer, toPosixPath } from "../fs-utils.js";
import { inventoryModule, inferLayoutMoves } from "./inventory.js";
import { planJavaScriptRewrites, rewriteJsonPathValues } from "./adapters/javascript.js";
import { planRustRewrites } from "./adapters/rust.js";
import { planDartRewrites } from "./adapters/dart.js";

function normalizeMove(root, module, value) {
  if (value && typeof value === "object") {
    if (!value.from || !value.to) throw new Error("Move objects require from and to");
    value = `${value.from}=>${value.to}`;
  }
  const raw = String(value);
  let separatorToken;
  let separator;
  for (const token of ["=>", "->", "="]) {
    const candidate = raw.indexOf(token);
    if (candidate > 0 && candidate < raw.length - token.length) {
      separatorToken = token;
      separator = candidate;
      break;
    }
  }
  if (separator === undefined) {
    // Colon remains supported for POSIX-relative paths. Avoid treating a
    // Windows drive-letter colon as the separator.
    const start = /^[A-Za-z]:[\\/]/.test(raw) ? 2 : 0;
    separator = raw.indexOf(":", start);
    separatorToken = ":";
  }
  if (separator <= 0 || separator >= raw.length - separatorToken.length) {
    throw new Error(`Invalid --move '${raw}'; expected FROM=TO, FROM=>TO, FROM->TO, or FROM:TO`);
  }
  let from = raw.slice(0, separator);
  let to = raw.slice(separator + separatorToken.length);
  const prefix = module.path === "." ? "" : `${module.path}/`;
  if (!from.startsWith(prefix) && !path.isAbsolute(from)) from = `${prefix}${from}`;
  if (!to.startsWith(prefix) && !path.isAbsolute(to)) to = `${prefix}${to}`;
  if (path.isAbsolute(from)) from = toPosixPath(path.relative(root, from));
  if (path.isAbsolute(to)) to = toPosixPath(path.relative(root, to));
  return { from: toPosixPath(from).replace(/^\.\//, ""), to: toPosixPath(to).replace(/^\.\//, ""), reason: "explicit move" };
}

function adapterFor(project) {
  if (["typescript", "javascript", "react"].includes(project)) return "javascript";
  if (project === "rust") return "rust";
  if (["flutter", "dart"].includes(project)) return "dart";
  throw new Error(`No restructure adapter for project '${project}'`);
}

function encode(buffer) {
  return { contentEncoding: "base64", content: buffer.toString("base64"), proposedHash: hashBuffer(buffer) };
}

async function planFileRewrite(root, module, file, newFile, moveMap, adapter) {
  const absolute = path.resolve(root, file.path);
  const text = await readFile(absolute, "utf8");
  let result;
  if (adapter === "javascript") result = await planJavaScriptRewrites({ root, file: file.path, newFile, text, moveMap });
  else if (adapter === "rust") result = await planRustRewrites({ root, file: file.path, newFile, text, moveMap, moduleRoot: module.path });
  else result = await planDartRewrites({ root, file: file.path, newFile, text, moveMap, packageName: module.name, moduleRoot: module.path });
  return result;
}

async function configOperations(root, module, moveMap) {
  const output = [];
  if (!["typescript", "javascript", "react"].includes(module.project)) return output;
  for (const relative of [module.manifest, `${module.path === "." ? "" : `${module.path}/`}tsconfig.json`, `${module.path === "." ? "" : `${module.path}/`}jsconfig.json`]) {
    const absolute = path.resolve(root, relative);
    if (!(await exists(absolute))) continue;
    try {
      const original = JSON.parse(await readFile(absolute, "utf8"));
      const rewritten = rewriteJsonPathValues(original, moveMap);
      if (JSON.stringify(original) !== JSON.stringify(rewritten)) {
        const buffer = Buffer.from(`${JSON.stringify(rewritten, null, 2)}\n`, "utf8");
        output.push({ kind: "rewrite-config", path: relative, ...encode(buffer), reason: "rewrite structured path values affected by source moves" });
      }
    } catch {
      // JSON-with-comments or unsupported config remains an explicit blocker only if a moved path is present.
      const text = await readFile(absolute, "utf8");
      const mentioned = [...moveMap.keys()].find((item) => text.includes(item));
      if (mentioned) output.push({ kind: "conflict", path: relative, blocking: true, reason: `configuration mentions moved path ${mentioned} but is not strict JSON` });
    }
  }
  return output;
}

export async function planRestructure(rootDirectory, options = {}) {
  const root = path.resolve(rootDirectory);
  const workspace = await discoverWorkspace(root, { includeOpaque: true });
  const requested = new Set(options.modules ?? []);
  const candidates = workspace.modules.filter((module) => requested.size === 0 || requested.has(module.id) || requested.has(module.path));
  if (candidates.length !== 1) throw new Error(`restructure plan requires exactly one selected module; found ${candidates.length}. Use --module.`);
  const module = candidates[0];
  const inventory = await inventoryModule(root, module);
  let moves = (options.moves ?? []).map((value) => normalizeMove(root, module, value));
  if (moves.length === 0) moves = inferLayoutMoves(inventory, options);
  if (moves.length === 0) throw new Error("No source moves were requested or inferred");
  const moveMap = new Map();
  const conflicts = [];
  const warnings = [];
  for (const move of moves) {
    if (moveMap.has(move.from)) conflicts.push(`Duplicate move source: ${move.from}`);
    moveMap.set(move.from, move.to);
    if (!(await exists(path.resolve(root, move.from)))) conflicts.push(`Move source does not exist: ${move.from}`);
    if (await exists(path.resolve(root, move.to))) conflicts.push(`Move destination already exists: ${move.to}`);
    if (move.from.toLowerCase() === move.to.toLowerCase() && move.from !== move.to) warnings.push(`Case-only rename requires a two-step filesystem move: ${move.from} -> ${move.to}`);
    const sourceModule = workspace.modules.find((item) => move.from === item.path || move.from.startsWith(`${item.path}/`) || item.path === ".");
    const targetModule = workspace.modules.find((item) => move.to === item.path || move.to.startsWith(`${item.path}/`) || item.path === ".");
    if (sourceModule?.id !== targetModule?.id) conflicts.push(`Cross-module move is not a mechanical restructure: ${move.from} -> ${move.to}`);
  }
  const adapter = adapterFor(module.project);
  const operations = [];
  const preconditionPaths = new Set();
  const allSourceFiles = inventory.files.filter((file) => file.source && !file.generated);
  for (const file of allSourceFiles) {
    const newFile = moveMap.get(file.path) ?? file.path;
    const result = await planFileRewrite(root, module, file, newFile, moveMap, adapter);
    if (result.unsupported.length > 0) {
      const kinds = [...new Set(result.unsupported.map((item) => item.kind))].sort();
      const detail = `${file.path}: unsupported ${kinds.join(", ")} reference construct(s)`;
      if (kinds.some((kind) => ["computed-module-reference", "unterminated-string"].includes(kind))) {
        conflicts.push(`${detail}; a mechanical move cannot prove all affected references`);
      } else {
        warnings.push(`${detail} require manual review`);
      }
    }
    if (result.rewrites.length > 0) {
      const buffer = Buffer.from(result.content, "utf8");
      operations.push({ kind: "rewrite-reference", path: newFile, sourcePath: file.path, rewrites: result.rewrites, ...encode(buffer) });
      preconditionPaths.add(file.path);
    }
  }
  for (const move of moves) {
    const source = path.resolve(root, move.from);
    const buffer = await readFile(source);
    const existingRewrite = operations.find((operation) => operation.path === move.to && operation.sourcePath === move.from);
    operations.push({ kind: "move", path: move.to, sourcePath: move.from, reason: move.reason, ...(existingRewrite ? { contentEncoding: existingRewrite.contentEncoding, content: existingRewrite.content, proposedHash: existingRewrite.proposedHash } : encode(buffer)) });
    preconditionPaths.add(move.from);
  }
  operations.push(...await configOperations(root, module, moveMap));
  for (const operation of operations.filter((item) => item.kind === "conflict")) conflicts.push(`${operation.path}: ${operation.reason}`);

  const preconditions = await repositoryPreconditions(root, [...preconditionPaths], { requireClean: options.allowDirty ? false : true, captureDirty: Boolean(options.allowDirty) });
  for (const move of moves) preconditions.push(await filePrecondition(root, move.to));
  for (const operation of operations.filter((item) => item.kind === "rewrite-config")) preconditions.push(await filePrecondition(root, operation.path));
  const verification = (module.commands?.fullSteps ?? []).map((item) => ({ ...item, cwd: module.path, moduleId: module.id }));
  return createPlan({
    command: "restructure",
    root,
    scope: { workspaceFingerprint: workspace.fingerprint, modules: [module.id], paths: moves.flatMap((move) => [move.from, move.to]) },
    preconditions,
    operations: operations.filter((item) => item.kind !== "conflict"),
    commands: [],
    approvals: { network: false, lifecycleScripts: false, semanticChanges: false, riskySkillPermissions: false },
    verification,
    rollback: { strategy: options.checkpoint ?? "worktree", sourcePaths: moves.map((move) => move.from), destinationPaths: moves.map((move) => move.to) },
    warnings,
    conflicts,
    canApply: conflicts.length === 0,
    restructure: { adapter, organization: options.organization ?? "preserve", testPolicy: options.tests ?? "preserve", generatedPolicy: options.generated ?? "exclude", moves, inventorySummary: { files: inventory.files.length, sourceFiles: allSourceFiles.length, generatedFiles: inventory.files.filter((file) => file.generated).length } },
  });
}
