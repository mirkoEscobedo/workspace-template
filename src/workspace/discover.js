import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, exists, hashText, readJson, toPosixPath } from "../fs-utils.js";
import {
  parsePubspecName,
  parsePubspecPathDependencies,
  parseTomlArray,
  parseTomlPackageName,
  parseTomlPathDependencies,
  parseYamlListUnderKey,
} from "../formats.js";
import { loadWorkspaceOverrides } from "../plans/fingerprint.js";
import { graphCycles, normalizeGraph } from "./graph.js";

const IGNORED_DIRECTORIES = new Set([".git", ".agentic", "node_modules", "target", "build", "dist", ".dart_tool", ".next", "coverage"]);

function sanitizeId(value) {
  return value
    .replace(/^@/, "")
    .replaceAll(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "module";
}

function globToRegExp(pattern) {
  const normalized = toPosixPath(pattern).replace(/^\.\//, "").replace(/\/$/, "");
  let regex = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === "*") {
      if (normalized[index + 1] === "*") {
        index += 1;
        regex += ".*";
      } else regex += "[^/]*";
    } else if (char === "?") regex += "[^/]";
    else regex += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${regex}$`);
}

async function walkDirectories(root, maxDepth = 6) {
  const output = [""];
  async function walk(relative, depth) {
    if (depth >= maxDepth) return;
    const directory = path.join(root, relative);
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue;
      const next = toPosixPath(path.join(relative, entry.name));
      output.push(next);
      await walk(next, depth + 1);
    }
  }
  await walk("", 0);
  return output;
}

async function expandPatterns(root, patterns, directories) {
  const include = [];
  const exclude = [];
  for (const raw of patterns) {
    if (!raw) continue;
    (raw.startsWith("!") ? exclude : include).push(globToRegExp(raw.replace(/^!/, "")));
  }
  return directories.filter((relative) => {
    if (!relative) return false;
    const selected = include.length === 0 || include.some((regex) => regex.test(relative));
    return selected && !exclude.some((regex) => regex.test(relative));
  });
}

async function rootWorkspacePatterns(root) {
  const patterns = [];
  const evidence = [];
  const packageJsonPath = path.join(root, "package.json");
  if (await exists(packageJsonPath)) {
    const packageJson = await readJson(packageJsonPath).catch(() => undefined);
    const workspaces = Array.isArray(packageJson?.workspaces) ? packageJson.workspaces : packageJson?.workspaces?.packages;
    if (Array.isArray(workspaces)) {
      patterns.push(...workspaces);
      evidence.push("package.json#workspaces");
    }
  }
  const pnpm = path.join(root, "pnpm-workspace.yaml");
  if (await exists(pnpm)) {
    patterns.push(...parseYamlListUnderKey(await readFile(pnpm, "utf8"), "packages"));
    evidence.push("pnpm-workspace.yaml");
  }
  const cargo = path.join(root, "Cargo.toml");
  if (await exists(cargo)) {
    const text = await readFile(cargo, "utf8");
    const members = parseTomlArray(text, "workspace", "members");
    if (members.length > 0) {
      patterns.push(...members);
      for (const excluded of parseTomlArray(text, "workspace", "exclude")) patterns.push(`!${excluded}`);
      evidence.push("Cargo.toml#[workspace]");
    }
  }
  const melos = path.join(root, "melos.yaml");
  if (await exists(melos)) {
    patterns.push(...parseYamlListUnderKey(await readFile(melos, "utf8"), "packages"));
    evidence.push("melos.yaml");
  }
  const pubspec = path.join(root, "pubspec.yaml");
  if (await exists(pubspec)) {
    const values = parseYamlListUnderKey(await readFile(pubspec, "utf8"), "workspace");
    if (values.length > 0) {
      patterns.push(...values);
      evidence.push("pubspec.yaml#workspace");
    }
  }
  return { patterns, evidence };
}

function nodeCommands(packageJson, manager) {
  const scripts = packageJson?.scripts ?? {};
  const choose = (...names) => names.find((name) => typeof scripts[name] === "string");
  const aggregate = choose("check", "verify", "validate", "ci");
  const ordered = [choose("typecheck", "type-check", "check:types", "types"), choose("lint"), choose("test")].filter(Boolean);
  const run = (name) => manager === "yarn" ? { command: "yarn", args: [name] } : { command: manager, args: ["run", name] };
  return {
    scripts: Object.keys(scripts).sort(),
    fullSteps: aggregate ? [run(aggregate)] : ordered.map(run),
    full: aggregate ? `${manager === "yarn" ? "yarn" : `${manager} run`} ${aggregate}` : ordered.map((name) => `${manager === "yarn" ? "yarn" : `${manager} run`} ${name}`).join(" && ") || undefined,
  };
}

async function nearestNodePackageManager(root, moduleRoot, override) {
  if (override) return { value: override, owner: toPosixPath(path.relative(root, moduleRoot)) || ".", evidence: "workspace override" };
  let current = moduleRoot;
  while (current === root || current.startsWith(`${root}${path.sep}`)) {
    const found = [];
    for (const [manager, filename] of [["pnpm", "pnpm-lock.yaml"], ["yarn", "yarn.lock"], ["bun", "bun.lock"], ["bun", "bun.lockb"], ["npm", "package-lock.json"]]) {
      if (await exists(path.join(current, filename))) found.push({ manager, filename });
    }
    const managers = [...new Set(found.map((item) => item.manager))];
    if (managers.length > 1) {
      return {
        value: managers[0],
        owner: toPosixPath(path.relative(root, current)) || ".",
        evidence: found.map((item) => item.filename).join(", "),
        conflict: `multiple package-manager lockfiles at ${toPosixPath(path.relative(root, current)) || "."}: ${found.map((item) => item.filename).join(", ")}`,
      };
    }
    if (found.length > 0) return { value: found[0].manager, owner: toPosixPath(path.relative(root, current)) || ".", evidence: found.map((item) => item.filename).join(", ") };
    if (current === root) break;
    current = path.dirname(current);
  }
  return { value: "npm", owner: ".", evidence: "default" };
}

async function inspectModule(root, relative, overrides = {}) {
  const moduleRoot = path.join(root, relative);
  const packageJsonPath = path.join(moduleRoot, "package.json");
  const cargoPath = path.join(moduleRoot, "Cargo.toml");
  const pubspecPath = path.join(moduleRoot, "pubspec.yaml");
  if (await exists(packageJsonPath)) {
    const packageJson = await readJson(packageJsonPath).catch(() => undefined);
    if (!packageJson) return { path: relative, conflict: "invalid package.json" };
    const dependencies = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}), ...(packageJson.peerDependencies ?? {}) };
    const project = dependencies.react || dependencies["react-dom"] ? "react" : (await exists(path.join(moduleRoot, "tsconfig.json"))) || dependencies.typescript ? "typescript" : "javascript";
    const manager = await nearestNodePackageManager(root, moduleRoot, overrides?.modules?.[relative || "."]?.packageManager);
    return {
      id: sanitizeId(packageJson.name ?? relative),
      name: packageJson.name ?? path.basename(moduleRoot),
      path: relative || ".",
      manifest: toPosixPath(path.join(relative, "package.json")),
      project,
      packageManager: manager.value,
      lockOwner: manager.owner,
      commands: nodeCommands(packageJson, manager.value),
      declaredDependencies: Object.keys(dependencies),
      opaque: false,
      conflicts: manager.conflict ? [manager.conflict] : [],
    };
  }
  if (await exists(cargoPath)) {
    const text = await readFile(cargoPath, "utf8");
    const name = parseTomlPackageName(text) ?? path.basename(moduleRoot);
    const pathDependencies = parseTomlPathDependencies(text).map((item) => ({
      ...item,
      path: toPosixPath(path.normalize(path.join(relative, item.path))),
    }));
    return {
      id: sanitizeId(name),
      name,
      path: relative || ".",
      manifest: toPosixPath(path.join(relative, "Cargo.toml")),
      project: "rust",
      packageManager: "cargo",
      lockOwner: ".",
      commands: {
        full: "cargo fmt --all -- --check && cargo check --all-targets && cargo test",
        fullSteps: [
          { command: "cargo", args: ["fmt", "--all", "--", "--check"] },
          { command: "cargo", args: ["check", "--all-targets"] },
          { command: "cargo", args: ["test"] },
        ],
      },
      pathDependencies,
      opaque: false,
    };
  }
  if (await exists(pubspecPath)) {
    const text = await readFile(pubspecPath, "utf8");
    const name = parsePubspecName(text) ?? path.basename(moduleRoot);
    const flutter = /flutter:\s*\n\s*sdk:\s*flutter/m.test(text) || /sdk:\s*flutter\b/m.test(text);
    const pathDependencies = parsePubspecPathDependencies(text).map((item) => ({
      ...item,
      path: toPosixPath(path.normalize(path.join(relative, item.path))),
    }));
    return {
      id: sanitizeId(name),
      name,
      path: relative || ".",
      manifest: toPosixPath(path.join(relative, "pubspec.yaml")),
      project: flutter ? "flutter" : "dart",
      packageManager: flutter ? "flutter" : "dart",
      lockOwner: relative || ".",
      commands: {
        full: flutter ? "dart format --output=none --set-exit-if-changed . && flutter analyze && flutter test" : "dart format --output=none --set-exit-if-changed . && dart analyze && dart test",
        fullSteps: flutter
          ? [{ command: "dart", args: ["format", "--output=none", "--set-exit-if-changed", "."] }, { command: "flutter", args: ["analyze"] }, { command: "flutter", args: ["test"] }]
          : [{ command: "dart", args: ["format", "--output=none", "--set-exit-if-changed", "."] }, { command: "dart", args: ["analyze"] }, { command: "dart", args: ["test"] }],
      },
      pathDependencies,
      opaque: false,
    };
  }
  return undefined;
}

function deduplicateIds(modules, overrides) {
  const seen = new Map();
  const conflicts = [];
  for (const module of modules) {
    const override = overrides?.modules?.[module.path];
    if (override?.id) module.id = sanitizeId(override.id);
    if (override?.exclude) module.excluded = true;
    if (seen.has(module.id)) conflicts.push(`duplicate module id '${module.id}' for ${seen.get(module.id)} and ${module.path}`);
    else seen.set(module.id, module.path);
  }
  return conflicts;
}

function structuralConflicts(modules) {
  const conflicts = [];
  const byLowerPath = new Map();
  const byLowerId = new Map();
  for (const module of modules) {
    const lowerPath = module.path.toLowerCase();
    const lowerId = module.id.toLowerCase();
    if (byLowerPath.has(lowerPath) && byLowerPath.get(lowerPath) !== module.path) {
      conflicts.push(`case-insensitive module path collision: ${byLowerPath.get(lowerPath)} and ${module.path}`);
    } else byLowerPath.set(lowerPath, module.path);
    if (byLowerId.has(lowerId) && byLowerId.get(lowerId) !== module.id) {
      conflicts.push(`case-insensitive module id collision: ${byLowerId.get(lowerId)} and ${module.id}`);
    } else byLowerId.set(lowerId, module.id);
  }
  const paths = modules.map((module) => module.path).filter((value) => value !== ".").sort();
  for (let left = 0; left < paths.length; left += 1) {
    for (let right = left + 1; right < paths.length; right += 1) {
      if (paths[right].startsWith(`${paths[left]}/`)) conflicts.push(`overlapping module roots: ${paths[left]} contains ${paths[right]}`);
    }
  }
  return conflicts;
}

function connectDependencies(modules, overrides) {
  const byName = new Map(modules.map((module) => [module.name, module.id]));
  const byPath = new Map(modules.map((module) => [toPosixPath(module.path).replace(/^\.\/?/, ""), module.id]));
  for (const module of modules) {
    const dependencies = new Set();
    for (const name of module.declaredDependencies ?? []) if (byName.has(name)) dependencies.add(byName.get(name));
    for (const item of module.pathDependencies ?? []) {
      const normalized = item.path.replace(/^\.\/?/, "");
      if (byPath.has(normalized)) dependencies.add(byPath.get(normalized));
      else if (byName.has(item.name)) dependencies.add(byName.get(item.name));
    }
    for (const dependency of overrides?.modules?.[module.path]?.dependencies ?? []) dependencies.add(dependency);
    module.dependencies = [...dependencies].filter((id) => id !== module.id).sort();
    delete module.declaredDependencies;
    delete module.pathDependencies;
  }
}

export async function discoverWorkspace(rootDirectory, options = {}) {
  const root = path.resolve(rootDirectory);
  const directories = await walkDirectories(root, options.maxDepth ?? 7);
  const { patterns, evidence } = await rootWorkspacePatterns(root);
  const overrides = await loadWorkspaceOverrides(root);
  let candidates = patterns.length > 0 ? await expandPatterns(root, patterns, directories) : [];

  if (options.workspace === "all" || (options.workspace !== "single" && candidates.length === 0)) {
    for (const relative of directories) {
      // A manifest that declares a workspace is an orchestration root, not an
      // application module, unless the caller explicitly asks to include it.
      if (!relative && patterns.length > 0 && !options.includeRootModule) continue;
      if (await exists(path.join(root, relative, "package.json")) || await exists(path.join(root, relative, "Cargo.toml")) || await exists(path.join(root, relative, "pubspec.yaml"))) {
        candidates.push(relative);
      }
    }
  }
  if (options.workspace !== "all" && patterns.length === 0) candidates = [];

  const rootHasManifest = await exists(path.join(root, "package.json")) || await exists(path.join(root, "Cargo.toml")) || await exists(path.join(root, "pubspec.yaml"));
  if (rootHasManifest && (options.workspace === "single" || candidates.length === 0)) candidates.unshift("");
  // In a recognized workspace the root manifest is an aggregate execution scope,
  // not another application module. Keep it as rootModule so root verification
  // cannot create duplicate ownership or dependency edges.
  if (patterns.length > 0) candidates = candidates.filter((candidate) => candidate !== "");
  candidates = [...new Set(candidates.map((value) => toPosixPath(value).replace(/^\.\/?/, "").replace(/\/$/, "")))].sort();

  const modules = [];
  const warnings = [];
  for (const relative of candidates) {
    const inspected = await inspectModule(root, relative, overrides);
    if (inspected?.conflict) warnings.push(`${relative || "."}: ${inspected.conflict}`);
    else if (inspected) modules.push(inspected);
    else if (options.includeOpaque) {
      modules.push({
        id: sanitizeId(relative || "root-opaque"),
        name: path.basename(relative || root),
        path: relative || ".",
        manifest: null,
        project: "unsupported",
        packageManager: null,
        lockOwner: null,
        commands: { fullSteps: [] },
        dependencies: [],
        opaque: true,
        conflicts: [],
      });
      warnings.push(`${relative || "."}: workspace candidate has no supported manifest and is retained as an opaque module`);
    } else warnings.push(`${relative || "."}: workspace candidate has no supported manifest and is retained as opaque evidence`);
  }

  const conflicts = [...deduplicateIds(modules, overrides), ...structuralConflicts(modules)];
  for (const module of modules) conflicts.push(...(module.conflicts ?? []).map((item) => `${module.id}: ${item}`));
  let selected = modules.filter((module) => !module.excluded);
  connectDependencies(selected, overrides);
  selected = normalizeGraph(selected);
  for (const cycle of graphCycles(selected)) conflicts.push(`module dependency cycle: ${cycle.join(" -> ")}`);

  const kinds = [...new Set(selected.map((module) => module.project === "dart" ? "flutter" : module.project).map((project) => ["typescript", "javascript", "react"].includes(project) ? "node" : project))];
  const kind = selected.length <= 1 ? "single" : kinds.length === 1 ? kinds[0] : "polyglot";
  const selectedSorted = selected.sort((a, b) => a.path.localeCompare(b.path));
  let rootModule;
  if (rootHasManifest && !selectedSorted.some((module) => module.path === ".")) {
    const inspectedRoot = await inspectModule(root, "", overrides);
    if (inspectedRoot) {
      rootModule = { ...inspectedRoot, id: "workspace-root", aggregate: true, dependencies: [] };
      conflicts.push(...(inspectedRoot.conflicts ?? []).map((item) => `workspace-root: ${item}`));
    }
  }
  const workspace = {
    version: 1,
    root,
    serializedRoot: ".",
    kind,
    evidence,
    rootModule,
    modules: selectedSorted,
    warnings,
    conflicts,
    canUse: conflicts.length === 0,
  };
  workspace.fingerprint = hashText(canonicalJson({
    kind: workspace.kind,
    evidence: workspace.evidence,
    rootModule: workspace.rootModule ? (({ commands: _commands, ...module }) => module)(workspace.rootModule) : null,
    modules: workspace.modules.map(({ commands: _commands, ...module }) => module),
  }));
  return workspace;
}
