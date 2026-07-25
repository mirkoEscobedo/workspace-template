import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("public advanced module surface", () => {
  it("imports the package and CLI without unresolved internal exports", async () => {
    const api = await import("../src/index.js");
    await import("../src/cli.js");
    for (const name of [
      "discoverWorkspace",
      "verifyWorkspace",
      "planTooling",
      "applyToolingPlan",
      "planSkillUpdate",
      "applySkillUpdatePlan",
      "planRestructure",
      "applyRestructurePlan",
      "assessArchitecture",
      "planAlignment",
      "executeAlignmentPlan",
    ]) assert.equal(typeof api[name], "function", name);
  });
});
