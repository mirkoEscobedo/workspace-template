import { createUpgradeApplyTestHarness } from "../src/upgrade/apply.js";

export function applyWithVerifier(plan, verifier, options = {}) {
  return createUpgradeApplyTestHarness({ verifier }).apply(plan, options);
}
