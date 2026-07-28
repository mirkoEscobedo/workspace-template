import { createUpgradeApplyTestHarness } from "../src/upgrade/apply.js";
import { buildUpgradePlan } from "../src/upgrade/plan.js";

export function applyWithVerifier(plan, verifier, options = {}, dependencies = {}) {
  return createUpgradeApplyTestHarness({ verifier, ...dependencies }).apply(plan, options);
}

export function buildSupportedUpgradePlan(rootDirectory, options = {}) {
  return buildUpgradePlan(rootDirectory, { ...options, platform: "win32" });
}
