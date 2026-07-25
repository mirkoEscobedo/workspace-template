import path from "node:path";
import { readFile } from "node:fs/promises";
import { createPlan, repositoryPreconditions } from "../plans/index.js";
import { discoverWorkspace } from "../workspace/discover.js";
import { assessArchitecture } from "./assess.js";
import { exists, toPosixPath } from "../fs-utils.js";
import { buildRecipeTasks, recipeFor } from "./recipes.js";

function relatedTestPaths(useCase, assessment) {
  const stem = path.basename(useCase, path.extname(useCase)).replace(/(?:service|use.?case|controller|handler)/ig, "").toLowerCase();
  return assessment.seams.filter((seam) => seam.kind === "test-file" && path.basename(seam.file).toLowerCase().includes(stem)).map((seam) => seam.file);
}

function effectFindings(useCase, assessment) {
  return assessment.findings.filter((finding) => finding.file === useCase && finding.kind === "effect");
}

export async function planAlignment(rootDirectory, options = {}) {
  const root = path.resolve(rootDirectory);
  const workspace = await discoverWorkspace(root, { includeOpaque: true });
  const requested = new Set(options.modules ?? []);
  const modules = workspace.modules.filter((module) => requested.size === 0 || requested.has(module.id) || requested.has(module.path));
  if (modules.length !== 1) throw new Error(`align plan requires exactly one selected module; found ${modules.length}. Use --module.`);
  const module = modules[0];
  const assessment = await assessArchitecture(root, { workspaceSnapshot: workspace, modules: [module.id] });
  if (!options.useCase) throw new Error("align plan requires --use-case <path-or-name>");
  const candidates = assessment.candidates.filter((candidate) => candidate.file === options.useCase || candidate.file.endsWith(`/${options.useCase}`) || path.basename(candidate.file, path.extname(candidate.file)) === options.useCase);
  let useCase = candidates[0]?.file;
  if (!useCase) {
    const prefix = module.path === "." ? "" : `${module.path}/`;
    const proposed = toPosixPath(options.useCase).startsWith(prefix) ? toPosixPath(options.useCase) : `${prefix}${toPosixPath(options.useCase)}`;
    if (await exists(path.resolve(root, proposed))) useCase = proposed;
  }
  if (!useCase) throw new Error(`Could not resolve use case '${options.useCase}' to a source file`);
  const tests = relatedTestPaths(useCase, assessment);
  const effects = effectFindings(useCase, assessment);
  const useCaseDirectory = toPosixPath(path.dirname(useCase));
  const allowedPaths = [...new Set([useCase, `${useCaseDirectory}/**`, ...tests, ...(options.allowedPaths ?? [])])];
  const moduleCommands = module.commands?.fullSteps ?? [];
  const taskCommands = moduleCommands.map((item) => ({ ...item, cwd: module.path, moduleId: module.id }));
  const characterization = options.characterization ?? "required";
  const style = options.style ?? "functional-core";
  const recipe = recipeFor(style);
  const hiddenEffects = effects.filter((finding) => ["clock", "randomness", "environment"].includes(finding.effect));
  const volatileEffects = effects.filter((finding) => ["database", "http", "filesystem", "queue"].includes(finding.effect));
  const templates = buildRecipeTasks(style, {
    includeCharacterization: tests.length === 0 || characterization === "required",
    hiddenEffects,
    volatileEffects,
    effects,
  });
  const tasks = templates.map((template, index) => ({
    id: `slice-${String(index + 1).padStart(2, "0")}-${template.key}`,
    title: template.title,
    allowedPaths,
    acceptanceCriteria: template.acceptanceCriteria,
    requiredCommands: taskCommands,
    status: "pending",
    kind: template.kind,
    recipe: template.recipe,
  }));

  const preconditionPaths = [...new Set([useCase, ...tests, module.manifest])];
  const preconditions = await repositoryPreconditions(root, preconditionPaths, { requireClean: options.allowDirty ? false : true, captureDirty: Boolean(options.allowDirty) });
  const conflicts = [];
  if (characterization === "waive" && !options.characterizationReason) conflicts.push("Characterization was waived without --characterization-reason");
  if (moduleCommands.length === 0) conflicts.push("No module verification commands were detected; configure verification before semantic execution");
  const maxFiles = Number(options.maxFiles ?? 12);
  const maxDiffLines = Number(options.maxDiffLines ?? 600);
  return createPlan({
    command: "align",
    root,
    scope: { workspaceFingerprint: workspace.fingerprint, modules: [module.id], paths: allowedPaths, useCase },
    preconditions,
    operations: [],
    commands: [],
    approvals: { network: false, lifecycleScripts: false, semanticChanges: true, riskySkillPermissions: false },
    verification: moduleCommands.map((item) => ({ ...item, cwd: module.path, moduleId: module.id })),
    rollback: { strategy: options.checkpoint ?? "worktree" },
    warnings: assessment.limitations,
    conflicts,
    canApply: conflicts.length === 0,
    nestedPlans: options.nestedPlans ?? [],
    alignment: {
      moduleId: module.id,
      modulePath: module.path,
      project: module.project,
      style,
      recipe: { name: recipe.name, invariants: [...recipe.invariants], antiPatterns: [...recipe.antiPatterns] },
      useCase,
      executor: options.executor ?? "manual",
      review: options.review ?? "requirements-and-quality",
      characterization: { policy: characterization, reason: options.characterizationReason ?? null, existingTests: tests },
      changeBudget: { maxFiles, maxDiffLines },
      allowedPaths,
      effects: effects.map((item) => ({ effect: item.effect, locations: item.locations })),
      tasks,
      assessmentSummary: assessment.summary,
    },
  });
}

export function renderAlignmentTickets(plan) {
  const lines = [
    `# Architecture migration — ${plan.alignment.useCase}`,
    "",
    `- Plan: \`${plan.planId}\``,
    `- Module: \`${plan.alignment.moduleId}\``,
    `- Style: \`${plan.alignment.style}\``,
    `- Maximum files: ${plan.alignment.changeBudget.maxFiles}`,
    `- Maximum diff lines: ${plan.alignment.changeBudget.maxDiffLines}`,
    "",
    "## Non-negotiable invariants",
    "",
    ...plan.alignment.recipe.invariants.map((value) => `- ${value}`),
    "- Do not commit, push, publish, deploy, or start another migration slice automatically.",
    "",
    "## Anti-patterns to reject",
    "",
    ...plan.alignment.recipe.antiPatterns.map((value) => `- ${value}`),
    "",
  ];
  for (const item of plan.alignment.tasks) {
    lines.push(`## ${item.id} — ${item.title}`, "", "### Allowed paths", "", ...item.allowedPaths.map((value) => `- \`${value}\``), "", "### Acceptance criteria", "", ...item.acceptanceCriteria.map((value) => `- ${value}`), "");
  }
  return `${lines.join("\n")}\n`;
}
