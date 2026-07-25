import path from "node:path";
import { exists, readJson, writeJson } from "../fs-utils.js";
import { assertValidPlan, createPlanEnvelope } from "./schema.js";
import { verifyPreconditions } from "./fingerprint.js";

export * from "./schema.js";
export * from "./fingerprint.js";
export * from "./journal.js";
export * from "./nested.js";

export async function persistPlan(filePath, plan) {
  const valid = assertValidPlan(plan);
  const absolute = path.resolve(filePath);
  await writeJson(absolute, valid);
  return absolute;
}

export async function loadPlan(filePath, expected = {}) {
  const absolute = path.resolve(filePath);
  if (!(await exists(absolute))) throw new Error(`Plan file does not exist: ${absolute}`);
  return assertValidPlan(await readJson(absolute), expected);
}

export async function assertPlanApplicable(plan, options = {}) {
  assertValidPlan(plan, options.expected ?? {});
  if (!plan.canApply) throw new Error(`Plan contains blocking conflicts: ${(plan.conflicts ?? []).join("; ")}`);
  const errors = await verifyPreconditions(plan, options);
  if (errors.length > 0) throw new Error(`Plan preconditions no longer hold:\n- ${errors.join("\n- ")}`);
  return plan;
}

export const createPlan = createPlanEnvelope;
