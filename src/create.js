import { readFile } from "node:fs/promises";
import path from "node:path";
import { commandsFor, generateAgentsMd } from "./agents-md.js";
import { PACKAGE_VERSION } from "./constants.js";
import {
  ensureDirectory,
  exists,
  hashBuffer,
  isDirectoryEmpty,
  removePath,
  writeBytesAtomic,
  writeJson,
  writeText,
} from "./fs-utils.js";
import { dartPackageName, displayNameFromTarget, npmName, rustCrateName } from "./names.js";
import { createProfile, profileSchema } from "./profile.js";
import { commandExists, runCommandAsync } from "./process-utils.js";
import { createScaffold, scaffoldStructure } from "./scaffolds/index.js";
import { generatedReadme } from "./scaffolds/shared.js";
import { syncSkills } from "./sync.js";
import {
  agenticReadme,
  architectureNote,
  canonicalSkillArtifacts,
  createAgenticConfig,
  dependencyNote,
  harnessArtifacts,
  policyArtifacts,
  projectMemoryArtifacts,
  scriptArtifacts,
  skillBaselineArtifacts,
  skillLock,
  generatedWorkspace,
  workspaceStateArtifacts,
} from "./workspace-artifacts.js";

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const DEFAULT_COMMAND_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_COMMAND_OUTPUT_BYTES = 100_000;

function formatCommandFailure(command, args, result) {
  const prefix = `${command} ${args.join(" ")}`;
  if (result?.error) return `${prefix} failed to start: ${String(result.error.message ?? result.error)}`;
  if (result?.timedOut) return `${prefix} timed out after ${result.durationMs ?? "unknown"}ms`;
  if (result?.status !== 0) {
    const detail = (result.stdout || result.stderr) ? `\n${result.stdout || ""}${result.stderr || ""}`.trim() : "";
    return `${prefix} exited with code ${result.status}.${detail ? ` ${detail}` : ""}`;
  }
  return `${prefix} failed`;
}

async function runCreateCommand(command, args, options = {}) {
  const result = await (options.runner ?? runCommandAsync)(command, args, {
    cwd: options.cwd,
    timeout: options.timeout ?? DEFAULT_COMMAND_TIMEOUT_MS,
    maxOutputBytes: options.maxOutputBytes ?? DEFAULT_COMMAND_OUTPUT_BYTES,
    env: options.env,
  });

  if (result.error || result.status !== 0 || result.timedOut) {
    throw new Error(formatCommandFailure(command, args, result));
  }

  return result;
}

function resolveCreateActions(options, warnings = []) {
  const resolved = { ...options };
  const isFlutterProject = options.project === "flutter";
  if (options.yes && options.allowNetwork !== true) {
    if (options.install && options.installExplicit !== true) {
      resolved.install = false;
      warnings.push("Install was skipped because --yes was used without --allow-network. Use --install --allow-network to run dependency install.");
    }
    if (isFlutterProject && options.bootstrap && options.bootstrapExplicit !== true) {
      resolved.bootstrap = false;
      warnings.push("Flutter bootstrap was skipped because --yes was used without --allow-network. Use --bootstrap --allow-network to run Flutter bootstrap.");
    }
  }
  if (options.yes && !options.allowNetwork) {
    if (resolved.install && options.installExplicit === true) {
      throw new Error("--yes requires --allow-network to run dependency install in create.");
    }
    if (isFlutterProject && resolved.bootstrap && options.bootstrapExplicit === true) {
      throw new Error("--yes requires --allow-network to run Flutter bootstrap in create.");
    }
  }
  return resolved;
}

function editorConfig() {
  return `root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true

[*.rs]
indent_size = 4

[*.dart]
indent_size = 2

[*.md]
trim_trailing_whitespace = false
`;
}

async function mergeGitignore(filePath, generated) {
  if (!(await exists(filePath))) {
    await writeText(filePath, generated);
    return;
  }
  const existing = await readFile(filePath, "utf8");
  const seen = new Set(existing.replaceAll("\r\n", "\n").split("\n"));
  const additions = generated
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => line && !seen.has(line));
  const combined = `${existing.trimEnd()}\n${additions.length ? `\n# workspace-template\n${additions.join("\n")}\n` : ""}`;
  await writeText(filePath, combined);
}

