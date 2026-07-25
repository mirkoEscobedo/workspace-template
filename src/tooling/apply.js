import path from "node:path";
import { assertPlanApplicable, assertValidPlan, appendJournal, assertNotApplied, writeReport } from "../plans/index.js";
import { runCommandCaptureAsync } from "../process-utils.js";
import { ensureDirectory, hashBuffer, readJson, writeBytesAtomic } from "../fs-utils.js";
import {
  inspectMutationBoundary,
  mergePackageScripts,
  restoreFiles,
  restoreUnexpectedMutations,
  snapshotFiles,
  snapshotMutationBoundary,
} from "./structured-edit.js";

function executable(item) {
  return item.executable ?? item.command;
}

function commandLabel(item) {
  return [executable(item), ...(item.args ?? [])].join(" ");
}

async function applyScriptOperation(root, operation, proposals) {
  const file = path.resolve(root, operation.path);
  const json = await readJson(file);
  const { value, conflicts, additions, replacements } = mergePackageScripts(json, operation.scripts, operation.policy);
  if (conflicts.length > 0 && operation.policy === "propose") {
    proposals.push({ path: operation.path, kind: "package-scripts", conflicts, additions });
    return { changed: false, proposed: true, conflicts, additions, replacements };
  }
  if (conflicts.length > 0 && operation.policy !== "managed-block" && operation.policy !== "replace") {
    throw new Error(`Package script conflicts in ${operation.path}: ${conflicts.map((item) => item.key).join(", ")}`);
  }
  if (JSON.stringify(json) === JSON.stringify(value)) return { changed: false, conflicts, additions, replacements };
  await writeBytesAtomic(file, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
  return { changed: true, conflicts, additions, replacements };
}


function decodePlannedContent(operation, proposal = false) {
  const raw = proposal ? operation.proposalContent : operation.content;
  const encoding = proposal ? operation.proposalContentEncoding : operation.contentEncoding;
  const expected = proposal ? operation.proposalHash : operation.proposedHash;
  if (!raw) throw new Error(`Missing planned structured config content for ${operation.path}`);
  const content = Buffer.from(raw, encoding ?? "base64");
  if (expected && hashBuffer(content) !== expected) throw new Error(`Structured config content hash mismatch for ${operation.path}`);
  return content;
}

async function applyStructuredConfigOperation(root, operation, proposals) {
  const conflicts = operation.conflicts ?? [];
  if (conflicts.length > 0 && operation.policy === "fail") {
    throw new Error(`Structured config conflicts in ${operation.path}: ${conflicts.map((item) => item.path).join(", ")}`);
  }
  if (conflicts.length > 0 && operation.policy === "propose") {
    const proposal = path.resolve(root, operation.proposalPath);
    await ensureDirectory(path.dirname(proposal));
    await writeBytesAtomic(proposal, decodePlannedContent(operation, true));
    proposals.push({ path: operation.proposalPath, sourcePath: operation.path, kind: "structured-config", conflicts });
    return { changed: false, proposed: true, conflicts, additions: operation.additions ?? [], replacements: [] };
  }
  const target = path.resolve(root, operation.path);
  const content = decodePlannedContent(operation, false);
  await ensureDirectory(path.dirname(target));
  await writeBytesAtomic(target, content);
  return {
    changed: true,
    proposed: false,
    conflicts,
    additions: operation.additions ?? [],
    replacements: operation.replacements ?? [],
  };
}

async function runVerification(plan, runner) {
  const results = [];
  for (const item of plan.verification ?? []) {
    const command = executable(item);
    if (!command) continue;
    const args = item.args ?? [];
    const result = await runner(command, args, {
      cwd: path.resolve(plan.root, item.cwd === "." ? "" : (item.cwd ?? "")),
      timeout: item.timeoutMs ?? 60 * 60 * 1000,
      maxBuffer: item.maxOutputBytes ?? 4 * 1024 * 1024,
    });
    const record = {
      moduleId: item.moduleId ?? item.module,
      executable: command,
      args,
      cwd: item.cwd ?? ".",
      status: result.status,
      signal: result.signal,
      stdout: (result.stdout ?? "").slice(-20_000),
      stderr: (result.stderr ?? "").slice(-20_000),
      error: result.error ? String(result.error.message ?? result.error) : undefined,
    };
    results.push(record);
    if (record.status !== 0 || record.error) break;
  }
  return results;
}

async function validateRequestedDependencies(plan) {
  const errors = [];
  for (const module of plan.tooling?.modules ?? []) {
    if ((module.additions ?? []).length === 0) continue;
    const manifest = path.resolve(
      plan.root,
      module.path === "." ? "" : module.path,
      ["typescript", "javascript", "react"].includes(module.project)
        ? "package.json"
        : module.project === "rust"
          ? "Cargo.toml"
          : "pubspec.yaml",
    );
    let text;
    try {
      text = await import("node:fs/promises").then(({ readFile }) => readFile(manifest, "utf8"));
    } catch {
      errors.push(`${module.id}: expected manifest is missing after tooling apply`);
      continue;
    }
    if (["typescript", "javascript", "react"].includes(module.project)) {
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        errors.push(`${module.id}: package.json is invalid after tooling apply`);
        continue;
      }
      const all = {
        ...(json.dependencies ?? {}),
        ...(json.devDependencies ?? {}),
        ...(json.optionalDependencies ?? {}),
        ...(json.peerDependencies ?? {}),
      };
      for (const dependency of module.additions) {
        if (!Object.hasOwn(all, dependency.name)) errors.push(`${module.id}: package manager did not add ${dependency.name}`);
      }
    } else {
      for (const dependency of module.additions) {
        const escaped = dependency.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (!new RegExp(`^\\s*${escaped}\\s*[:=]`, "m").test(text)) errors.push(`${module.id}: package manager did not add ${dependency.name}`);
      }
    }
  }
  return errors;
}

