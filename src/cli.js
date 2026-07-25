import path from "node:path";
import { adoptProject } from "./adopt.js";
import { parseArgs } from "./args.js";
import {
  ADOPT_STYLES,
  ADOPT_TDD_MODES,
  CONFLICT_MODES,
  CREATE_STYLES,
  CREATE_TDD_MODES,
  PACKAGE_VERSION,
  PROJECTS,
} from "./constants.js";
import { createProject } from "./create.js";
import { doctorProject, printDoctorReport } from "./doctor.js";
import { inspectRepository } from "./inspection.js";
import { fillInteractiveOptions } from "./prompt.js";
import { syncSkills } from "./sync.js";
import { discoverWorkspace } from "./workspace/discover.js";
import { verifyWorkspace } from "./workspace/verify.js";
import { loadPlan, persistPlan } from "./plans/index.js";
import { applyToolingPlan, buildToolingPlan } from "./tooling/index.js";
import { applySkillUpdatePlan, checkSkillUpdates, planSkillUpdate } from "./skills/index.js";
import { applyRestructurePlan, planRestructure } from "./restructure/index.js";
import {
  alignmentStatus,
  executeAlignmentPlan,
  planAlignment,
  renderAlignmentTickets,
  resumeAlignmentPlan,
} from "./align/index.js";

function helpText() {
  return `workspace-template ${PACKAGE_VERSION}

Create or safely retrofit agentic projects with one continuous local Frontier Loop, local plans,
project-owned skills, monorepo verification, explicit tooling transactions,
three-way skill upgrades, parser-aware source restructuring, and bounded
architecture-alignment slices.

Core commands:
  create [directory] --project <type>
  inspect [directory]
  adopt|retrofit [directory]
  sync [directory]
  doctor [directory]
  verify [directory] [--scope all|module|affected|root]

Advanced commands:
  tooling plan [directory] --pack <name> [--plan-out <file>]
  tooling install [directory] --apply-plan <file> [--allow-network]
  skills update [directory] [--check | --plan-out <file> | --apply-plan <file>]
  restructure plan [directory] --module <id> --move <from=>to> [--plan-out <file>]
  restructure apply [directory] --apply-plan <file>
  align plan [directory] --module <id> --use-case <path> [--plan-out <file>]
  align execute [directory] --apply-plan <file> [--executor manual|command:<exe>]
  align status [directory] --plan-id <id>
  align resume [directory] --apply-plan <file>

Projects:
  ${PROJECTS.join(", ")}

Create defaults:
  --style ${CREATE_STYLES.join("|")} (default functional-core)
  --tdd ${CREATE_TDD_MODES.join("|")} (default pragmatic)

Adopt defaults:
  --style ${ADOPT_STYLES.join("|")} (default preserve)
  --tdd ${ADOPT_TDD_MODES.join("|")} (default preserve)
  --conflict ${CONFLICT_MODES.join("|")} (default propose)
  --workspace auto|single|all
  --nested-instructions auto|always|never
  --plan-out <file> / --apply-plan <file>

Shared advanced options:
  --module <id-or-path>       Repeatable module selector
  --plan-out <file>           Persist the exact immutable plan
  --apply-plan <file>         Revalidate and apply that plan, never replan
  --allow-dirty               Accept the fingerprinted dirty state only
  --dry-run                   Render without mutation
  --json                      Machine-readable output
  --timeout <milliseconds>    Bound a verification or executor command

Tooling authority:
  --pack <name> --dependency <name[@version]> --kind development|runtime|build
  --allow-network --allow-runtime --lifecycle-scripts deny|allow
  --scripts propose|managed-block|fail|preserve

Skill update authority:
  --skill <name> --incoming-root <directory> --allow-risky-tool-changes
  --allow-skill-removal --partial

Restructure authority:
  --organization preserve|feature-first|layered|hybrid
  --style preserve|simple|functional-core|clean
  --move <source=>destination> --checkpoint worktree|copy|patch

Alignment authority:
  --use-case <path-or-name> --style simple|functional-core|clean
  --characterization required|allow-existing|waive
  --max-files <n> --max-diff-lines <n> --allowed-path <path>
  --executor manual|command:<executable>

Frontier uses local repository files and one coordinator session; it does not require GitHub issues, webhooks, or a repository watcher.

Default role routing:
  Coordinator/planner: gpt-5.6-sol, high
  All scouts/workers/reviewers/repair/integration: gpt-5.3-codex, high
`;
}

