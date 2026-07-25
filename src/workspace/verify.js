import path from "node:path";
import { commandExists, runCommandAsync } from "../process-utils.js";
import { includeDependents, owningModules, changedPathsFromGit } from "./affected.js";
import { discoverWorkspace } from "./discover.js";
import { topologicalLevels } from "./graph.js";

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function consume() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, consume));
  return results;
}

async function verifyModule(root, module, options = {}) {
  const cwd = path.join(root, module.path === "." ? "" : module.path);
  const results = [];
  if (!module.commands?.fullSteps?.length) return { module: module.id, moduleId: module.id, path: module.path, state: "skipped", reason: "no verification command detected", results };
  for (const step of module.commands.fullSteps) {
    if (!commandExists(step.command)) {
      results.push({ ...step, state: "unknown", status: null, reason: `${step.command} is not available` });
      return { module: module.id, moduleId: module.id, path: module.path, state: "unknown", results };
    }
    const result = await (options.runner ?? runCommandAsync)(step.command, step.args, {
      cwd,
      timeout: options.timeoutMs ?? 30 * 60 * 1000,
      maxOutputBytes: options.maxOutputBytes ?? 100_000,
    });
    results.push({ ...result, state: result.status === 0 ? "passed" : "failed" });
    if (result.status !== 0) return { module: module.id, moduleId: module.id, path: module.path, state: "failed", results };
  }
  return { module: module.id, moduleId: module.id, path: module.path, state: "passed", results };
}

export function selectVerificationModules(workspace, options = {}) {
  if (options.scope === "root") return workspace.rootModule ? [workspace.rootModule] : workspace.modules.filter((module) => module.path === ".");
  let selected;
  if (options.scope === "module") {
    const requested = new Set(options.modules ?? []);
    if (requested.size === 0) throw new Error("--scope module requires at least one --module selector");
    const matched = workspace.modules.filter((module) => requested.has(module.id) || requested.has(module.path));
    const matchedSelectors = new Set(matched.flatMap((module) => [module.id, module.path]));
    const unknown = [...requested].filter((value) => !matchedSelectors.has(value));
    if (unknown.length > 0) throw new Error(`Unknown module selector(s): ${unknown.join(", ")}`);
    return matched;
  }
  if (options.scope === "affected") {
    const changed = options.changedPaths ?? changedPathsFromGit(options.root, options.affectedFrom);
    selected = includeDependents(workspace, owningModules(workspace, changed));
  } else selected = new Set(workspace.modules.map((module) => module.id));
  return workspace.modules.filter((module) => selected.has(module.id));
}

export async function verifyWorkspace(root, workspaceOrOptions = {}, maybeOptions = {}) {
  const hasWorkspace = Array.isArray(workspaceOrOptions?.modules);
  const options = hasWorkspace ? maybeOptions : workspaceOrOptions;
  const workspace = hasWorkspace
    ? workspaceOrOptions
    : await discoverWorkspace(root, { workspace: options.workspace ?? "all", includeRootModule: false, includeOpaque: true });
  if (!workspace.canUse) {
    throw new Error(`Workspace conflicts:\n- ${workspace.conflicts.join("\n- ")}`);
  }
  const selected = selectVerificationModules(workspace, { ...options, root });
  if (options.scope === "root" && selected.length === 0) {
    return {
      version: 1,
      root,
      scope: "root",
      selected: [],
      results: [{ module: "workspace-root", moduleId: "workspace-root", path: ".", state: "unknown", reason: "no distinct workspace-root aggregate command was detected", results: [] }],
      ok: false,
    };
  }
  const selectedIds = new Set(selected.map((module) => module.id));
  const normalized = selected.map((module) => ({ ...module, dependencies: module.dependencies.filter((id) => selectedIds.has(id)) }));
  const byId = new Map(normalized.map((module) => [module.id, module]));
  const status = new Map();
  const results = [];
  for (const level of topologicalLevels(normalized)) {
    const runnable = [];
    for (const id of level) {
      const module = byId.get(id);
      const blockedBy = module.dependencies.filter((dependency) => ["failed", "blocked", "unknown"].includes(status.get(dependency)));
      if (blockedBy.length > 0) {
        status.set(id, "blocked");
        results.push({ module: id, moduleId: id, path: module.path, state: "blocked", blockedBy, results: [] });
      } else runnable.push(module);
    }
    const levelResults = await runPool(runnable, options.concurrency ?? Math.min(4, Math.max(1, runnable.length)), (module) => verifyModule(root, module, options));
    for (const result of levelResults) {
      status.set(result.module, result.state);
      results.push(result);
      if (options.failFast && result.state === "failed") break;
    }
    if (options.failFast && results.some((result) => result.state === "failed")) break;
  }
  results.sort((a, b) => a.path.localeCompare(b.path));
  const ok = results.every((result) => ["passed", "skipped"].includes(result.state));
  return { version: 1, root, scope: options.scope ?? "all", selected: selected.map((module) => module.id), results, ok };
}
