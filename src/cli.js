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
import {
  applyPresetPlan,
  buildPresetPlan,
  listPresets,
  presetStatus,
} from "./presets/index.js";
import {
  applyUpgradePlan,
  buildUpgradePlan,
  defaultUpgradePlanPath,
  persistUpgradePlan,
} from "./upgrade/index.js";

async function applyUpgradeWithSignalBridge(plan, options = {}) {
  const controller = new AbortController();
  let interruptedBy;
  const interrupt = (signal) => {
    interruptedBy ??= signal;
    controller.abort(new Error(`Upgrade interrupted by ${signal}`));
  };
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  try {
    const report = await applyUpgradePlan(plan, { ...options, signal: controller.signal });
    if (interruptedBy) throw new Error(`Upgrade interrupted by ${interruptedBy} after process cleanup`);
    return report;
  } catch (error) {
    if (interruptedBy) {
      throw new Error(`Upgrade interrupted by ${interruptedBy} after process cleanup: ${error.message}`, { cause: error });
    }
    throw error;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

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
  upgrade [directory] [--allow-network] [--dry-run | --plan-out [file] | --apply-plan <file>]
  sync [directory]
  doctor [directory]
  verify [directory] [--scope all|module|affected|root]
  preset list|status [directory]
  preset plan [directory] --preset <id> --plan-out <file>
  preset apply [directory] --apply-plan <file>

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
  --install | --no-install (default on)
  --bootstrap | --no-bootstrap (default on)
  --git | --no-git (default on)
  --yes: suppresses default networked create actions unless --allow-network is also set

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
  --preset <id>              Select the initial or next active agent preset

Tooling authority:
  --pack <name> --dependency <name[@version]> --kind development|runtime|build
  --allow-network (for tooling install, and create when paired with --yes)
  --allow-runtime
  --lifecycle-scripts deny|allow
  --scripts propose|managed-block|fail|preserve

Upgrade verification authority:
  --allow-network records sealed approval because portable isolation cannot deny external filesystem or network reach
  Dependency-backed JS/TS verification and POSIX detached-session containment are unavailable

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

Default agent preset: sol-only. Every workspace receives the complete built-in
preset catalog; --preset selects which routing is materialized.
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
  console.log(`Active agent preset: ${result.context.preset ?? "sol-only"}`);
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

function quoteArgument(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function printUpgradeResult(value) {
  console.log(`\nWorkspace ${value.status === "current" ? "is already current" : "upgrade completed"} at ${value.root}`);
  console.log(`Transaction plan: ${value.transactionPlan}`);
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

  if (command === "upgrade") {
    if (options.applyPlan) {
      const planPath = path.resolve(options.applyPlan);
      const plan = await loadPlan(planPath, { command: "upgrade" });
      if (options.target && path.resolve(options.target) !== path.resolve(plan.root)) {
        throw new Error(`Upgrade target does not match the sealed plan root: ${plan.root}`);
      }
      const relative = path.relative(plan.root, planPath).replaceAll("\\", "/");
      const allowedDirtyPaths = !relative.startsWith("../") && relative !== ".." ? [relative] : [];
      const report = await applyUpgradeWithSignalBridge(plan, { ...options, allowedDirtyPaths });
      return emit(report, options, printUpgradeResult);
    }
    const plan = await buildUpgradePlan(root, options);
    if (options.dryRun) {
      await emit(plan, options, printPlan);
      if (!plan.canApply) process.exitCode = 1;
      return;
    }
    if (options.planOut !== undefined) {
      const planPath = path.resolve(plan.root, options.planOut === true ? defaultUpgradePlanPath(plan) : options.planOut);
      await persistUpgradePlan(planPath, plan);
      if (options.json) {
        return emit({ status: "planned", planPath, applyCommand: `workspace-template upgrade . --apply-plan ${quoteArgument(planPath)}`, plan }, options);
      }
      printPlan(plan);
      console.log(`\nUpgrade plan saved:\n${planPath}\n\nApply with:\nworkspace-template upgrade . --apply-plan ${quoteArgument(planPath)}`);
      return;
    }
    const report = await applyUpgradeWithSignalBridge(plan, { ...options, allowCurrentReplay: true });
    return emit(report, options, printUpgradeResult);
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

  if (command === "preset") {
    if (subcommand === "list") {
      const report = await listPresets(root);
      return emit(report, options, (value) => {
        console.log(`Agent presets for ${value.root}`);
        for (const preset of value.presets) console.log(`  ${preset.active ? "*" : " "} ${preset.id} [${preset.source}/${preset.stability}] — ${preset.description}`);
      });
    }
    if (subcommand === "status") {
      const report = await presetStatus(root);
      await emit(report, options, (value) => {
        console.log(`Agent preset ${value.activeId ?? "<none>"}: ${value.status.toUpperCase()}`);
        for (const override of value.overrides ?? []) console.log(`  override ${override.path}${override.pointer}: ${override.reason}`);
        for (const error of value.errors ?? []) console.log(`  error: ${error}`);
      });
      if (!["active", "partial"].includes(report.status)) process.exitCode = 1;
      return;
    }
    if (subcommand === "plan") {
      const plan = await maybePersist(await buildPresetPlan(root, options), options);
      await emit(plan, options, printPlan);
      if (!plan.canApply) process.exitCode = 1;
      return;
    }
    const planPath = path.resolve(options.applyPlan ?? "");
    const plan = await loadApplyPlan(options, { command: "preset", subcommand: "apply" });
    const allowedDirtyPaths = planPath && path.dirname(planPath).startsWith(path.resolve(plan.root))
      ? [path.relative(plan.root, planPath).replaceAll("\\", "/")]
      : [];
    const report = await applyPresetPlan(plan, { ...options, allowedDirtyPaths });
    return emit(report, options, (value) => {
      console.log(`Activated agent preset ${value.preset.id}${value.preset.status === "partial" ? " (partial)" : ""}.`);
      console.log("Start a new Codex/OpenCode session so it loads the new project configuration.");
    });
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
