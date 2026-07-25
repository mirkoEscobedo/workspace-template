import path from "node:path";
import { isPathInside } from "../fs-utils.js";
import { assertValidPlan } from "./schema.js";
import { loadPlan } from "./index.js";

function validateNested(parentPlan, entry, plan, label) {
  const expected = entry.expected ?? (entry.command ? { command: entry.command } : {});
  assertValidPlan(plan, expected);
  if (!isPathInside(parentPlan.root, plan.root)) {
    throw new Error(`Nested plan root escapes approved parent repository: ${label}`);
  }
  if (entry.planId && plan.planId !== entry.planId) throw new Error(`Nested plan ID mismatch for ${label}`);
  for (const approval of entry.requiredApprovals ?? []) {
    if (!plan.approvals?.[approval]) throw new Error(`Nested plan ${label} lacks required approval '${approval}'`);
  }
  return plan;
}

export async function loadNestedPlans(parentPlan, parentPlanPath) {
  assertValidPlan(parentPlan);
  const base = parentPlanPath ? path.dirname(path.resolve(parentPlanPath)) : parentPlan.root;
  const output = [];
  for (let index = 0; index < (parentPlan.nestedPlans ?? []).length; index += 1) {
    const entry = parentPlan.nestedPlans[index];
    if (entry.inline) {
      output.push(validateNested(parentPlan, entry, entry.inline, `inline:${index}`));
      continue;
    }
    if (!entry.path) throw new Error("Nested plan entry must contain path or inline");
    const target = path.resolve(base, entry.path);
    if (!isPathInside(parentPlan.root, target) && !isPathInside(base, target)) {
      throw new Error(`Nested plan escapes approved root: ${entry.path}`);
    }
    const plan = await loadPlan(target, entry.expected ?? (entry.command ? { command: entry.command } : {}));
    output.push(validateNested(parentPlan, entry, plan, entry.path));
  }
  return output;
}

export const resolveNestedPlans = loadNestedPlans;