async function writeScaffoldFiles(root, files) {
  for (const [relative, content] of Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) {
    const destination = path.join(root, relative);
    if (relative === ".gitignore") await mergeGitignore(destination, content);
    else await writeText(destination, content);
  }
}

function packageInstallCommand(project, packageManager) {
  if (["typescript", "javascript", "react"].includes(project)) return { command: packageManager, args: ["install"] };
  if (project === "rust") return { command: "cargo", args: ["check"] };
  if (project === "flutter") return { command: "flutter", args: ["pub", "get"] };
  return undefined;
}

async function bootstrapFlutter(root, packageName, options, warnings) {
  if (!options.bootstrap || options.project !== "flutter") return;
  if (!commandExists("flutter")) {
    warnings.push(`Flutter CLI was not found, so platform folders were not generated. Run \`flutter create --project-name ${packageName} .\` after installing Flutter.`);
    return;
  }
  if (!(await isDirectoryEmpty(root))) return;
  await runCreateCommand(
    "flutter",
    ["create", "--project-name", packageName, "--org", "com.example", "--no-pub", "."],
    { cwd: root, timeout: options.timeout },
  );
  await removePath(path.join(root, "test", "widget_test.dart"));
}

function assertSafeTarget(root) {
  if (root === path.parse(root).root) throw new Error("Refusing to scaffold into a filesystem root");
}

function filterMemoryArtifacts(artifacts, options) {
  return artifacts.filter((artifact) => {
    if (artifact.path.startsWith("docs/") && options.docs === false) return false;
    if (artifact.path.startsWith("docs/tickets/") && options.tickets === false) return false;
    return true;
  });
}

