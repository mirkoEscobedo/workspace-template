import { readFile } from "node:fs/promises";
import path from "node:path";
import { PACKAGE_VERSION } from "./constants.js";
import { assetsRoot } from "./workspace-artifacts.js";
import { buildAdoptionPlan } from "./adoption-plan.js";
import { doctorProject } from "./doctor.js";
import {
  exists,
  hashBuffer,
  hashFile,
  isPathInside,
  toPosixPath,
  writeBytesAtomic,
  writeJson,
} from "./fs-utils.js";
import { inspectRepository } from "./inspection.js";
import { runCommandCapture } from "./process-utils.js";
import { assertValidPlan } from "./plans/schema.js";
import { verifyPreconditions } from "./plans/fingerprint.js";
import { loadPlan, persistPlan } from "./plans/index.js";

function operationKind(operation) {
  return operation.kind ?? operation.action;
}

function operationPriority(operation) {
  if (operation.path === ".agentic/managed-files.json") return 90;
  if (operation.path === ".agentic/skills.lock.json") return 80;
  if (operation.path === ".agentic/config.json") return 70;
  return 10;
}

async function operationContent(operation, sourceAssetsRoot = assetsRoot) {
  let content;
  if (operation.sourceAsset) {
    const source = path.resolve(sourceAssetsRoot, operation.sourceAsset);
    if (!isPathInside(sourceAssetsRoot, source)) throw new Error(`Unsafe source asset path: ${operation.sourceAsset}`);
    content = await readFile(source);
  } else if (Object.hasOwn(operation, "content")) {
    if (operation.contentEncoding && operation.contentEncoding !== "base64") throw new Error(`Unsupported content encoding for ${operation.path}`);
    content = Buffer.from(operation.content, "base64");
  } else {
    throw new Error(`Operation ${operationKind(operation)} ${operation.path} has no content source`);
  }
  const digest = hashBuffer(content);
  if (operation.proposedHash && digest !== operation.proposedHash) throw new Error(`Proposed content hash mismatch for ${operation.path}`);
  return content;
}

async function revalidateOperation(root, operation) {
  const kind = operationKind(operation);
  const destination = path.resolve(root, operation.path);
  if (!isPathInside(root, destination)) throw new Error(`Operation escapes repository root: ${operation.path}`);
  if (["preserve", "noop"].includes(kind)) return;
  if (kind === "conflict") throw new Error(`Blocking conflict: ${operation.reason}`);
  const present = await exists(destination);

  if (["create", "propose"].includes(kind)) {
    if (!present) return;
    const currentHash = await hashFile(destination);
    if (currentHash === operation.proposedHash) return;
    throw new Error(`Planned create target now exists with different content: ${operation.path}`);
  }
  if (["update-managed", "merge-managed-block"].includes(kind)) {
    if (!present) throw new Error(`Planned update target disappeared: ${operation.path}`);
    if ((await hashFile(destination)) !== operation.currentHash) throw new Error(`Planned update target changed after planning: ${operation.path}`);
    return;
  }
  if (kind === "adopt-identical") {
    if (!present || (await hashFile(destination)) !== operation.proposedHash) throw new Error(`Adopt-identical target changed after planning: ${operation.path}`);
    return;
  }
  throw new Error(`Unsupported adoption operation: ${kind}`);
}

async function revalidatePlan(plan, runtime = {}) {
  assertValidPlan(plan, { command: "adopt" });
  if (plan.package.version !== PACKAGE_VERSION) throw new Error(`Plan version ${plan.package.version} does not match ${PACKAGE_VERSION}`);
  const root = path.resolve(plan.root);
  if (!(await exists(root))) throw new Error(`Plan root no longer exists: ${root}`);
  if (!plan.canApply) throw new Error(`Plan contains blocking conflicts: ${(plan.conflicts ?? []).join("; ")}`);
  const allowedDirtyPaths = [];
  if (runtime.planPath && isPathInside(root, runtime.planPath)) allowedDirtyPaths.push(toPosixPath(path.relative(root, runtime.planPath)));
  const errors = await verifyPreconditions(plan, { allowedDirtyPaths });
  if (errors.length > 0) throw new Error(`Adoption plan preconditions no longer hold:\n- ${errors.join("\n- ")}`);
  for (const operation of plan.operations) await revalidateOperation(root, operation);
  return root;
}

