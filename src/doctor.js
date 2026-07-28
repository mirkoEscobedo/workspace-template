import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  exists,
  hashDirectory,
  hashFile,
  isPathInside,
  readJson,
} from "./fs-utils.js";
import { projectionStatus } from "./sync.js";
import { CODEX_ROLE_FILES, PREFERRED_ROLE_IDS } from "./presets/render.js";

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseFrontmatter(content) {
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  if (lines[0] !== "---") return { data: {}, bodyStart: 0, error: "missing opening ---" };
  const end = lines.indexOf("---", 1);
  if (end === -1) return { data: {}, bodyStart: 0, error: "missing closing ---" };

  const data = {};
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || /^\s/.test(line)) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    data[key] = unquote(value);
  }
  return { data, bodyStart: end + 1, error: undefined };
}

function validateName(name) {
  return (
    typeof name === "string" &&
    name.length >= 1 &&
    name.length <= 64 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
  );
}

async function validateLinks(skillDirectory, content, issues) {
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of content.matchAll(linkPattern)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, "");
    if (
      rawTarget.startsWith("http://") ||
      rawTarget.startsWith("https://") ||
      rawTarget.startsWith("mailto:") ||
      rawTarget.startsWith("#")
    ) {
      continue;
    }
    const target = rawTarget.split("#", 1)[0];
    if (!target) continue;
    const resolved = path.resolve(skillDirectory, target);
    if (!isPathInside(skillDirectory, resolved)) {
      issues.errors.push(`link escapes skill directory: ${rawTarget}`);
      continue;
    }
    if (!(await exists(resolved))) issues.errors.push(`broken link: ${rawTarget}`);
  }
}

async function readValidatedJson(filePath, issues) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.errors.push(`${path.basename(filePath)} is invalid JSON: ${message}`);
    return undefined;
  }
}

function validateTriggerEvals(value, issues) {
  if (!Array.isArray(value)) {
    issues.errors.push("trigger-evals.json must be an array");
    return;
  }
  let positives = 0;
  let negatives = 0;
  const queries = new Set();
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      issues.errors.push(`trigger eval ${index + 1} must be an object`);
      return;
    }
    if (typeof entry.query !== "string" || entry.query.trim().length < 3) {
      issues.errors.push(`trigger eval ${index + 1} requires a realistic query`);
    } else if (queries.has(entry.query)) {
      issues.errors.push(`trigger eval ${index + 1} duplicates a query`);
    } else queries.add(entry.query);
    if (typeof entry.should_trigger !== "boolean") {
      issues.errors.push(`trigger eval ${index + 1} requires boolean should_trigger`);
    } else if (entry.should_trigger) positives += 1;
    else negatives += 1;
  });
  if (value.length < 8) issues.warnings.push("trigger eval set has fewer than 8 cases");
  if (positives === 0 || negatives === 0) {
    issues.errors.push("trigger evals require both positive and negative cases");
  }
}

function validateOutputEvals(value, skillName, issues) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.errors.push("evals.json must be an object");
    return;
  }
  if (value.skill_name !== skillName) {
    issues.errors.push(`evals.json skill_name '${value.skill_name}' does not match directory`);
  }
  if (!Array.isArray(value.evals) || value.evals.length < 2) {
    issues.errors.push("evals.json requires at least two realistic evals");
    return;
  }
  const ids = new Set();
  value.evals.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      issues.errors.push(`output eval ${index + 1} must be an object`);
      return;
    }
    if (typeof entry.id !== "string" || !entry.id.trim()) {
      issues.errors.push(`output eval ${index + 1} requires id`);
    } else if (ids.has(entry.id)) {
      issues.errors.push(`output eval ${index + 1} duplicates id '${entry.id}'`);
    } else ids.add(entry.id);
    if (typeof entry.prompt !== "string" || entry.prompt.trim().length < 10) {
      issues.errors.push(`output eval ${index + 1} requires a realistic prompt`);
    }
    if (typeof entry.expected_output !== "string" || entry.expected_output.trim().length < 20) {
      issues.errors.push(`output eval ${index + 1} requires a specific expected_output`);
    }
  });
}

