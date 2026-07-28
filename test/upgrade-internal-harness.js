import { createUpgradeApplyTestHarness } from "../src/upgrade/apply.js";
import { buildUpgradePlan } from "../src/upgrade/plan.js";

export function applyWithVerifier(plan, verifier, options = {}) {
  return createUpgradeApplyTestHarness({ verifier }).apply(plan, options);
}

export function buildSupportedUpgradePlan(rootDirectory, options = {}) {
  return buildUpgradePlan(rootDirectory, { ...options, platform: "win32" });
}