function managedFilesFor(artifacts) {
  return {
    version: 2,
    generator: "workspace-template",
    generatorVersion: PACKAGE_VERSION,
    files: Object.fromEntries(
      artifacts
        .map((artifact) => {
          const content = Buffer.isBuffer(artifact.content) ? artifact.content : Buffer.from(String(artifact.content));
          return [artifact.path, { mode: "managed", hash: hashBuffer(content) }];
        })
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

async function generatedArtifacts(context, options) {
  const profile = createProfile({
    project: context.project,
    style: context.style,
    tdd: context.tdd,
    agents: context.agents,
    mode: "generated",
  });
  const config = createAgenticConfig({
    mode: "generated",
    project: context.project,
    style: context.style,
    tdd: context.tdd,
    packageManager: context.packageManager,
    agents: context.agents,
    docs: options.docs !== false,
    tickets: options.tickets !== false,
  });

  const memory = filterMemoryArtifacts(await projectMemoryArtifacts(), options);
  const artifacts = [
    { path: "AGENTS.md", content: Buffer.from(generateAgentsMd({ ...context, mode: "generated" })) },
    { path: ".agentic/README.md", content: Buffer.from(agenticReadme("generated")) },
    { path: ".agentic/implementation-profile.md", content: Buffer.from(architectureNote({ ...context, mode: "generated" })) },
    { path: ".agentic/dependency-snapshot.md", content: Buffer.from(dependencyNote(context.project)) },
    { path: ".agentic/profile.json", content: jsonBuffer(profile) },
    { path: ".agentic/profile.schema.json", content: jsonBuffer(profileSchema()) },
    { path: ".agentic/config.json", content: jsonBuffer(config) },
    ...(await canonicalSkillArtifacts()),
    ...(await skillBaselineArtifacts()),
    ...(await policyArtifacts()),
    ...(await scriptArtifacts()),
    ...memory,
    ...(await harnessArtifacts(context.agents)),
    ...(await workspaceStateArtifacts(generatedWorkspace(context), context, { nestedInstructions: "never" })),
  ].sort((left, right) => left.path.localeCompare(right.path));

  artifacts.push({ path: ".agentic/skills.lock.json", content: jsonBuffer(await skillLock()) });
  const managed = managedFilesFor(artifacts);
  artifacts.push({ path: ".agentic/managed-files.json", content: jsonBuffer(managed) });
  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

async function writeArtifacts(root, artifacts) {
  for (const artifact of artifacts) {
    const destination = path.join(root, ...artifact.path.split("/"));
    await writeBytesAtomic(destination, Buffer.isBuffer(artifact.content) ? artifact.content : Buffer.from(String(artifact.content)));
  }
}

export async function createProject(options) {
  if (!options.target) throw new Error("Target directory is required");
  if (!options.project) throw new Error("--project is required");

  const root = path.resolve(options.target);
  assertSafeTarget(root);
  const projectName = displayNameFromTarget(root);
  const context = {
    projectName,
    project: options.project,
    style: options.style,
    tdd: options.tdd,
    packageManager: options.packageManager,
    agents: options.agents,
    npmName: npmName(projectName),
    rustCrateName: rustCrateName(projectName),
    dartPackageName: dartPackageName(projectName),
  };
  context.commands = commandsFor(context.project, context.packageManager);
  const warnings = [];
  const effectiveOptions = resolveCreateActions(options, warnings);

  const files = createScaffold(context);
  const structure = scaffoldStructure(context.project, context.style);
  const generatedCommon = {
    "README.md": generatedReadme({
      projectName,
      project: context.project,
      style: context.style,
      tdd: context.tdd,
      commands: context.commands,
      structure,
      notes:
        context.project === "react"
          ? ["The counter has no external data boundary, so even clean style deliberately creates no repository."]
          : context.project === "flutter"
            ? ["The sample follows pure Dart domain logic plus a thin ViewModel and widget; add repositories/services only when external data exists."]
            : [],
    }),
    ".editorconfig": editorConfig(),
  };
  const artifacts = await generatedArtifacts(context, options);
  const plannedFiles = [...Object.keys(files), ...Object.keys(generatedCommon), ...artifacts.map((artifact) => artifact.path), ".agentic/managed-projections.json"]
    .filter((value, index, array) => array.indexOf(value) === index)
    .sort();

  if (options.dryRun) {
    const install = packageInstallCommand(context.project, context.packageManager);
    return {
      root,
      context,
      warnings,
      dryRun: true,
      plannedFiles,
      plannedCommands: [
        effectiveOptions.project === "flutter" && effectiveOptions.bootstrap
          ? `flutter create --project-name ${context.dartPackageName} --org com.example --no-pub .`
          : undefined,
        effectiveOptions.install && install ? `${install.command} ${install.args.join(" ")}` : undefined,
        effectiveOptions.git ? "git init" : undefined,
      ].filter(Boolean),
    };
  }

  if ((await exists(root)) && !(await isDirectoryEmpty(root)) && !options.force) {
    throw new Error(`Target directory is not empty: ${root}. Use adopt/retrofit for an existing repository, or --force only for an intentional overlay.`);
  }
  await ensureDirectory(root);
  await bootstrapFlutter(root, context.dartPackageName, effectiveOptions, warnings);
  await writeScaffoldFiles(root, files);
  await writeScaffoldFiles(root, generatedCommon);
  await writeArtifacts(root, artifacts);
  await syncSkills(root, context.agents);

  if (effectiveOptions.install) {
    const install = packageInstallCommand(context.project, context.packageManager);
    if (install && commandExists(install.command)) {
      await runCreateCommand(install.command, install.args, {
        cwd: root,
        timeout: options.timeout,
      });
    }
    else if (install) warnings.push(`${install.command} was not found. Dependencies/checks were not installed or run; use ${context.commands.setup} later.`);
  }

  if (effectiveOptions.git) {
    if (!commandExists("git")) warnings.push("git was not found; repository was not initialized.");
    else if (!(await exists(path.join(root, ".git")))) {
      await runCreateCommand("git", ["init"], { cwd: root, timeout: options.timeout });
    }
  }

  return { root, context, warnings, dryRun: false, plannedFiles };
}