function printCreateResult(result) {
  if (result.dryRun) {
    console.log(`\nDry run for ${result.root}`);
    console.log("\nFiles:");
    for (const file of result.plannedFiles) console.log(`  ${file}`);
    if (result.plannedCommands.length > 0) {
      console.log("\nCommands:");
      for (const command of result.plannedCommands) console.log(`  ${command}`);
    }
    return;
  }
  console.log(`\nCreated ${result.context.project} project at ${result.root}`);
  console.log(`Style: ${result.context.style}; TDD: ${result.context.tdd}`);
  console.log("Execution: local Frontier Loop");
  console.log("Coordinator/planner: gpt-5.6-sol high");
  console.log("Other roles: gpt-5.3-codex high");
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
}

function printInspection(snapshot) {
  console.log(`\nRepository inspection for ${snapshot.root}`);
  console.log(`Project: ${snapshot.project.value ?? "unresolved"} (${snapshot.project.confidence})`);
  console.log(`Package manager/toolchain: ${snapshot.packageManager.value ?? "unresolved"} (${snapshot.packageManager.confidence})`);
  console.log(`Workspace: ${snapshot.workspace?.kind ?? "single"}; modules: ${snapshot.workspace?.modules?.length ?? 1}`);
  console.log(`Git: ${snapshot.git.repository ? (snapshot.git.targetIsRoot ? "repository root" : "nested target") : "not a repository"}${snapshot.git.dirty ? ", dirty" : ""}`);
  console.log(`Ticket tracks: ${snapshot.ticketTracks.length}`);
  for (const blocking of [snapshot.project.blocking, snapshot.packageManager.blocking, ...(snapshot.workspace?.conflicts ?? [])].filter(Boolean)) console.log(`Blocking: ${blocking}`);
  for (const warning of [...(snapshot.project.warnings ?? []), ...(snapshot.packageManager.warnings ?? []), ...(snapshot.git.warnings ?? []), ...(snapshot.workspace?.warnings ?? [])]) console.log(`Warning: ${warning}`);
}

function operationKind(operation) {
  return operation.kind ?? operation.action;
}

function printPlan(plan) {
  console.log(`\n${plan.command}${plan.subcommand ? ` ${plan.subcommand}` : ""} plan ${plan.planId}`);
  console.log(`Root: ${plan.root}`);
  if (Object.keys(plan.scope ?? {}).length > 0) console.log(`Scope: ${JSON.stringify(plan.scope)}`);
  if (plan.operations.length > 0) {
    console.log("\nOperations:");
    for (const operation of plan.operations) console.log(`  ${operationKind(operation)} ${operation.path ?? `${operation.from ?? ""} -> ${operation.to ?? ""}`}`);
  }
  if (plan.commands.length > 0) {
    console.log("\nCommands:");
    for (const command of plan.commands) console.log(`  [${command.cwd}] ${command.executable} ${command.args.join(" ")}`);
  }
  if (plan.warnings.length > 0) {
    console.log("\nWarnings:");
    for (const warning of plan.warnings) console.log(`  - ${warning}`);
  }
  if (plan.conflicts.length > 0) {
    console.log("\nBlocking conflicts:");
    for (const conflict of plan.conflicts) console.log(`  - ${conflict}`);
  }
  console.log(`\nCan apply: ${plan.canApply ? "yes" : "no"}`);
}

function printAdoptionPlan(plan) {
  printPlan(plan);
  console.log("\nApplication source, dependency manifests, lockfiles, README, CI, and deployment files are preserved by adoption.");
}

function printAdoptionResult(execution) {
  if (execution.dryRun) return printAdoptionPlan(execution.plan);
  const report = execution.result;
  console.log(`\nFrontier adoption ${report.ok ? "completed" : "completed with failing gates"} at ${report.root}`);
  console.log(`Applied operations: ${report.applied.length}`);
  console.log(`Structural doctor: ${report.doctor.ok ? "PASS" : "FAIL"}`);
  console.log(`Project verification: ${report.verification.requested ? (report.verification.ok ? "PASS" : "FAIL") : "not requested"}`);
}

async function emit(value, options, human) {
  if (options.json) console.log(JSON.stringify(value, null, 2));
  else if (human) human(value);
  else console.log(JSON.stringify(value, null, 2));
}

async function maybePersist(plan, options) {
  if (options.planOut) await persistPlan(options.planOut, plan);
  return plan;
}

async function loadApplyPlan(options, expected) {
  if (!options.applyPlan) throw new Error(`${expected.command} apply requires --apply-plan <path>`);
  return loadPlan(options.applyPlan, expected);
}

