import { cp, rm } from "node:fs/promises";
import path from "node:path";
import {
  appendJournal,
  assertNotApplied,
  assertPlanApplicable,
  assertValidPlan,
  loadNestedPlans,
  writeReport,
} from "../plans/index.js";
import { gitSnapshot } from "../plans/fingerprint.js";
import { createCheckpoint, createFileBackup, disposeBackup, restoreFileBackup } from "../checkpoints/index.js";
import { ensureDirectory, exists, readJson, writeJson, writeText } from "../fs-utils.js";
import { runCommandCaptureAsync } from "../process-utils.js";
import { applyToolingPlan } from "../tooling/apply.js";
import { inspectMutationBoundary, restoreUnexpectedMutations, snapshotMutationBoundary } from "../tooling/structured-edit.js";
import { applyRestructurePlan } from "../restructure/apply.js";
import { renderAlignmentTickets } from "./plan.js";
import { executeTask, parseExecutor, readTaskResult } from "./executor.js";
import { diffTree, snapshotTree, validateAlignmentDiff } from "./guard.js";

async function verify(checkpointRoot, commands, runner) {
  const results = [];
  for (const item of commands) {
    const executable = item.executable ?? item.command;
    const result = await runner(executable, item.args ?? [], {
      cwd: path.resolve(checkpointRoot, !item.cwd || item.cwd === "." ? "" : item.cwd),
      timeout: 60 * 60 * 1000,
    });
    results.push({
      executable,
      args: item.args ?? [],
      cwd: item.cwd,
      status: result.status,
      signal: result.signal,
      stdout: (result.stdout ?? "").slice(-20_000),
      stderr: (result.stderr ?? "").slice(-20_000),
      error: result.error ? String(result.error.message ?? result.error) : undefined,
    });
    if (result.status !== 0 || result.error) break;
  }
  return results;
}

function verificationPassed(results) {
  return results.every((item) => item.status === 0 && !item.error);
}

async function applyCheckpointDiff(plan, checkpointRoot, changedPaths) {
  for (const relative of changedPaths) {
    const source = path.resolve(checkpointRoot, relative);
    const destination = path.resolve(plan.root, relative);
    if (await exists(source)) {
      await ensureDirectory(path.dirname(destination));
      await cp(source, destination, { recursive: true, force: true });
    } else await rm(destination, { recursive: true, force: true });
  }
}

async function executeNestedPlans(parent, options) {
  const nested = await loadNestedPlans(parent);
  const results = [];
  for (const item of nested) {
    if (item.command === "tooling-install") results.push(await applyToolingPlan(item, options));
    else if (item.command === "restructure") results.push(await applyRestructurePlan(item, options));
    else throw new Error(`Unsupported nested alignment plan command: ${item.command}`);
  }
  return results;
}

