import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { PACKAGE_MANAGERS, PROJECTS } from "./constants.js";
import { exists, hashFile, readJson } from "./fs-utils.js";
import { commandExists, runCommandCapture } from "./process-utils.js";
import { discoverWorkspace } from "./workspace/discover.js";

function posix(value) {
  return value.split(path.sep).join("/");
}

function packageRun(packageManager, script) {
  if (packageManager === "yarn") return `yarn ${script}`;
  return `${packageManager} run ${script}`;
}

function packageStep(packageManager, script) {
  return packageManager === "yarn"
    ? { command: packageManager, args: [script] }
    : { command: packageManager, args: ["run", script] };
}

function targetedCommand(packageManager, testScript, project) {
  if (!testScript) return undefined;
  const suffix = project === "react" ? "path/to/test.tsx" : project === "javascript" ? "path/to/test.test.js" : "path/to/test.ts";
  return `${packageRun(packageManager, testScript)} -- ${suffix}`;
}

function detectNodeCommands(packageJson, packageManager, project) {
  const scripts = packageJson?.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts : {};
  const choose = (...names) => names.find((name) => typeof scripts[name] === "string");
  const dev = choose("dev", "start");
  const test = choose("test");
  const typecheck = choose("typecheck", "type-check", "check:types", "types");
  const lint = choose("lint");
  const format = choose("format", "fmt");
  const aggregate = choose("check", "verify", "validate", "ci");
  const pieces = [typecheck, lint, test].filter(Boolean).map((name) => packageRun(packageManager, name));
  const full = aggregate ? packageRun(packageManager, aggregate) : pieces.length > 0 ? pieces.join(" && ") : undefined;
  const fullSteps = aggregate
    ? [packageStep(packageManager, aggregate)]
    : [typecheck, lint, test].filter(Boolean).map((name) => packageStep(packageManager, name));

  return {
    setup: `${packageManager} install`,
    dev: dev ? packageRun(packageManager, dev) : undefined,
    targeted: targetedCommand(packageManager, test, project),
    test: test ? packageRun(packageManager, test) : undefined,
    typecheck: typecheck ? packageRun(packageManager, typecheck) : undefined,
    lint: lint ? packageRun(packageManager, lint) : undefined,
    format: format ? packageRun(packageManager, format) : undefined,
    full,
    fullSteps,
    scripts: Object.keys(scripts).sort(),
  };
}

async function readPackageJson(root) {
  const packagePath = path.join(root, "package.json");
  if (!(await exists(packagePath))) return undefined;
  try {
    return await readJson(packagePath);
  } catch (error) {
    return { __invalid: error instanceof Error ? error.message : String(error) };
  }
}

async function detectProject(root, explicitProject) {
  const evidence = [];
  const warnings = [];
  const candidates = [];
  const packageJson = await readPackageJson(root);
  const hasCargo = await exists(path.join(root, "Cargo.toml"));
  const hasPubspec = await exists(path.join(root, "pubspec.yaml"));

  if (hasPubspec) {
    const content = await readFile(path.join(root, "pubspec.yaml"), "utf8");
    if (/sdk:\s*flutter\b/m.test(content) || /flutter:\s*\n\s*sdk:\s*flutter\b/m.test(content)) {
      candidates.push("flutter");
      evidence.push("pubspec.yaml declares Flutter SDK");
    }
  }
  if (hasCargo) {
    candidates.push("rust");
    evidence.push("Cargo.toml");
  }
  if (packageJson) {
    if (packageJson.__invalid) {
      warnings.push(`package.json is invalid: ${packageJson.__invalid}`);
    } else {
      const dependencies = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) };
      if (dependencies.react || dependencies["react-dom"]) {
        candidates.push("react");
        evidence.push("package.json React dependency");
      } else if (await exists(path.join(root, "tsconfig.json")) || dependencies.typescript) {
        candidates.push("typescript");
        evidence.push((await exists(path.join(root, "tsconfig.json"))) ? "tsconfig.json" : "package.json TypeScript dependency");
      } else {
        candidates.push("javascript");
        evidence.push("package.json");
      }
    }
  }

  const unique = [...new Set(candidates)];
  if (explicitProject && explicitProject !== "auto") {
    if (!PROJECTS.includes(explicitProject)) throw new Error(`Unsupported project override: ${explicitProject}`);
    if (unique.length > 0 && !unique.includes(explicitProject)) {
      warnings.push(`Explicit project '${explicitProject}' differs from detected evidence: ${unique.join(", ")}`);
    }
    return { value: explicitProject, confidence: unique.includes(explicitProject) ? "high" : "explicit", evidence, warnings, candidates: unique, packageJson };
  }

  if (unique.length === 0) {
    return { value: undefined, confidence: "none", evidence, warnings, candidates: unique, packageJson, blocking: "No supported root project manifest was detected. Use --project explicitly." };
  }
  if (unique.length > 1) {
    return { value: undefined, confidence: "ambiguous", evidence, warnings, candidates: unique, packageJson, blocking: `Multiple root ecosystems were detected (${unique.join(", ")}). Select --project explicitly or adopt modules separately.` };
  }
  return { value: unique[0], confidence: "high", evidence, warnings, candidates: unique, packageJson };
}

