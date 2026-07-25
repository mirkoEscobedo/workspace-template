import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { createPlan, loadNestedPlans, persistPlan } from "../src/plans/index.js";
import { temporaryDirectory } from "./helpers.js";

describe("nested plan authority", () => {
  it("loads reviewed child plans without inheriting approvals from the parent", async () => {
    const root = await temporaryDirectory("caw-nested-");
    const child = createPlan({ command: "tooling-install", root, approvals: { network: false } });
    const childPath = path.join(root, ".agentic", "plans", "child.json");
    await persistPlan(childPath, child);
    const parent = createPlan({
      command: "align",
      root,
      approvals: { semanticChanges: true, network: true },
      nestedPlans: [{ path: ".agentic/plans/child.json", command: "tooling-install", planId: child.planId }],
    });
    const loaded = await loadNestedPlans(parent);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].planId, child.planId);
    assert.equal(loaded[0].approvals.network, false);
  });

  it("rejects inline tampering, missing child approvals, and child roots outside the repository", async () => {
    const root = await temporaryDirectory("caw-nested-guard-");
    const child = createPlan({ command: "tooling-install", root });
    const tampered = structuredClone(child);
    tampered.metadata = { broadened: true };
    const tamperedParent = createPlan({ command: "align", root, nestedPlans: [{ inline: tampered }] });
    await assert.rejects(loadNestedPlans(tamperedParent), /planId does not match|integrity/i);

    const approvalParent = createPlan({
      command: "align",
      root,
      nestedPlans: [{ inline: child, requiredApprovals: ["network"] }],
    });
    await assert.rejects(loadNestedPlans(approvalParent), /lacks required approval 'network'/);

    const outside = await temporaryDirectory("caw-nested-outside-");
    const outsideChild = createPlan({ command: "tooling-install", root: outside });
    const outsideParent = createPlan({ command: "align", root, nestedPlans: [{ inline: outsideChild }] });
    await assert.rejects(loadNestedPlans(outsideParent), /root escapes approved parent repository/);
  });
});
