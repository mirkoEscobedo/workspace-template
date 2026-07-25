import path from "node:path";
import { exists, hashBuffer, hashFile, isPathInside, writeBytesAtomic, writeJson } from "../fs-utils.js";
import { assertPlanApplicable } from "../plans/index.js";
import { assertValidPlan } from "../plans/schema.js";

function contentFor(operation) {
  if (!Object.hasOwn(operation, "content")) throw new Error(`Preset operation ${operation.kind} ${operation.path} has no content`);
  const content = Buffer.from(operation.content, operation.contentEncoding ?? "base64");
  if (operation.proposedHash && hashBuffer(content) !== operation.proposedHash) throw new Error(`Preset content hash mismatch: ${operation.path}`);
  return content;
}

export async function applyPresetPlan(plan, options = {}) {
  assertValidPlan(plan, { command: "preset", subcommand: "apply" });
  await assertPlanApplicable(plan, { allowedDirtyPaths: options.allowedDirtyPaths });
  const applied = [];
  const unchanged = [];
  for (const operation of plan.operations) {
    const target = path.resolve(plan.root, operation.path);
    if (!isPathInside(plan.root, target)) throw new Error(`Preset operation escapes root: ${operation.path}`);
    if (operation.kind === "noop") {
      unchanged.push(operation.path);
      continue;
    }
    if (!["create-preset-managed", "update-preset-managed"].includes(operation.kind)) {
      throw new Error(`Unsupported preset operation: ${operation.kind}`);
    }
    const present = await exists(target);
    if (operation.kind === "create-preset-managed" && present) {
      if ((await hashFile(target)) === operation.proposedHash) {
        unchanged.push(operation.path);
        continue;
      }
      throw new Error(`Preset create target now exists: ${operation.path}`);
    }
    if (operation.kind === "update-preset-managed") {
      if (!present || await hashFile(target) !== operation.currentHash) throw new Error(`Preset update target changed: ${operation.path}`);
    }
    await writeBytesAtomic(target, contentFor(operation));
    applied.push(operation.path);
  }
  const report = {
    version: 1,
    generator: "workspace-template",
    planId: plan.planId,
    appliedAt: new Date().toISOString(),
    preset: plan.metadata.preset,
    previousPreset: plan.metadata.previousPreset,
    applied,
    unchanged,
    sessionRestartRequired: true,
    ok: true,
  };
  await writeJson(path.join(plan.root, ".agentic", "preset-report.json"), report);
  return report;
}