async function detectPackageManager(root, explicit, project, packageJson) {
  if (!project || !["typescript", "javascript", "react"].includes(project)) {
    return { value: project === "rust" ? "cargo" : project === "flutter" ? "flutter" : undefined, confidence: "standard", evidence: [] };
  }

  const lockMap = [
    ["pnpm", "pnpm-lock.yaml"],
    ["yarn", "yarn.lock"],
    ["bun", (await exists(path.join(root, "bun.lock"))) ? "bun.lock" : "bun.lockb"],
    ["npm", "package-lock.json"],
  ];
  const found = [];
  for (const [manager, file] of lockMap) {
    if (await exists(path.join(root, file))) found.push([manager, file]);
  }
  const field = typeof packageJson?.packageManager === "string" ? packageJson.packageManager.split("@")[0] : undefined;

  if (explicit && explicit !== "auto") {
    const warnings = [];
    if (found.length > 0 && !found.some(([manager]) => manager === explicit)) {
      warnings.push(`Explicit package manager '${explicit}' differs from lockfile evidence: ${found.map(([manager]) => manager).join(", ")}`);
    }
    return { value: explicit, confidence: "explicit", evidence: found.map(([, file]) => file), warnings };
  }

  if (found.length > 1) {
    return { value: undefined, confidence: "ambiguous", evidence: found.map(([, file]) => file), blocking: `Conflicting lockfiles detected: ${found.map(([, file]) => file).join(", ")}. Use --pm explicitly.` };
  }
  if (found.length === 1) return { value: found[0][0], confidence: "high", evidence: [found[0][1]], warnings: [] };
  if (field && PACKAGE_MANAGERS.includes(field)) return { value: field, confidence: "medium", evidence: ["package.json#packageManager"], warnings: [] };
  return { value: "npm", confidence: "low", evidence: [], warnings: ["No lockfile or packageManager field was detected; npm is the low-confidence default."] };
}

function standardCommands(project) {
  if (project === "rust") {
    return {
      setup: "cargo fetch",
      dev: "cargo run",
      targeted: "cargo test test_name",
      test: "cargo test",
      typecheck: "cargo check --all-targets",
      lint: "cargo clippy --all-targets --all-features -- -D warnings",
      format: "cargo fmt --all",
      full: "cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test",
      fullSteps: [
        { command: "cargo", args: ["fmt", "--all", "--", "--check"] },
        { command: "cargo", args: ["clippy", "--all-targets", "--all-features", "--", "-D", "warnings"] },
        { command: "cargo", args: ["test"] },
      ],
    };
  }
  if (project === "flutter") {
    return {
      setup: "flutter pub get",
      dev: "flutter run",
      targeted: "flutter test path/to/test.dart",
      test: "flutter test",
      typecheck: "flutter analyze",
      lint: "flutter analyze",
      format: "dart format .",
      full: "dart format --output=none --set-exit-if-changed . && flutter analyze && flutter test",
      fullSteps: [
        { command: "dart", args: ["format", "--output=none", "--set-exit-if-changed", "."] },
        { command: "flutter", args: ["analyze"] },
        { command: "flutter", args: ["test"] },
      ],
    };
  }
  return {};
}

async function inspectGit(root) {
  if (!commandExists("git")) return { available: false, repository: false, warnings: ["git executable was not found"] };
  const top = runCommandCapture("git", ["rev-parse", "--show-toplevel"], { cwd: root });
  if (top.status !== 0) return { available: true, repository: false, warnings: ["target is not inside a Git repository"] };
  const gitRoot = path.resolve(top.stdout.trim());
  const status = runCommandCapture("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root });
  const dirtyLines = status.status === 0 ? status.stdout.split(/\r?\n/).filter(Boolean) : [];
  const head = runCommandCapture("git", ["rev-parse", "HEAD"], { cwd: root });
  return {
    available: true,
    repository: true,
    root: gitRoot,
    targetIsRoot: path.resolve(root) === gitRoot,
    dirty: dirtyLines.length > 0,
    dirtyEntries: dirtyLines,
    head: head.status === 0 ? head.stdout.trim() : undefined,
    warnings: status.status === 0 ? [] : ["git status could not be read"],
  };
}

async function inspectProspectiveSymlinks(root) {
  const candidates = [".agentic", ".agents", ".codex", ".opencode", "docs/agent"];
  const unsafe = [];
  const rootReal = await realpath(root);
  for (const relative of candidates) {
    const target = path.join(root, relative);
    if (!(await exists(target))) continue;
    const details = await lstat(target);
    if (!details.isSymbolicLink()) continue;
    const resolved = await realpath(target);
    const inside = resolved === rootReal || resolved.startsWith(`${rootReal}${path.sep}`);
    if (!inside) unsafe.push({ path: relative, resolved });
  }
  return unsafe;
}

async function findTicketTracks(root) {
  const ticketsRoot = path.join(root, "docs", "tickets");
  if (!(await exists(ticketsRoot))) return [];
  const entries = await readdir(ticketsRoot, { withFileTypes: true });
  const tracks = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const trackRoot = path.join(ticketsRoot, entry.name);
    const children = await readdir(trackRoot, { withFileTypes: true });
    const ticketDirectories = children
      .filter((child) => child.isDirectory() && /^\d+[-_]/.test(child.name))
      .map((child) => child.name)
      .sort();
    const hasMaster = await exists(path.join(trackRoot, "master-plan.md")) || await exists(path.join(trackRoot, "master-prompt.md"));
    if (hasMaster || ticketDirectories.length > 0) {
      tracks.push({ path: posix(path.relative(root, trackRoot)), name: entry.name, ticketDirectories, hasMaster });
    }
  }
  return tracks;
}