function verificationCommands(plan) {
  return (plan.verification ?? [])
    .filter((item) => item.executable)
    .map((item) => ({ command: item.executable, args: item.args ?? [], cwd: item.cwd ?? ".", timeoutMs: item.timeoutMs }));
}

export async function applyAdoptionPlan(plan, runtime = {}) {
  const root = await revalidatePlan(plan, runtime);
  const applied = [];
  const unchanged = [];
  const operations = [...plan.operations].sort((left, right) => operationPriority(left) - operationPriority(right) || left.path.localeCompare(right.path));

  for (const operation of operations) {
    const kind = operationKind(operation);
    if (["preserve", "noop", "adopt-identical"].includes(kind)) {
      unchanged.push({ path: operation.path, action: kind });
      continue;
    }
    if (kind === "conflict") throw new Error(`Blocking conflict reached apply: ${operation.path}: ${operation.reason}`);
    const destination = path.resolve(root, operation.path);
    await writeBytesAtomic(destination, await operationContent(operation, runtime.assetsRoot));
    applied.push({ path: operation.path, action: kind, hash: operation.proposedHash });
  }

  const doctor = await doctorProject(root);
  const requested = Boolean(plan.metadata?.adoptionVerification?.requested);
  const verification = [];
  const commands = verificationCommands(plan);
  if (requested && commands.length === 0) {
    verification.push({ state: "unavailable", status: null, reason: "no safe full verification command was detected" });
  } else if (requested) {
    for (const item of commands) {
      const result = runCommandCapture(item.command, item.args, {
        cwd: path.resolve(root, item.cwd),
        timeout: item.timeoutMs ?? 60 * 60 * 1000,
      });
      verification.push({
        state: result.status === 0 ? "passed" : result.error?.code === "ENOENT" ? "unavailable" : "failed",
        command: item.command,
        args: item.args,
        cwd: item.cwd,
        status: result.status,
        signal: result.signal,
        stdout: result.stdout.slice(-20_000),
        stderr: result.stderr.slice(-20_000),
        error: result.error ? String(result.error.message ?? result.error) : undefined,
      });
      if (result.status !== 0) break;
    }
  }

  const verificationOk = !requested || (verification.length > 0 && verification.every((item) => item.status === 0));
  const report = {
    version: 2,
    generator: "workspace-template",
    generatorVersion: PACKAGE_VERSION,
    planId: plan.planId,
    appliedAt: new Date().toISOString(),
    root,
    selected: plan.selected,
    applied,
    unchanged,
    doctor: { ok: doctor.ok, errors: doctor.errors, warnings: doctor.warnings },
    verification: { requested, ok: verificationOk, results: verification },
    ok: doctor.ok && verificationOk,
  };
  await writeJson(path.join(root, ".agentic", "adoption-report.json"), report);
  return report;
}

export async function adoptProject(options) {
  if (!options.target && !options.applyPlan) throw new Error("Target directory is required");
  let plan;
  let planPath;
  if (options.applyPlan) {
    planPath = path.resolve(options.applyPlan);
    plan = await loadPlan(planPath, { command: "adopt" });
  } else {
    const root = path.resolve(options.target);
    const snapshot = await inspectRepository(root, options);
    plan = await buildAdoptionPlan(snapshot, options);
  }

  if (options.planOut) {
    planPath = await persistPlan(options.planOut, plan);
  }
  if (options.dryRun || options.requestedCommand === "inspect") return { dryRun: true, plan };
  if (!plan.canApply) throw new Error(`Adoption plan has blocking conflicts:\n- ${plan.conflicts.join("\n- ")}`);
  return { dryRun: false, plan, result: await applyAdoptionPlan(plan, { planPath }) };
}
