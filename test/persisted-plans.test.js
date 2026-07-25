import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import {
  assertPlanApplicable,
  createPlan,
  loadPlan,
  persistPlan,
  repositoryPreconditions,
} from "../src/plans/index.js";
import { temporaryDirectory } from "./helpers.js";

describe("persisted plans", () => {
  it("round-trips the exact normalized plan and preserves command argv", async () => {
    const root = await temporaryDirectory("caw-plan-");
    await writeFile(path.join(root, "evidence.txt"), "before\n");
    const plan = createPlan({
      command: "example",
      subcommand: "apply",
      root,
      scope: { modules: ["core"] },
      preconditions: await repositoryPreconditions(root, ["evidence.txt"]),
      operations: [{ kind: "create", path: "out/result.txt", content: "ok" }],
      commands: [{ executable: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", moduleId: "core" }],
      approvals: { semanticChanges: true },
      metadata: { stable: true },
    });
    const file = path.join(root, "plan.json");
    await persistPlan(file, plan);
    const loaded = await loadPlan(file, { command: "example", subcommand: "apply" });
    assert.deepEqual(loaded, plan);
    assert.equal(loaded.commands[0].executable, process.execPath);
    assert.deepEqual(loaded.commands[0].args, ["-e", "process.exit(0)"]);
    await assertPlanApplicable(loaded);
  });

  it("rejects a plan edited after review", async () => {
    const root = await temporaryDirectory("caw-plan-tamper-");
    const plan = createPlan({ command: "example", root });
    const file = path.join(root, "plan.json");
    await persistPlan(file, plan);
    const document = JSON.parse(await readFile(file, "utf8"));
    document.metadata = { broadened: true };
    await writeFile(file, `${JSON.stringify(document, null, 2)}\n`);
    await assert.rejects(loadPlan(file), /planId does not match|integrity metadata/i);
  });

  it("invalidates an approved plan when a fingerprinted file changes", async () => {
    const root = await temporaryDirectory("caw-plan-stale-");
    await writeFile(path.join(root, "manifest.json"), "{}\n");
    const plan = createPlan({
      command: "example",
      root,
      preconditions: await repositoryPreconditions(root, ["manifest.json"]),
    });
    await writeFile(path.join(root, "manifest.json"), '{"changed":true}\n');
    await assert.rejects(assertPlanApplicable(plan), /fingerprinted path changed: manifest\.json/);
  });

  it("does not let apply-time flags broaden recorded approvals", async () => {
    const root = await temporaryDirectory("caw-plan-approval-");
    const plan = createPlan({ command: "example", root, approvals: { network: false } });
    assert.equal(plan.approvals.network, false);
    assert.equal(plan.approvals.lifecycleScripts, false);
    assert.equal(plan.approvals.semanticChanges, false);
    await assertPlanApplicable(plan, { allowNetwork: true, semanticChanges: true });
    assert.equal(plan.approvals.network, false);
    assert.equal(plan.approvals.semanticChanges, false);
  });
});