export async function validateSkillTree(skillRoot) {
  const root = path.resolve(skillRoot);
  const report = { root, skills: [], errors: [], warnings: [] };
  if (!(await exists(root))) {
    report.errors.push(`Skill root does not exist: ${root}`);
    return report;
  }

  const entries = await readdir(root, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of directories) {
    const skillDirectory = path.join(root, entry.name);
    const skillFile = path.join(skillDirectory, "SKILL.md");
    const issues = { name: entry.name, errors: [], warnings: [] };

    if (!(await exists(skillFile))) {
      issues.errors.push("missing SKILL.md");
      report.skills.push(issues);
      continue;
    }

    const content = await readFile(skillFile, "utf8");
    const lines = content.replaceAll("\r\n", "\n").split("\n");
    const frontmatter = parseFrontmatter(content);
    if (frontmatter.error) issues.errors.push(frontmatter.error);

    const name = frontmatter.data.name;
    const description = frontmatter.data.description;
    if (!validateName(name)) issues.errors.push("frontmatter name is invalid");
    if (name !== entry.name) issues.errors.push(`frontmatter name '${name}' does not match directory`);
    if (!description) issues.errors.push("frontmatter description is required");
    if (description && description.length > 1024) {
      issues.errors.push(`description is ${description.length} characters; maximum is 1024`);
    }
    if (description && !/use\b|when\b/i.test(description)) {
      issues.warnings.push("description may not clearly state when to use the skill");
    }
    if (lines.length > 500) issues.warnings.push(`SKILL.md is ${lines.length} lines; consider progressive disclosure`);
    if (content.length > 20_000) {
      issues.warnings.push("SKILL.md is over approximately 5,000 tokens; consider progressive disclosure");
    }

    await validateLinks(skillDirectory, content, issues);

    const triggerEvals = path.join(skillDirectory, "evals", "trigger-evals.json");
    const outputEvals = path.join(skillDirectory, "evals", "evals.json");
    const hasTriggerEvals = await exists(triggerEvals);
    const hasOutputEvals = await exists(outputEvals);
    if (hasTriggerEvals) validateTriggerEvals(await readValidatedJson(triggerEvals, issues), issues);
    if (hasOutputEvals) validateOutputEvals(await readValidatedJson(outputEvals, issues), entry.name, issues);
    if (hasTriggerEvals !== hasOutputEvals) {
      issues.warnings.push("skill has only one of trigger-evals.json or evals.json");
    }

    report.skills.push(issues);
  }

  for (const skill of report.skills) {
    for (const error of skill.errors) report.errors.push(`${skill.name}: ${error}`);
    for (const warning of skill.warnings) report.warnings.push(`${skill.name}: ${warning}`);
  }
  return report;
}

