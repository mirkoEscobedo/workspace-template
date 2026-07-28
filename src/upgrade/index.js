import path from "node:path";
import { exists } from "../fs-utils.js";
import { loadPlan, persistPlan } from "../plans/index.js";
import { applyUpgradePlan } from "./apply.js";
import { buildUpgradePlan, defaultUpgradePlanPath } from "./plan.js";

export { applyUpgradePlan, buildUpgradePlan, defaultUpgradePlanPath };
export { inspectUpgradeWorkspace } from "./inspect.js";

export async function persistUpgradePlan(filePath, plan) {
  const absolute = path.resolve(filePath);
  const relative = path.relative(plan.root, absolute).replaceAll("\\", "/");
  if (!relative.startsWith("../") && relative.startsWith(".agentic/") && !relative.startsWith(".agentic/plans/upgrades/")) {
    throw new Error(`In-repository upgrade plans must be saved under .agentic/plans/upgrades/: ${absolute}`);
  }
  const collides = plan.operations.some((item) => path.resolve(plan.root, ...item.path.split("/")) === absolute);
  if (collides) throw new Error(`Upgrade plan output collides with a reviewed workspace path: ${absolute}`);
  if (await exists(absolute)) {
    let previous;
    try {
      previous = await loadPlan(absolute, { command: "upgrade" });
    } catch {
      throw new Error(`Refusing to overwrite an existing non-upgrade-plan file: ${absolute}`);
    }
    if (previous.planId !== plan.planId) throw new Error(`Refusing to overwrite a different upgrade plan: ${absolute}`);
    return absolute;
  }
  return persistPlan(absolute, plan);
}

export async function upgradeWorkspace(rootDirectory, options = {}) {
  const plan = options.plan ?? await buildUpgradePlan(rootDirectory, options);
  if (options.dryRun) return { status: "preview", plan };
  if (options.planOut !== undefined) {
    const relative = options.planOut === true ? defaultUpgradePlanPath(plan) : options.planOut;
    const planPath = path.resolve(plan.root, relative);
    await persistUpgradePlan(planPath, plan);
    return {
      status: "planned",
      plan,
      planPath,
      applyCommand: `workspace-template upgrade . --apply-plan ${JSON.stringify(planPath)}`,
    };
  }
  return applyUpgradePlan(plan, { ...options, allowCurrentReplay: true });
}