export async function main(argv) {
  const { command, subcommand, options } = parseArgs(argv);
  if (options.version) return console.log(PACKAGE_VERSION);
  if (options.help) return console.log(helpText());

  if (command === "create") {
    const completed = await fillInteractiveOptions(options);
    const result = await createProject(completed);
    return emit(result, options, printCreateResult);
  }

  const root = options.target ?? ".";
  if (command === "inspect") {
    const snapshot = await inspectRepository(root, options);
    return emit(snapshot, options, printInspection);
  }

  if (command === "adopt") {
    const execution = await adoptProject({ ...options, target: options.target ?? (options.applyPlan ? undefined : ".") });
    await emit(execution.dryRun ? execution.plan : execution.result, options, () => printAdoptionResult(execution));
    if (!execution.dryRun && !execution.result.ok) process.exitCode = 1;
    if (execution.dryRun && !execution.plan.canApply) process.exitCode = 1;
    return;
  }

  if (command === "sync") {
    const manifest = await syncSkills(root, options.agentsExplicit ? options.agents : undefined, { dryRun: options.dryRun });
    return emit(manifest, options, (value) => console.log(`Synchronized ${value.skillNames.length} skills to ${value.agentTargets.length} agent target(s).`));
  }

  if (command === "doctor") {
    const report = await doctorProject(root);
    await emit(report, options, printDoctorReport);
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "verify") {
    const workspace = await discoverWorkspace(root, { workspace: options.workspace === "auto" ? "all" : options.workspace, includeRootModule: true });
    if (!workspace.canUse) throw new Error(`Workspace conflicts:\n- ${workspace.conflicts.join("\n- ")}`);
    const report = await verifyWorkspace(path.resolve(root), workspace, options);
    await emit(report, options, (value) => {
      console.log(`Workspace verification: ${value.ok ? "PASS" : "FAIL"}`);
      for (const result of value.results) console.log(`  ${result.state.toUpperCase()} ${result.module} (${result.path})`);
    });
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "tooling") {
    if (subcommand === "plan") {
      const plan = await maybePersist(await buildToolingPlan(root, options), options);
      await emit(plan, options, printPlan);
      if (!plan.canApply) process.exitCode = 1;
      return;
    }
    const plan = await loadApplyPlan(options, { command: "tooling-install" });
    const report = await applyToolingPlan(plan, options);
    return emit(report, options, (value) => console.log(`Tooling transaction ${value.ok ? "completed" : "failed"}: ${value.planId}`));
  }

  if (command === "skills") {
    if (options.check) {
      const report = await checkSkillUpdates(root, options);
      return emit(report, options, (value) => {
        console.log(`Skill update check for ${value.root}`);
        for (const skill of value.skills) console.log(`  ${skill.changed ? "CHANGE" : "CURRENT"} ${skill.name}${skill.conflicts.length ? ` (${skill.conflicts.length} conflicts)` : ""}`);
      });
    }
    if (options.applyPlan) {
      const plan = await loadApplyPlan(options, { command: "skills-update" });
      const report = await applySkillUpdatePlan(plan, options);
      return emit(report, options, (value) => console.log(`Updated ${value.appliedSkills.length} skill(s); skipped ${value.skippedSkills.length}.`));
    }
    const plan = await maybePersist(await planSkillUpdate(root, options), options);
    await emit(plan, options, printPlan);
    if (!plan.canApply) process.exitCode = 1;
    return;
  }

  if (command === "restructure") {
    if (subcommand === "plan") {
      const plan = await maybePersist(await planRestructure(root, options), options);
      await emit(plan, options, printPlan);
      if (!plan.canApply) process.exitCode = 1;
      return;
    }
    const plan = await loadApplyPlan(options, { command: "restructure" });
    const report = await applyRestructurePlan(plan, options);
    return emit(report, options, (value) => console.log(`Restructure ${value.ok ? "completed" : "failed"}: ${value.moves.length} move(s).`));
  }

  if (command === "align") {
    if (subcommand === "plan") {
      const plan = await maybePersist(await planAlignment(root, options), options);
      if (options.planOut) {
        const ticketPath = `${options.planOut.replace(/\.json$/i, "")}.md`;
        const { writeFile } = await import("node:fs/promises");
        await writeFile(ticketPath, renderAlignmentTickets(plan), "utf8");
      }
      await emit(plan, options, printPlan);
      if (!plan.canApply) process.exitCode = 1;
      return;
    }
    if (subcommand === "status") {
      if (!options.planId) throw new Error("align status requires --plan-id <id>");
      const report = await alignmentStatus(path.resolve(root), options.planId);
      return emit(report, options, (value) => console.log(`Alignment ${value.planId}: ${value.report?.status ?? "no report"}`));
    }
    const plan = await loadApplyPlan(options, { command: "align" });
    const report = subcommand === "resume"
      ? await resumeAlignmentPlan(plan, options)
      : await executeAlignmentPlan(plan, options);
    await emit(report, options, (value) => console.log(`Alignment ${value.status}: ${value.planId}`));
    if (!report.ok && report.status !== "awaiting-manual") process.exitCode = 1;
    return;
  }
}