async function identityFileHashes(root) {
  const candidates = [
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
    "tsconfig.json",
    "Cargo.toml",
    "Cargo.lock",
    "pubspec.yaml",
    "pubspec.lock",
  ];
  const hashes = {};
  for (const relative of candidates) {
    const file = path.join(root, relative);
    if (await exists(file)) hashes[relative] = await hashFile(file);
  }
  return hashes;
}

export async function inspectRepository(rootDirectory, options = {}) {
  const root = path.resolve(rootDirectory);
  const parsed = path.parse(root);
  if (root === parsed.root) throw new Error("Refusing to inspect or adopt a filesystem root");
  if (!(await exists(root))) throw new Error(`Target directory does not exist: ${root}`);

  let project = await detectProject(root, options.project);
  let packageManager = await detectPackageManager(root, options.packageManager, project.value, project.packageJson);
  const workspace = await discoverWorkspace(root, { workspace: options.workspace ?? "auto", includeRootModule: options.includeRootModule });
  if (workspace.modules.length > 1) {
    const projects = [...new Set(workspace.modules.map((module) => module.project))].sort();
    const managers = [...new Set(workspace.modules.map((module) => module.packageManager))].sort();
    project = {
      value: "workspace",
      confidence: "high",
      evidence: [...new Set([...(project.evidence ?? []), ...workspace.evidence, ...workspace.modules.map((module) => module.manifest)])],
      warnings: [...(project.warnings ?? []), ...workspace.warnings],
      candidates: projects,
      packageJson: project.packageJson,
      blocking: workspace.conflicts.length > 0 ? `Workspace discovery conflicts: ${workspace.conflicts.join("; ")}` : undefined,
    };
    packageManager = {
      value: managers.length === 1 ? managers[0] : "mixed",
      confidence: "high",
      evidence: workspace.modules.map((module) => `${module.id}:${module.packageManager}`),
      warnings: [],
      blocking: undefined,
    };
  }
  const commands = project.value === "workspace"
    ? (project.packageJson ? detectNodeCommands(project.packageJson, packageManager.value === "mixed" ? "npm" : packageManager.value, "typescript") : {})
    : project.value && ["typescript", "javascript", "react"].includes(project.value)
      ? detectNodeCommands(project.packageJson, packageManager.value ?? "npm", project.value)
      : standardCommands(project.value);
  const git = await inspectGit(root);
  const unsafeSymlinks = await inspectProspectiveSymlinks(root);
  const ticketTracks = await findTicketTracks(root);

  return {
    schemaVersion: 1,
    root,
    project: {
      value: project.value,
      confidence: project.confidence,
      evidence: project.evidence,
      candidates: project.candidates,
      warnings: project.warnings ?? [],
      blocking: project.blocking,
    },
    packageManager: {
      value: packageManager.value,
      confidence: packageManager.confidence,
      evidence: packageManager.evidence ?? [],
      warnings: packageManager.warnings ?? [],
      blocking: packageManager.blocking,
    },
    commands,
    git,
    unsafeSymlinks,
    ticketTracks,
    workspace,
    identityFiles: {
      ...(await identityFileHashes(root)),
      ...Object.fromEntries(await Promise.all(workspace.modules.map(async (module) => [module.manifest, await hashFile(path.join(root, module.manifest))]))),
    },
    existing: {
      agentsMd: await exists(path.join(root, "AGENTS.md")),
      agentic: await exists(path.join(root, ".agentic")),
      codexConfig: await exists(path.join(root, ".codex", "config.toml")),
      opencodeConfig: await exists(path.join(root, "opencode.json")),
      docsAgent: await exists(path.join(root, "docs", "agent")),
    },
    toolAvailability: {
      git: commandExists("git"),
      python: commandExists(process.platform === "win32" ? "py" : "python3") || commandExists("python"),
      project: project.value === "workspace"
        ? workspace.modules.every((module) => module.toolAvailable !== false)
        : project.value === "rust" ? commandExists("cargo") : project.value === "flutter" ? commandExists("flutter") : packageManager.value ? commandExists(packageManager.value) : false,
    },
  };
}
