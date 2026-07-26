import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createProject } from "../src/create.js";
import { exists, hashDirectory } from "../src/fs-utils.js";
import {
  buildUpgradePlan,
  applyUpgradePlan,
  defaultUpgradePlanPath,
  upgradeWorkspace,
} from "../src/index.js";
import { applyWithVerifier } from "./upgrade-internal-harness.js";
import * as upgradePlan from "../src/upgrade/plan.js";

async function generatedWorkspace() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "workspace-template-upgrade-"));
  const root = path.join(parent, "demo");
  await createProject({
    target: root,
    project: "javascript",
    style: "functional-core",
    tdd: "pragmatic",
    packageManager: "npm",
    agents: ["codex", "opencode"],
    preset: "sol-codex",
    install: false,
    git: false,
    bootstrap: false,
    force: false,
    dryRun: false,
    yes: true,
  });
  const manifestPath = path.join(root, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    delete manifest[section];
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return root;
}

describe("workspace upgrade", () => {
  it("builds a deterministic zero-write plan and an automatic review path", async () => {
    const root = await generatedWorkspace();
    const before = await hashDirectory(root);
    const first = await buildUpgradePlan(root, { allowNetwork: true });
    const second = await buildUpgradePlan(root, { allowNetwork: true });

    assert.equal(await hashDirectory(root), before);
    assert.equal(first.command, "upgrade");
    assert.equal(first.planId, second.planId);
    assert.equal(first.metadata.upgrade.mode, "generated");
    assert.equal(first.metadata.upgrade.fromVersion, "0.6.0");
    assert.equal(first.metadata.upgrade.toVersion, "0.6.0");
    assert.equal(first.metadata.upgrade.status, "current");
    assert.equal(first.metadata.upgrade.operationCount, 0);
    assert.match(defaultUpgradePlanPath(first), /^\.agentic\/plans\/upgrades\/upgrade-0\.6\.0-to-0\.6\.0-[a-f0-9]{12}\.json$/);
  });

  it("seals explicit unconfined verification approval in the reviewed plan", async () => {
    const root = await generatedWorkspace();
    const blocked = await buildUpgradePlan(root);
    assert.equal(blocked.canApply, false);
    assert.equal(blocked.approvals.network, false);
    assert.equal(blocked.conflicts.some((item) => /cannot be portably confined.*--allow-network/iu.test(item)), true);

    const approved = await buildUpgradePlan(root, { allowNetwork: true });
    assert.equal(approved.canApply, true);
    assert.equal(approved.approvals.network, true);
    assert.match(approved.metadata.verificationInputs.hash, /^[a-f0-9]{64}$/u);
  });

  it("blocks dependency-backed checkpoint verification before any process starts", async () => {
    const root = await generatedWorkspace();
    const sentinel = path.join(root, "dependency-verifier-started");
    const manifestPath = path.join(root, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.devDependencies = { biome: "1.0.0" };
    manifest.scripts.check = `node_modules/.bin/biome check . && node -e "require('node:fs').writeFileSync(${JSON.stringify(sentinel)},'ran')"`;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const plan = await buildUpgradePlan(root, { allowNetwork: true });

    assert.equal(plan.canApply, false);
    assert.equal(plan.conflicts.some((item) =>
      /dependency-backed verification.*devDependencies.*FBK-002/iu.test(item)), true);
    await assert.rejects(() => applyUpgradePlan(plan), /dependency-backed verification/iu);
    assert.equal(await exists(sentinel), false);
  });

  it("reports the fail-closed POSIX upgrade verification capability conflict", () => {
    assert.match(
      upgradePlan.upgradeVerificationPlatformConflict("linux"),
      /POSIX.*detached-session.*FBK-002/iu,
    );
    assert.equal(upgradePlan.upgradeVerificationPlatformConflict("win32"), null);
  });

  it("persists a reviewed plan without applying it and prints an exact apply path", async () => {
    const root = await generatedWorkspace();
    const configPath = path.join(root, ".agentic", "config.json");
    const before = await readFile(configPath, "utf8");
    const result = await upgradeWorkspace(root, { planOut: true, allowNetwork: true });

    assert.equal(result.status, "planned");
    assert.equal(await exists(result.planPath), true);
    assert.equal(await readFile(configPath, "utf8"), before);
    assert.match(result.applyCommand, /upgrade \. --apply-plan /);
    await assert.rejects(
      () => upgradeWorkspace(root, { planOut: ".agentic/config.json", allowNetwork: true }),
      /collides|overwrite|saved under/i,
    );
  });

  it("applies the exact sealed plan once and retains its transaction copy", async () => {
    const root = await generatedWorkspace();
    const plan = await buildUpgradePlan(root, { allowNetwork: true });
    const report = await applyWithVerifier(plan, async () => ({ ok: true }));

    assert.equal(report.ok, true);
    assert.equal(await exists(path.join(root, ".agentic", "transactions", plan.planId, "plan.json")), true);
    await assert.rejects(() => applyWithVerifier(plan, async () => ({ ok: true })), /already been applied/);
  });

  it("keeps consecutive bare upgrades idempotent while re-verifying current state", async () => {
    const root = await generatedWorkspace();
    const firstPlan = await buildUpgradePlan(root, { allowNetwork: true });
    const first = await applyWithVerifier(firstPlan, async () => ({ ok: true }), { allowCurrentReplay: true });
    const secondPlan = await buildUpgradePlan(root, { allowNetwork: true });
    const second = await applyWithVerifier(secondPlan, async () => ({ ok: true }), { allowCurrentReplay: true });
    assert.equal(first.status, "current");
    assert.equal(second.status, "current");
  });
});