function approvedMutationPaths(plan) {
  return [
    ...(plan.commands ?? []).flatMap((item) => item.expectedPaths ?? []),
    ...(plan.operations ?? []).flatMap((operation) => [operation.path, operation.proposalPath]).filter(Boolean),
  ];
}

function mutationError(prefix, inspection) {
  return new Error(`${prefix}:\n- ${inspection.unexpected.map((entry) => entry.path).join("\n- ")}`);
}

export async function applyToolingPlan(plan, options = {}) {
  assertValidPlan(plan, { command: "tooling-install" });
  // A successful install changes the plan's manifest/lockfile fingerprints.
  // Journal replay detection must therefore precede stale-plan validation.
  await assertNotApplied(plan.root, plan.planId);
  await assertPlanApplicable(plan, { allowDirty: options.allowDirty, allowedDirtyPaths: options.allowedDirtyPaths });
  if (plan.approvals.network && !options.allowNetwork) {
    throw new Error("This tooling plan requires network access; pass --allow-network to apply the reviewed plan");
  }
  if (plan.approvals.lifecycleScripts && options.lifecycleScripts !== "allow") {
    throw new Error("This tooling plan requires package lifecycle scripts; pass --lifecycle-scripts allow to apply it");
  }
  if (plan.approvals.runtimeDependencies && !options.allowRuntime) {
    throw new Error("This tooling plan contains runtime dependencies; pass --allow-runtime after review");
  }

  const runner = options.runner ?? runCommandCaptureAsync;
  const tracked = plan.rollback?.trackedFiles ?? [];
  const backup = await snapshotFiles(plan.root, tracked);
  const mutationBoundary = await snapshotMutationBoundary(plan.root, approvedMutationPaths(plan), options);
  let mutationInspection = { ok: true, changed: [], unexpected: [] };
  const commandResults = [];
  const operationResults = [];
  const proposals = [];
  await appendJournal(plan.root, plan.planId, { status: "running", event: "start", command: plan.command });

  try {
    for (const item of plan.commands ?? []) {
      const command = executable(item);
      await appendJournal(plan.root, plan.planId, { event: "command-start", moduleId: item.moduleId, command: commandLabel(item) });
      const result = await runner(command, item.args ?? [], {
        cwd: path.resolve(plan.root, item.cwd === "." ? "" : (item.cwd ?? "")),
        timeout: item.timeoutMs ?? options.timeout ?? 30 * 60 * 1000,
        maxBuffer: item.maxOutputBytes ?? 4 * 1024 * 1024,
        env: { ...(options.env ?? {}), ...(item.env ?? {}) },
      });
      const record = {
        moduleId: item.moduleId,
        executable: command,
        args: item.args ?? [],
        cwd: item.cwd ?? ".",
        status: result.status,
        signal: result.signal,
        stdout: (result.stdout ?? "").slice(-20_000),
        stderr: (result.stderr ?? "").slice(-20_000),
        error: result.error ? String(result.error.message ?? result.error) : undefined,
      };
      commandResults.push(record);
      await appendJournal(plan.root, plan.planId, { event: "command-finish", moduleId: item.moduleId, command: commandLabel(item), statusCode: result.status });
      if (result.error || result.status !== 0) {
        throw new Error(`Tooling command failed: ${commandLabel(item)}\n${record.stderr || record.stdout || record.error || ""}`);
      }
      mutationInspection = await inspectMutationBoundary(mutationBoundary);
      if (!mutationInspection.ok) throw mutationError("Tooling command changed unplanned paths", mutationInspection);
    }

    for (const operation of plan.operations ?? []) {
      if (operation.kind === "merge-package-scripts") {
        operationResults.push({ operation, ...(await applyScriptOperation(plan.root, operation, proposals)) });
      } else if (operation.kind === "merge-structured-config") {
        operationResults.push({ operation, ...(await applyStructuredConfigOperation(plan.root, operation, proposals)) });
      } else throw new Error(`Unsupported tooling operation: ${operation.kind}`);
    }

    const dependencyErrors = await validateRequestedDependencies(plan);
    if (dependencyErrors.length > 0) throw new Error(`Tooling result validation failed:\n- ${dependencyErrors.join("\n- ")}`);

    const verification = options.skipVerification ? [] : await runVerification(plan, runner);
    if (verification.some((item) => item.status !== 0 || item.error)) throw new Error("Tooling verification failed");

    mutationInspection = await inspectMutationBoundary(mutationBoundary);
    if (!mutationInspection.ok) throw mutationError("Tooling transaction changed unplanned paths", mutationInspection);

    const report = {
      version: 1,
      planId: plan.planId,
      command: plan.command,
      status: "completed",
      appliedAt: new Date().toISOString(),
      root: plan.root,
      commandResults,
      operationResults: operationResults.map((item) => ({
        path: item.operation.path,
        kind: item.operation.kind,
        changed: item.changed,
        proposed: item.proposed,
        conflicts: item.conflicts,
        additions: item.additions,
        replacements: item.replacements,
      })),
      proposals,
      changeValidation: {
        changedPaths: mutationInspection.changed.map((entry) => entry.path),
        allowedPaths: mutationBoundary.approved,
        unexpectedPaths: [],
        dependencyErrors,
        ok: true,
      },
      verification,
      rollback: { attempted: false },
      ok: true,
    };
    await writeReport(plan.root, plan.planId, report, "tooling");
    await appendJournal(plan.root, plan.planId, { status: "completed", event: "finish" });
    return report;
  } catch (error) {
    const rollbackFailures = [];
    try {
      mutationInspection = await inspectMutationBoundary(mutationBoundary);
      await restoreUnexpectedMutations(mutationBoundary, mutationInspection);
    } catch (restoreFailure) {
      rollbackFailures.push(restoreFailure);
    }
    if (plan.rollback?.strategy === "restore-tracked-files") {
      try {
        await restoreFiles(plan.root, backup);
      } catch (restoreFailure) {
        rollbackFailures.push(restoreFailure);
      }
    }
    const rollbackError = rollbackFailures.length > 0
      ? new Error(rollbackFailures.map((item) => item.message ?? item).join("; "))
      : undefined;
    const report = {
      version: 1,
      planId: plan.planId,
      command: plan.command,
      status: "failed",
      failedAt: new Date().toISOString(),
      root: plan.root,
      commandResults,
      operationResults,
      proposals,
      changeValidation: {
        changedPaths: (mutationInspection.changed ?? []).map((entry) => entry.path),
        allowedPaths: mutationBoundary.approved,
        unexpectedPaths: (mutationInspection.unexpected ?? []).map((entry) => entry.path),
        ok: false,
      },
      error: String(error.message ?? error),
      rollback: {
        attempted: true,
        ok: !rollbackError,
        error: rollbackError ? String(rollbackError.message ?? rollbackError) : undefined,
        note: "Reviewed manifests, lockfiles, and configuration plus detected unplanned file mutations were restored. Ignored package-manager caches and build outputs may remain and are reported rather than removed blindly.",
      },
      ok: false,
    };
    await writeReport(plan.root, plan.planId, report, "tooling");
    await appendJournal(plan.root, plan.planId, { status: "failed", event: "failed", error: report.error });
    const wrapped = new Error(`${report.error}${rollbackError ? `; rollback also failed: ${rollbackError.message}` : ""}`);
    wrapped.report = report;
    throw wrapped;
  }
}
