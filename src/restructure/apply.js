import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { appendJournal, assertNotApplied, assertPlanApplicable, assertValidPlan, writeReport } from "../plans/index.js";
import { createCheckpoint } from "../checkpoints/index.js";
import { exists, hashBuffer, writeBytesAtomic } from "../fs-utils.js";
import { runCommandCaptureAsync } from "../process-utils.js";
import {
  inspectMutationBoundary,
  restoreFiles,
  restoreUnexpectedMutations,
  snapshotFiles,
  snapshotMutationBoundary,
} from "../tooling/structured-edit.js";

function decode(operation) {
  const content = Buffer.from(operation.content, operation.contentEncoding ?? "base64");
  if (operation.proposedHash && hashBuffer(content) !== operation.proposedHash) throw new Error(`Content hash mismatch for ${operation.path}`);
  return content;
}

async function applyOperations(root, operations) {
  const results = [];
  // Write destinations/rewrites before deleting sources so same-filesystem renames and
  // dependency references remain available throughout staging.
  for (const operation of operations) {
    if (!["move", "rewrite-reference", "rewrite-config"].includes(operation.kind)) throw new Error(`Unsupported restructure operation: ${operation.kind}`);
    await writeBytesAtomic(path.resolve(root, operation.path), decode(operation));
    results.push({ kind: operation.kind, path: operation.path, sourcePath: operation.sourcePath });
  }
  const destinations = new Set(operations.map((operation) => operation.path));
  for (const operation of operations.filter((item) => item.kind === "move")) {
    if (operation.sourcePath === operation.path || destinations.has(operation.sourcePath)) continue;
    await rm(path.resolve(root, operation.sourcePath), { force: true, recursive: true });
  }
  return results;
}

async function verify(root, commands, runner) {
  const results = [];
  for (const item of commands) {
    const executable = item.executable ?? item.command;
    const result = await runner(executable, item.args ?? [], { cwd: path.resolve(root, item.cwd === "." ? "" : item.cwd), timeout: 60 * 60 * 1000 });
    results.push({ executable, args: item.args ?? [], cwd: item.cwd, status: result.status, signal: result.signal, stdout: (result.stdout ?? "").slice(-20_000), stderr: (result.stderr ?? "").slice(-20_000), error: result.error ? String(result.error.message ?? result.error) : undefined });
    if (result.status !== 0 || result.error) break;
  }
  return results;
}

export async function applyRestructurePlan(plan, options = {}) {
  assertValidPlan(plan, { command: "restructure" });
  await assertNotApplied(plan.root, plan.planId);
  await assertPlanApplicable(plan, { allowDirty: options.allowDirty, allowedDirtyPaths: options.allowedDirtyPaths });
  const affected = [...new Set(plan.operations.flatMap((operation) => [operation.path, operation.sourcePath]).filter(Boolean))];
  const backup = await snapshotFiles(plan.root, affected);
  const checkpoint = await createCheckpoint(plan.root, plan.rollback?.strategy ?? "worktree");
  const runner = options.runner ?? runCommandCaptureAsync;
  let mutationBoundary;
  let mutationInspection = { ok: true, unexpected: [] };
  await appendJournal(plan.root, plan.planId, { status: "running", event: "checkpoint", mode: checkpoint.mode });
  try {
    const stagedOperations = await applyOperations(checkpoint.root, plan.operations);
    const stagedVerification = await verify(checkpoint.root, plan.verification ?? [], runner);
    if (stagedVerification.some((item) => item.status !== 0 || item.error)) throw new Error("Restructure verification failed in checkpoint");
    mutationBoundary = await snapshotMutationBoundary(plan.root, affected);
    const appliedOperations = await applyOperations(plan.root, plan.operations);
    const finalVerification = options.skipFinalVerification ? [] : await verify(plan.root, plan.verification ?? [], runner);
    if (finalVerification.some((item) => item.status !== 0 || item.error)) throw new Error("Restructure verification failed after applying to the target worktree");
    mutationInspection = await inspectMutationBoundary(mutationBoundary);
    if (!mutationInspection.ok) {
      await restoreUnexpectedMutations(mutationBoundary, mutationInspection);
      throw new Error(`Restructure verification changed unplanned paths: ${mutationInspection.unexpected.map((item) => item.path).join(", ")}`);
    }
    const report = {
      version: 1,
      planId: plan.planId,
      command: plan.command,
      status: "completed",
      appliedAt: new Date().toISOString(),
      checkpoint: checkpoint.mode,
      moves: plan.restructure.moves,
      stagedOperations,
      appliedOperations,
      verification: { staged: stagedVerification, final: finalVerification },
      mutationGuard: { approvedPaths: affected.sort(), changed: mutationInspection.changed ?? [], unexpected: [] },
      warnings: plan.warnings,
      ok: true,
    };
    await writeReport(plan.root, plan.planId, report, "restructures");
    await appendJournal(plan.root, plan.planId, { status: "completed", event: "finish" });
    return report;
  } catch (error) {
    if (mutationBoundary && mutationInspection?.unexpected?.length) {
      await restoreUnexpectedMutations(mutationBoundary, mutationInspection).catch(() => {});
    }
    await restoreFiles(plan.root, backup).catch(() => {});
    const report = { version: 1, planId: plan.planId, command: plan.command, status: "failed", failedAt: new Date().toISOString(), checkpoint: checkpoint.mode, error: String(error.message ?? error), ok: false };
    await writeReport(plan.root, plan.planId, report, "restructures");
    await appendJournal(plan.root, plan.planId, { status: "failed", event: "failed", error: report.error });
    const wrapped = new Error(report.error);
    wrapped.report = report;
    throw wrapped;
  } finally {
    await checkpoint.cleanup();
  }
}