async function readJsonForDoctor(filePath, report, label) {
  try {
    return await readJson(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.errors.push(`invalid ${label}: ${message}`);
    return undefined;
  }
}

async function validateManagedFiles(root, report) {
  const file = path.join(root, ".agentic", "managed-files.json");
  if (!(await exists(file))) {
    report.errors.push("missing .agentic/managed-files.json");
    return undefined;
  }
  const manifest = await readJsonForDoctor(file, report, "managed-files manifest");
  if (!manifest) return undefined;
  if (manifest.generator !== "workspace-template") {
    report.errors.push("managed-files.json is not owned by workspace-template");
    return manifest;
  }
  if (![1, 2, 3].includes(manifest.version)) report.errors.push(`unsupported managed-files version ${manifest.version}`);
  for (const [relative, record] of Object.entries(manifest.files ?? {})) {
    const target = path.join(root, relative);
    if (!isPathInside(root, target)) {
      report.errors.push(`managed path escapes repository root: ${relative}`);
      continue;
    }
    if (!(await exists(target))) {
      if (record.mode === "proposal") report.warnings.push(`proposal target is missing: ${relative}`);
      else report.errors.push(`managed file is missing: ${relative}`);
      continue;
    }
    if (record.hash && (await hashFile(target)) !== record.hash) {
      report.warnings.push(`managed file drift detected: ${relative}`);
    }
  }
  return manifest;
}

async function validateSkillLock(root, skillReport, report) {
  const lockPath = path.join(root, ".agentic", "skills.lock.json");
  if (!(await exists(lockPath))) {
    report.errors.push("missing .agentic/skills.lock.json");
    return undefined;
  }
  const lock = await readJsonForDoctor(lockPath, report, "skills lock");
  if (!lock) return undefined;
  if (![1, 2].includes(lock.version)) report.errors.push(`unsupported skills-lock version ${lock.version}`);

  const names = new Set(skillReport.skills.map((skill) => skill.name));
  for (const [name, record] of Object.entries(lock.skills ?? {})) {
    const skillPath = path.join(root, record.path ?? `.agentic/skills/${name}`);
    const baselinePath = path.join(root, record.baselinePath ?? `.agentic/skill-baselines/${name}`);
    if (!(await exists(skillPath))) {
      report.errors.push(`skill lock references missing skill '${name}'`);
      continue;
    }
    names.delete(name);
    if (lock.version >= 2 || record.baselinePath) {
      if (!(await exists(baselinePath))) {
        report.errors.push(`skill lock references missing baseline for '${name}'`);
      } else if (record.baselineHash && (await hashDirectory(baselinePath)) !== record.baselineHash) {
        report.errors.push(`skill baseline '${name}' differs from skills.lock.json`);
      }
    }
    const current = await hashDirectory(skillPath);
    const installedHash = record.installedHash ?? record.baselineHash;
    if (installedHash && current !== installedHash) {
      const allowed = record.localEditsAllowed !== false;
      const message = `canonical skill '${name}' contains local edits relative to its installed baseline`;
      if (allowed) report.warnings.push(message);
      else report.errors.push(message);
    }
  }
  for (const name of [...names].sort()) report.warnings.push(`canonical skill '${name}' is not listed in skills.lock.json`);
  return lock;
}

function managed(manifest, relative) {
  return Boolean(manifest?.files?.[relative]);
}

async function validateHarnessConfiguration(root, config, managedFiles, report) {
  const targets = new Set(config?.agentTargets ?? []);
  const preserveHostBundles = config?.hostBundles === "preserve";
  const preset = config?.execution?.preset;
  const routes = preset?.roles ?? config?.execution?.routing;
  const overridden = (target) => new Set((preset?.overrides ?? []).filter((item) => item.target === target).map((item) => item.pointer));
  if (targets.has("codex")) {
    const relative = ".codex/config.toml";
    const file = path.join(root, relative);
    if (preserveHostBundles) {
      report.warnings.push((await exists(file))
        ? "Codex host bundle is product-owned and preserved; managed projection validation is not required"
        : "Codex host bundle is product-owned and preserved; managed .codex/config.toml is not required");
    } else if (!(await exists(file))) {
      report.errors.push(`Codex is selected but ${relative} is missing`);
    } else if (managed(managedFiles, relative) || managedFiles?.settings?.[relative]) {
      const content = await readFile(file, "utf8");
      const required = [
        ["/model", `model = "${routes?.coordinator?.targets?.codex}"`],
        ["/model_reasoning_effort", `model_reasoning_effort = "${routes?.coordinator?.reasoningEffort}"`],
        ["/agents/default_subagent_model", `default_subagent_model = "${routes?.implementer?.targets?.codex}"`],
        ["/agents/default_subagent_reasoning_effort", `default_subagent_reasoning_effort = "${routes?.implementer?.reasoningEffort}"`],
        ["/agents/max_concurrent_threads_per_session", "max_concurrent_threads_per_session = 3"],
      ].filter(([, value]) => !value.includes("undefined"));
      const codexOverrides = overridden("codex");
      for (const [pointer, value] of required) {
        if (codexOverrides.has(pointer)) continue;
        if (!content.includes(value)) report.errors.push(`${relative} is missing required Frontier setting: ${value}`);
      }
      const roleDirectory = path.join(root, ".codex", "agents");
      for (const [role, defaultFile] of Object.entries(CODEX_ROLE_FILES)) {
        const id = preset?.roleIds?.codex?.[role] ?? PREFERRED_ROLE_IDS.codex[role];
        const fileName = id === PREFERRED_ROLE_IDS.codex[role] ? defaultFile : `${id}.toml`;
        if (!(await exists(path.join(roleDirectory, fileName)))) report.errors.push(`missing .codex/agents/${fileName}`);
      }
    } else {
      report.warnings.push("custom Codex configuration is preserved; review the Frontier proposal/model split manually");
    }
  }

  if (targets.has("opencode")) {
    const relative = "opencode.json";
    const file = path.join(root, relative);
    if (preserveHostBundles) {
      report.warnings.push((await exists(file))
        ? "OpenCode host bundle is product-owned and preserved; managed projection validation is not required"
        : "OpenCode host bundle is product-owned and preserved; managed opencode.json is not required");
    } else if (!(await exists(file))) {
      report.errors.push("OpenCode is selected but opencode.json is missing");
    } else if (managed(managedFiles, relative) || managedFiles?.settings?.[relative]) {
      const value = await readJsonForDoctor(file, report, "OpenCode configuration");
      if (value) {
        for (const [role, route] of Object.entries(routes ?? {})) {
          const id = preset?.roleIds?.opencode?.[role] ?? PREFERRED_ROLE_IDS.opencode[role];
          const agent = value.agent?.[id];
          if (!agent) {
            report.errors.push(`opencode.json is missing preset role ${id}`);
            continue;
          }
          if (agent.model !== route.targets?.opencode) report.errors.push(`opencode.json ${id} must use ${route.targets?.opencode}`);
          if (agent.reasoningEffort !== route.reasoningEffort) report.errors.push(`opencode.json ${id} must use ${route.reasoningEffort} reasoning`);
        }
      }
    } else {
      report.warnings.push("custom OpenCode configuration is preserved; review the Frontier proposal/model split manually");
    }
  }
}

async function validateProfileAndConfig(root, report) {
  const configPath = path.join(root, ".agentic", "config.json");
  const profilePath = path.join(root, ".agentic", "profile.json");
  const config = await readJsonForDoctor(configPath, report, "project configuration");
  const profile = await readJsonForDoctor(profilePath, report, "implementation profile");
  if (!config || !profile) return { config, profile };

  if (![1, 2, 3].includes(config.version)) report.errors.push(`unsupported config version ${config.version}`);
  if (config.generator !== "workspace-template") report.errors.push("config generator identity is invalid");
  if (!["generated", "adopted", undefined].includes(config.mode)) report.errors.push(`invalid config mode '${config.mode}'`);
  if (!["managed", "preserve", undefined].includes(config.hostBundles)) report.errors.push(`invalid hostBundles mode '${config.hostBundles}'`);
  if (![1, 2].includes(profile.version)) report.errors.push(`unsupported profile version ${profile.version}`);
  if (profile.version === 2 && !["generated", "adopted"].includes(profile.mode)) report.errors.push(`invalid profile mode '${profile.mode}'`);
  if (config.mode !== undefined && profile.mode !== undefined && config.mode !== profile.mode) {
    report.errors.push(`config/profile mode mismatch: ${config.mode} != ${profile.mode}`);
  }

  for (const key of ["project", "style", "tdd"]) {
    if (config[key] !== undefined && profile[key] !== undefined && config[key] !== profile[key]) {
      report.errors.push(`config/profile ${key} mismatch: ${config[key]} != ${profile[key]}`);
    }
  }
  if (profile.version === 2 && typeof profile.architecture !== "object") {
    report.errors.push("profile version 2 requires an architecture object");
  }
  if (config.execution?.preset) {
    const roles = config.execution.preset.roles;
    if (!roles?.coordinator || !roles?.planner || !roles?.implementer) report.errors.push("active preset routing is incomplete");
    if (config.execution.coordinator?.model !== (roles?.coordinator?.targets?.codex ?? roles?.coordinator?.targets?.opencode)) report.errors.push("config coordinator does not match active preset");
    if (config.execution.planner?.model !== (roles?.planner?.targets?.codex ?? roles?.planner?.targets?.opencode)) report.errors.push("config planner does not match active preset");
    if (config.execution.workers?.model !== (roles?.implementer?.targets?.codex ?? roles?.implementer?.targets?.opencode)) report.errors.push("config worker does not match active preset");
    if (config.execution.preset.status === "partial") {
      report.warnings.push(`active agent preset is partial; ${config.execution.preset.overrides?.length ?? 0} user-owned setting(s) override routing`);
    }
  } else if (config.version === 2) {
    if (config.execution?.coordinator?.model !== "gpt-5.6-sol") report.errors.push("legacy config coordinator model must be gpt-5.6-sol");
    if (config.execution?.planner?.model !== "gpt-5.6-sol") report.errors.push("legacy config planner model must be gpt-5.6-sol");
    if (config.execution?.workers?.model !== "gpt-5.3-codex") report.errors.push("legacy config worker model must be gpt-5.3-codex");
  }

  report.checks.project = config.project;
  report.checks.style = config.style;
  report.checks.tdd = config.tdd;
  report.checks.mode = config.mode ?? profile.mode ?? "generated";
  report.checks.hostBundles = config.hostBundles ?? "managed";
  return { config, profile };
}

async function validateWorkspaceState(root, report) {
  const file = path.join(root, ".agentic", "workspace.json");
  if (!(await exists(file))) {
    report.warnings.push("workspace model is missing; rerun create/adopt to enable monorepo orchestration");
    return undefined;
  }
  const workspace = await readJsonForDoctor(file, report, "workspace model");
  if (!workspace) return undefined;
  if (workspace.version !== 1) report.errors.push(`unsupported workspace model version ${workspace.version}`);
  const ids = new Set();
  for (const module of workspace.modules ?? []) {
    if (!module.id || ids.has(module.id)) report.errors.push(`duplicate or missing workspace module id '${module.id ?? ""}'`);
    ids.add(module.id);
    const moduleRoot = path.resolve(root, module.path === "." ? "" : module.path);
    if (!isPathInside(root, moduleRoot)) {
      report.errors.push(`workspace module path escapes root: ${module.path}`);
      continue;
    }
    if (!(await exists(path.resolve(root, module.manifest)))) report.errors.push(`workspace module '${module.id}' manifest is missing: ${module.manifest}`);
    const stateRoot = path.join(root, ".agentic", "modules", module.id);
    for (const name of ["profile.json", "commands.json"]) {
      if (!(await exists(path.join(stateRoot, name)))) report.errors.push(`workspace module '${module.id}' is missing .agentic/modules/${module.id}/${name}`);
    }
    for (const dependency of module.dependencies ?? []) {
      if (!(workspace.modules ?? []).some((candidate) => candidate.id === dependency)) {
        report.errors.push(`workspace module '${module.id}' references unknown dependency '${dependency}'`);
      }
    }
  }
  report.checks.workspaceModules = (workspace.modules ?? []).length;
  return workspace;
}

export async function doctorProject(rootDirectory) {
  const root = path.resolve(rootDirectory);
  const report = {
    root,
    errors: [],
    warnings: [],
    checks: {},
    skills: undefined,
    projections: undefined,
  };

  const required = [
    "AGENTS.md",
    ".agentic/config.json",
    ".agentic/profile.json",
    ".agentic/profile.schema.json",
    ".agentic/skills.lock.json",
    ".agentic/managed-files.json",
  ];
  for (const relative of required) {
    const present = await exists(path.join(root, relative));
    report.checks[relative] = present;
    if (!present) report.errors.push(`missing ${relative}`);
  }

  if (!(await exists(path.join(root, ".agentic", "config.json"))) || !(await exists(path.join(root, ".agentic", "profile.json")))) {
    report.ok = false;
    return report;
  }

  const { config } = await validateProfileAndConfig(root, report);
  const managedFiles = await validateManagedFiles(root, report);
  await validateWorkspaceState(root, report);

  const skillRoot = path.join(root, ".agentic", "skills");
  report.skills = await validateSkillTree(skillRoot);
  report.errors.push(...report.skills.errors);
  report.warnings.push(...report.skills.warnings);
  await validateSkillLock(root, report.skills, report);

  if (config) {
    try {
      report.projections = await projectionStatus(root);
      for (const projection of report.projections.results) {
        if (!projection.exists) report.warnings.push(`projection missing for ${projection.agent}`);
        else if (!projection.inSync) report.warnings.push(`projection drift detected for ${projection.agent}`);
        if (!projection.instructionExists) {
          report.warnings.push(`${projection.instructionFile} is missing for ${projection.agent}; AGENTS.md will not be loaded automatically`);
        } else if (!projection.instructionLinked) {
          report.warnings.push(`${projection.instructionFile} does not import AGENTS.md for ${projection.agent}; custom file was preserved`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.errors.push(`projection status failed: ${message}`);
    }
    await validateHarnessConfiguration(root, config, managedFiles, report);
  }

  if (await exists(path.join(root, ".agentic", "proposals", "AGENTS.md"))) {
    report.warnings.push("an AGENTS.md proposal is awaiting manual integration");
  }
  if (!(await exists(path.join(root, "docs", "agent", "PROJECT_MAP.md")))) {
    report.warnings.push("durable docs/agent planning memory is not installed");
  }
  if (!(await exists(path.join(root, ".agentic", "scripts", "managed_command.py")))) {
    report.warnings.push("managed process command wrapper is not installed");
  }

  report.ok = report.errors.length === 0;
  return report;
}

export function printDoctorReport(report) {
  const status = report.ok ? "PASS" : "FAIL";
  console.log(`\nAgentic workspace doctor: ${status}`);
  console.log(`Root: ${report.root}`);
  if (report.skills) console.log(`Skills checked: ${report.skills.skills.length}`);

  if (report.errors.length > 0) {
    console.log("\nErrors:");
    for (const error of report.errors) console.log(`  - ${error}`);
  }
  if (report.warnings.length > 0) {
    console.log("\nWarnings:");
    for (const warning of report.warnings) console.log(`  - ${warning}`);
  }
  if (report.errors.length === 0 && report.warnings.length === 0) {
    console.log("No structural, skill, harness, ownership, or projection problems found.");
  }
}