function normalizePaths(paths) {
  return [...new Set((paths ?? []).map((item) => item.replaceAll("\\", "/").replace(/^\.\//, "")))].sort();
}

function samePaths(left, right) {
  return JSON.stringify(normalizePaths(left)) === JSON.stringify(normalizePaths(right));
}

function taskScopedPlan(plan, task) {
  return {
    ...plan,
    alignment: {
      ...plan.alignment,
      allowedPaths: task.allowedPaths ?? plan.alignment.allowedPaths,
    },
  };
}

function deterministicReviews(plan) {
  if (plan.alignment.review === "none") {
    return { requirements: { status: "skipped" }, quality: { status: "skipped" }, limitation: "Review was explicitly disabled in the approved plan." };
  }
  const quality = {
    status: "passed",
    evidence: ["manifest/lockfile guard passed", "change budget passed", "module verification passed"],
  };
  if (plan.alignment.review === "quality") {
    return { requirements: { status: "skipped" }, quality, limitation: "Built-in quality review is a deterministic guard review." };
  }
  return {
    requirements: {
      status: "passed",
      evidence: ["task acceptance criteria were supplied to the executor", "scope guard passed", "required verification passed"],
    },
    quality,
    limitation: "Built-in reviews are deterministic guard reviews. Configure an independent external reviewer as a separate bounded task when human/model judgment is required.",
  };
}

function reportTaskRecords(plan, currentIndex = 0) {
  return plan.alignment.tasks.map((task, index) => ({
    id: task.id,
    status: index < currentIndex ? "completed" : index === currentIndex ? "awaiting-manual" : "pending",
  }));
}

async function prepareManualTask(plan, migrationRoot, task) {
  const prepared = await executeTask(
    { kind: "manual" },
    task,
    { plan, checkpointRoot: plan.root, migrationRoot },
  );
  return {
    request: path.relative(plan.root, prepared.requestPath).split(path.sep).join("/"),
    result: path.relative(plan.root, prepared.resultPath).split(path.sep).join("/"),
  };
}

async function assertManualIdentity(plan) {
  const rootCondition = plan.preconditions.find((item) => item.kind === "root");
  if (rootCondition && path.resolve(rootCondition.value) !== path.resolve(plan.root)) throw new Error("Alignment repository root changed");
  const expectedHead = plan.preconditions.find((item) => item.kind === "git-head")?.value;
  if (expectedHead !== undefined) {
    const git = await gitSnapshot(plan.root);
    if (!git.repository || git.head !== expectedHead) throw new Error("Git HEAD changed after the manual alignment plan was approved; create a new plan");
  }
}

async function startManualAlignment(plan, migrationRoot, nestedPlans) {
  const initial = await snapshotTree(plan.root);
  await writeJson(path.join(migrationRoot, "baseline-initial.json"), initial);
  await writeJson(path.join(migrationRoot, "baseline-current.json"), initial);
  const first = plan.alignment.tasks[0];
  const paths = await prepareManualTask(plan, migrationRoot, first);
  const tasks = reportTaskRecords(plan, 0);
  tasks[0] = { ...tasks[0], ...paths };
  const report = {
    version: 1,
    planId: plan.planId,
    command: plan.command,
    status: "awaiting-manual",
    createdAt: new Date().toISOString(),
    migrationRoot: path.relative(plan.root, migrationRoot).split(path.sep).join("/"),
    nestedPlans,
    currentTask: first.id,
    currentTaskIndex: 0,
    tasks,
    next: `Complete only ${first.id} in the approved paths, write its structured result file, then run align resume with the same plan.`,
    ok: false,
  };
  await writeReport(plan.root, plan.planId, report, "migrations");
  await appendJournal(plan.root, plan.planId, { status: "awaiting-manual", event: "manual-start", taskId: first.id });
  return report;
}

async function resumeManualAlignment(plan, options = {}) {
  await assertNotApplied(plan.root, plan.planId);
  await assertManualIdentity(plan);
  const migrationRoot = path.join(plan.root, ".agentic", "migrations", plan.planId);
  const reportPath = path.join(plan.root, ".agentic", "reports", "migrations", `${plan.planId}.json`);
  if (!(await exists(reportPath))) throw new Error(`No manual alignment report exists for ${plan.planId}; run align execute first`);
  const report = await readJson(reportPath);
  if (report.status !== "awaiting-manual") throw new Error(`Alignment ${plan.planId} is not awaiting manual work (status: ${report.status})`);
  const currentIndex = Number(report.currentTaskIndex ?? 0);
  const task = plan.alignment.tasks[currentIndex];
  if (!task || task.id !== report.currentTask) throw new Error("Stored manual alignment state does not match the approved task sequence");
  const currentBaselinePath = path.join(migrationRoot, "baseline-current.json");
  const initialBaselinePath = path.join(migrationRoot, "baseline-initial.json");
  const before = await readJson(currentBaselinePath);
  const resultPath = path.join(migrationRoot, `${task.id}.result.json`);
  const runner = options.runner ?? runCommandCaptureAsync;
  try {
    const result = await readTaskResult(resultPath, task);
    const taskDiff = await diffTree(plan.root, before);
    const taskGuard = validateAlignmentDiff(taskDiff, taskScopedPlan(plan, task));
    if (!taskGuard.ok) throw new Error(`Manual alignment scope guard failed for ${task.id}:\n- ${taskGuard.errors.join("\n- ")}`);
    if (!samePaths(result.changedPaths, taskGuard.changedPaths)) {
      throw new Error(`Manual result changedPaths do not match the filesystem diff for ${task.id}. Claimed: ${normalizePaths(result.changedPaths).join(", ") || "none"}; actual: ${normalizePaths(taskGuard.changedPaths).join(", ") || "none"}`);
    }
    const verification = await verify(plan.root, task.requiredCommands ?? plan.verification, runner);
    if (!verificationPassed(verification)) throw new Error(`Verification failed for manual task ${task.id}`);
    report.tasks[currentIndex] = {
      ...report.tasks[currentIndex],
      status: "completed",
      completedAt: new Date().toISOString(),
      changedPaths: taskGuard.changedPaths,
      diffLines: taskGuard.diffLines,
      verification,
      result,
    };
    await appendJournal(plan.root, plan.planId, { event: "manual-task-completed", taskId: task.id, changedPaths: taskGuard.changedPaths });

    const nextIndex = currentIndex + 1;
    if (nextIndex < plan.alignment.tasks.length) {
      const nextTask = plan.alignment.tasks[nextIndex];
      await writeJson(currentBaselinePath, await snapshotTree(plan.root));
      const paths = await prepareManualTask(plan, migrationRoot, nextTask);
      report.currentTask = nextTask.id;
      report.currentTaskIndex = nextIndex;
      report.tasks[nextIndex] = { ...report.tasks[nextIndex], status: "awaiting-manual", ...paths };
      report.updatedAt = new Date().toISOString();
      report.lastFailure = null;
      report.next = `Complete only ${nextTask.id}, write its structured result file, then run align resume again.`;
      await writeReport(plan.root, plan.planId, report, "migrations");
      return report;
    }

    const initial = await readJson(initialBaselinePath);
    const finalDiff = await diffTree(plan.root, initial);
    const finalGuard = validateAlignmentDiff(finalDiff, plan);
    if (!finalGuard.ok) throw new Error(`Final manual alignment scope guard failed:\n- ${finalGuard.errors.join("\n- ")}`);
    const finalVerification = await verify(plan.root, plan.verification, runner);
    if (!verificationPassed(finalVerification)) throw new Error("Final module verification failed after manual alignment");
    const completed = {
      ...report,
      status: "completed",
      completedAt: new Date().toISOString(),
      currentTask: null,
      currentTaskIndex: null,
      diff: finalGuard,
      verification: { final: finalVerification },
      reviews: deterministicReviews(plan),
      lastFailure: null,
      next: "Stop. Review and commit this one migration slice manually before planning another slice.",
      ok: true,
    };
    await writeReport(plan.root, plan.planId, completed, "migrations");
    await appendJournal(plan.root, plan.planId, { status: "completed", event: "finish" });
    return completed;
  } catch (error) {
    report.lastFailure = { at: new Date().toISOString(), taskId: task.id, error: String(error.message ?? error) };
    report.updatedAt = new Date().toISOString();
    report.next = `Repair ${task.id} within the existing scope, update its structured result, and run align resume again.`;
    await writeReport(plan.root, plan.planId, report, "migrations");
    await appendJournal(plan.root, plan.planId, { event: "manual-validation-failed", taskId: task.id, error: report.lastFailure.error });
    throw error;
  }
}

export async function executeAlignmentPlan(plan, options = {}) {
  assertValidPlan(plan, { command: "align" });
  await assertNotApplied(plan.root, plan.planId);
  await assertPlanApplicable(plan, { allowDirty: options.allowDirty, allowedDirtyPaths: options.allowedDirtyPaths });
  if (!plan.approvals.semanticChanges) throw new Error("Alignment plan does not authorize semantic changes");
  const executor = parseExecutor(options.executor ?? plan.alignment.executor);
  const migrationRoot = path.join(plan.root, ".agentic", "migrations", plan.planId);
  await ensureDirectory(migrationRoot);
  await writeJson(path.join(migrationRoot, "plan.json"), plan);
  await writeText(path.join(migrationRoot, "tickets.md"), renderAlignmentTickets(plan));

  // Nested plans own their own authority and reports. They are applied before
  // the semantic checkpoint so the alignment executor sees their approved
  // post-state rather than an obsolete copy of the repository.
  const nested = await executeNestedPlans(plan, options);
  if (executor.kind === "manual") return startManualAlignment(plan, migrationRoot, nested);

  const checkpoint = await createCheckpoint(plan.root, plan.rollback?.strategy ?? "worktree");
  const runner = options.runner ?? runCommandCaptureAsync;
  const initial = await snapshotTree(checkpoint.root);
  const taskResults = [];
  let targetBackup;
  let mutationBoundary;
  let mutationInspection = { ok: true, unexpected: [] };
  await appendJournal(plan.root, plan.planId, { status: "running", event: "checkpoint", mode: checkpoint.mode, fallbackReason: checkpoint.fallbackReason });
  try {
    const baseline = await verify(checkpoint.root, plan.verification, runner);
    if (!verificationPassed(baseline)) throw new Error("Baseline verification is red; alignment cannot start without an explicitly revised plan");
    for (const task of plan.alignment.tasks) {
      const taskBefore = await snapshotTree(checkpoint.root);
      const result = await executeTask(executor, task, { plan, checkpointRoot: checkpoint.root, migrationRoot }, options);
      taskResults.push({ taskId: task.id, ...result });
      if (result.status !== "completed") throw new Error(`Executor failed task ${task.id}: ${result.stderr || result.error || result.status}`);
      const taskDiff = await diffTree(checkpoint.root, taskBefore);
      const taskGuard = validateAlignmentDiff(taskDiff, taskScopedPlan(plan, task));
      if (!taskGuard.ok) throw new Error(`Alignment scope guard failed after ${task.id}:\n- ${taskGuard.errors.join("\n- ")}`);
      if (!samePaths(result.structuredResult?.changedPaths, taskGuard.changedPaths)) {
        throw new Error(`Executor result changedPaths do not match the filesystem diff after ${task.id}`);
      }
      const verification = await verify(checkpoint.root, task.requiredCommands ?? plan.verification, runner);
      taskResults.at(-1).verification = verification;
      taskResults.at(-1).guard = taskGuard;
      if (!verificationPassed(verification)) throw new Error(`Verification failed after ${task.id}`);
      await appendJournal(plan.root, plan.planId, { event: "task-completed", taskId: task.id, changedPaths: taskGuard.changedPaths });
    }
    const finalDiff = await diffTree(checkpoint.root, initial);
    const guard = validateAlignmentDiff(finalDiff, plan);
    if (!guard.ok) throw new Error(`Final alignment scope guard failed:\n- ${guard.errors.join("\n- ")}`);
    const finalVerification = await verify(checkpoint.root, plan.verification, runner);
    if (!verificationPassed(finalVerification)) throw new Error("Final module verification failed");
    const reviews = deterministicReviews(plan);
    targetBackup = await createFileBackup(plan.root, guard.changedPaths);
    mutationBoundary = await snapshotMutationBoundary(plan.root, guard.changedPaths);
    await applyCheckpointDiff(plan, checkpoint.root, guard.changedPaths);
    const targetVerification = await verify(plan.root, plan.verification, runner);
    if (!verificationPassed(targetVerification)) throw new Error("Verification failed after applying the migration diff to the target worktree");
    mutationInspection = await inspectMutationBoundary(mutationBoundary);
    if (!mutationInspection.ok) {
      await restoreUnexpectedMutations(mutationBoundary, mutationInspection);
      throw new Error(`Alignment verification changed unplanned paths: ${mutationInspection.unexpected.map((item) => item.path).join(", ")}`);
    }
    const report = {
      version: 1,
      planId: plan.planId,
      command: plan.command,
      status: "completed",
      completedAt: new Date().toISOString(),
      checkpoint: checkpoint.mode,
      checkpointFallbackReason: checkpoint.fallbackReason,
      nestedPlans: nested,
      tasks: taskResults,
      diff: guard,
      verification: { checkpoint: finalVerification, target: targetVerification },
      mutationGuard: { approvedPaths: guard.changedPaths, changed: mutationInspection.changed ?? [], unexpected: [] },
      reviews,
      next: "Stop. Review and commit this one migration slice manually before planning another slice.",
      ok: true,
    };
    await writeReport(plan.root, plan.planId, report, "migrations");
    await appendJournal(plan.root, plan.planId, { status: "completed", event: "finish" });
    return report;
  } catch (error) {
    let restoration;
    if (mutationBoundary && mutationInspection?.unexpected?.length) {
      await restoreUnexpectedMutations(mutationBoundary, mutationInspection).catch(() => {});
    }
    if (targetBackup) {
      try {
        await restoreFileBackup(targetBackup);
        restoration = { attempted: true, ok: true };
      } catch (restoreError) {
        restoration = { attempted: true, ok: false, error: String(restoreError.message ?? restoreError) };
      }
    }
    const report = {
      version: 1,
      planId: plan.planId,
      command: plan.command,
      status: "failed",
      failedAt: new Date().toISOString(),
      checkpoint: checkpoint.mode,
      tasks: taskResults,
      error: String(error.message ?? error),
      restoration,
      recovery: `Inspect the retained evidence under .agentic/migrations/${plan.planId}; generate a new plan for any broader scope.`,
      ok: false,
    };
    await writeReport(plan.root, plan.planId, report, "migrations");
    await appendJournal(plan.root, plan.planId, { status: "failed", event: "failed", error: report.error });
    const wrapped = new Error(report.error);
    wrapped.report = report;
    throw wrapped;
  } finally {
    if (targetBackup) await disposeBackup(targetBackup).catch(() => {});
    await checkpoint.cleanup();
  }
}

export async function alignmentStatus(root, planId) {
  const resolved = path.resolve(root);
  const reportFile = path.join(resolved, ".agentic", "reports", "migrations", `${planId}.json`);
  const migrationPlan = path.join(resolved, ".agentic", "migrations", planId, "plan.json");
  const report = (await exists(reportFile)) ? await readJson(reportFile) : undefined;
  const storedPlan = (await exists(migrationPlan)) ? await readJson(migrationPlan) : undefined;
  if (!report && !storedPlan) throw new Error(`No alignment state found for ${planId}`);
  const { readJournal } = await import("../plans/journal.js");
  return { planId, report, plan: storedPlan, journal: await readJournal(resolved, planId) };
}

export async function resumeAlignmentPlan(plan, options = {}) {
  assertValidPlan(plan, { command: "align" });
  const executor = parseExecutor(options.executor ?? plan.alignment.executor);
  if (executor.kind !== "manual") {
    throw new Error("align resume is for a manual executor state. Generate a new plan to change executor authority.");
  }
  return resumeManualAlignment(plan, options);
}
