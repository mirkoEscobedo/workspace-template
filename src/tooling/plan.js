import path from "node:path";
import { readFile } from "node:fs/promises";
import { createPlanEnvelope } from "../plans/schema.js";
import { buildPreconditions } from "../plans/fingerprint.js";
import { discoverWorkspace } from "../workspace/discover.js";
import { loadToolingCatalog, resolvePacks } from "./catalog.js";
import { packageManagerAdapter } from "./package-managers/index.js";
import { planPackageScripts, planStructuredConfigs } from "./structured-edit.js";

function parseDependency(value, kind = "development") {
  const separator = value.lastIndexOf("@");
  if (value.startsWith("@")) {
    const second = value.indexOf("@", 1);
    return second > 0 ? { name: value.slice(0, second), version: value.slice(second + 1), kind } : { name: value, kind };
  }
  return separator > 0 ? { name: value.slice(0, separator), version: value.slice(separator + 1), kind } : { name: value, kind };
}

async function existingDependencies(root, module) {
  const manifest = path.join(root, module.manifest);
  if (["typescript", "javascript", "react"].includes(module.project)) {
    const packageJson = JSON.parse(await readFile(manifest, "utf8"));
    return { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}), ...(packageJson.peerDependencies ?? {}) };
  }
  const text = await readFile(manifest, "utf8");
  const names = {};
  for (const match of text.matchAll(/^\s*([A-Za-z0-9_@/-]+)\s*[:=]/gm)) names[match[1]] = "present";
  return names;
}

function packageCommands(module, dependencies, options) {
  if (dependencies.length === 0) return [];
  const adapter = packageManagerAdapter(module.packageManager);
  if (["typescript", "javascript", "react"].includes(module.project)) {
    const grouped = new Map();
    for (const dependency of dependencies) {
      const kind = dependency.kind ?? "development";
      const values = grouped.get(kind) ?? [];
      values.push(dependency);
      grouped.set(kind, values);
    }
    return [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, values]) => ({ ...adapter.planAdd(values, options), dependencies: values }));
  }
  return dependencies.map((dependency) => ({ ...adapter.planAdd([dependency], { ...options, project: module.project }), dependencies: [dependency] }));
}

export async function buildToolingPlan(rootDirectory, options = {}) {
  const root = path.resolve(rootDirectory);
  const workspace = await discoverWorkspace(root, { workspace: options.workspace ?? "all", includeRootModule: false });
  if (!workspace.canUse) throw new Error(`Workspace conflicts:\n- ${workspace.conflicts.join("\n- ")}`);
  const requestedModules = options.modules?.length ? new Set(options.modules) : undefined;
  const modules = workspace.modules.filter((module) => !requestedModules || requestedModules.has(module.id) || requestedModules.has(module.path));
  if (modules.length === 0) throw new Error("No matching modules for tooling plan");
  const catalog = await loadToolingCatalog(options.catalog);
  const operations = [];
  const commands = [];
  const warnings = [];
  const conflicts = [];
  const moduleSummaries = [];
  const fingerprintPaths = [];
  let hasRuntimeDependency = false;

  for (const module of modules) {
    const resolved = resolvePacks(catalog, options.packs ?? [], module.project);
    warnings.push(...resolved.warnings.map((warning) => `${module.id}: ${warning}`));
    const explicit = (options.dependencies ?? []).map((value) => parseDependency(value, options.kind ?? options.dependencyKind ?? "development"));
    const requested = [...resolved.dependencies, ...explicit];
    const byName = new Map();
    for (const dependency of requested) byName.set(dependency.name, dependency);
    const existing = await existingDependencies(root, module);
    const additions = [...byName.values()].filter((dependency) => !Object.hasOwn(existing, dependency.name));
    if (additions.some((dependency) => dependency.kind === "runtime")) hasRuntimeDependency = true;
    const incompatible = [...byName.values()].filter((dependency) => dependency.version && existing[dependency.name] && existing[dependency.name] !== dependency.version && existing[dependency.name] !== `^${dependency.version}` && existing[dependency.name] !== `~${dependency.version}`);
    if (incompatible.length > 0) conflicts.push(...incompatible.map((dependency) => `${module.id}: ${dependency.name} already exists at ${existing[dependency.name]}, requested ${dependency.version}`));
    for (const command of packageCommands(module, additions, { lifecycleScripts: options.lifecycleScripts ?? "deny" })) {
      command.cwd = module.path;
      command.moduleId = module.id;
      command.expectedPaths = [module.manifest];
      if (["typescript", "javascript", "react"].includes(module.project)) {
        const lock = { npm: "package-lock.json", pnpm: "pnpm-lock.yaml", yarn: "yarn.lock", bun: "bun.lock" }[module.packageManager];
        if (lock) command.expectedPaths.push(path.posix.join(module.lockOwner === "." ? "" : module.lockOwner, lock));
      } else if (module.project === "rust") command.expectedPaths.push(path.posix.join(module.lockOwner === "." ? "" : module.lockOwner, "Cargo.lock"));
      else command.expectedPaths.push(path.posix.join(module.path === "." ? "" : module.path, "pubspec.lock"));
      commands.push(command);
    }
    operations.push(...await planPackageScripts(root, module, resolved.scripts, options.scripts ?? "propose"));
    const structured = await planStructuredConfigs(root, module, resolved.configs, options.scripts ?? "propose");
    operations.push(...structured.operations);
    conflicts.push(...structured.conflicts);
    fingerprintPaths.push(
      module.manifest,
      ...commands.flatMap((command) => command.expectedPaths ?? []),
      ...structured.operations.flatMap((operation) => [operation.path, operation.proposalPath]),
    );
    moduleSummaries.push({ id: module.id, path: module.path, project: module.project, packs: resolved.selected, additions, existing: Object.keys(existing).sort() });
  }

  const approvals = {
    network: Boolean(options.allowNetwork),
    lifecycleScripts: options.lifecycleScripts === "allow",
    runtimeDependencies: (options.kind ?? options.dependencyKind ?? "development") === "runtime" && Boolean(options.allowRuntime),
    dirtyTree: Boolean(options.allowDirty),
  };
  if (commands.some((command) => command.network) && !approvals.network) conflicts.push("one or more package-manager commands require network access; pass --allow-network when applying a reviewed plan");
  if (commands.some((command) => command.lifecycleScripts) && !approvals.lifecycleScripts) conflicts.push("one or more package-manager commands require lifecycle scripts");
  if ((options.kind ?? options.dependencyKind ?? "development") === "runtime" && !approvals.runtimeDependencies) conflicts.push("runtime dependencies require --allow-runtime");

  return createPlanEnvelope({
    command: "tooling-install",
    root,
    scope: { workspaceKind: workspace.kind, modules: modules.map((module) => module.id) },
    preconditions: await buildPreconditions(root, [...new Set(fingerprintPaths)], { allowDirty: options.allowDirty }),
    operations,
    commands,
    approvals,
    verification: modules.flatMap((module) => (module.commands?.fullSteps ?? []).map((step) => ({ module: module.id, cwd: module.path, ...step }))),
    rollback: { strategy: "restore-tracked-files", trackedFiles: [...new Set(fingerprintPaths)].sort(), untrackedResidueMayRemain: true },
    warnings,
    conflicts,
    metadata: { catalogVersion: catalog.version, modules: moduleSummaries, scriptsPolicy: options.scripts ?? "propose" },
    tooling: { catalogVersion: catalog.version, modules: moduleSummaries, scriptsPolicy: options.scripts ?? "propose" },
  });
}
