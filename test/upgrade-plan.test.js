import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createProject } from "../src/create.js";
import { exists, hashDirectory } from "../src/fs-utils.js";
import {
  applyUpgradePlan,
  defaultUpgradePlanPath,
  upgradeWorkspace,
} from "../src/index.js";
import { applyWithVerifier, buildSupportedUpgradePlan } from "./upgrade-internal-harness.js";
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
  it("ignores new ancestors that contain only excluded planned files", async () => {
    const root = await generatedWorkspace();
    const relative = ".agentic/new-managed-area/nested/artifact.json";
    const before = await upgradePlan.sealVerificationInputs(root, [relative]);

    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), "{}\n");
    const after = await upgradePlan.sealVerificationInputs(root, [relative]);

    assert.deepEqual(after, before);
  });

  it("builds a deterministic zero-write plan and an automatic review path", async () => {
    const root = await generatedWorkspace();
    const before = await hashDirectory(root);
    const first = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    const second = await buildSupportedUpgradePlan(root, { allowNetwork: true });

    assert.equal(await hashDirectory(root), before);
    assert.equal(first.command, "upgrade");
    assert.equal(first.planId, second.planId);
    assert.equal(first.metadata.upgrade.mode, "generated");
    assert.equal(first.metadata.upgrade.fromVersion, "0.6.1");
    assert.equal(first.metadata.upgrade.toVersion, "0.6.1");
    assert.equal(first.metadata.upgrade.status, "current");
    assert.equal(first.metadata.upgrade.operationCount, 0);
    assert.match(defaultUpgradePlanPath(first), /^\.agentic\/plans\/upgrades\/upgrade-0\.6\.1-to-0\.6\.1-[a-f0-9]{12}\.json$/);
  });

  it("seals explicit unconfined verification approval in the reviewed plan", async () => {
    const root = await generatedWorkspace();
    const blocked = await buildSupportedUpgradePlan(root);
    assert.equal(blocked.canApply, false);
    assert.equal(blocked.approvals.network, false);
    assert.equal(blocked.conflicts.some((item) => /cannot be portably confined.*--allow-network/iu.test(item)), true);

    const approved = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(approved.canApply, true);
    assert.equal(approved.approvals.network, true);
    assert.match(approved.metadata.verificationInputs.hash, /^[a-f0-9]{64}$/u);
  });

  it("seals a network-approved npm install for dependency-backed checkpoint verification", async () => {
    const root = await generatedWorkspace();
    const sentinel = path.join(root, "dependency-verifier-started");
    const manifestPath = path.join(root, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.devDependencies = { biome: "1.0.0" };
    manifest.scripts.check = `node_modules/.bin/biome check . && node -e "require('node:fs').writeFileSync(${JSON.stringify(sentinel)},'ran')"`;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const blocked = await buildSupportedUpgradePlan(root);
    assert.equal(blocked.canApply, false);
    assert.equal(blocked.conflicts.some((item) => /pass --allow-network/iu.test(item)), true);

    const approved = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    const installs = [...approved.metadata.verificationCommands.modules, approved.metadata.verificationCommands.root]
      .filter(Boolean)
      .map((item) => item.dependencyInstall)
      .filter(Boolean);
    assert.equal(approved.canApply, true);
    assert.deepEqual(installs, [
      { command: "npm", args: ["install", "--ignore-scripts"], cwd: "." },
    ]);
    assert.equal(await exists(sentinel), false);

    const invocations = [];
    const report = await applyWithVerifier(
      approved,
      async () => ({ ok: true }),
      {},
      {
        runner: async (command, args, options) => {
          invocations.push({ command, args, cwd: options.cwd, stepId: options.stepId });
          return { command, args, cwd: options.cwd, status: 0 };
        },
      },
    );
    assert.equal(report.ok, true);
    assert.equal(invocations.length, 2);
    assert.equal(invocations.every((item) =>
      item.command === "npm"
      && item.args.join(" ") === "install --ignore-scripts"
      && path.resolve(item.cwd) !== path.resolve(root)), true);
    assert.deepEqual(report.preVerification.dependencyInstalls.map((item) => item.state), ["passed"]);
    assert.deepEqual(report.postVerification.dependencyInstalls.map((item) => item.state), ["passed"]);
    assert.equal(await exists(path.join(root, "node_modules")), false);
  });

  it("reports the fail-closed POSIX upgrade verification capability conflict", () => {
    assert.match(
      upgradePlan.upgradeVerificationPlatformConflict("linux"),
      /POSIX.*detached-session.*native process owner/iu,
    );
    assert.equal(upgradePlan.upgradeVerificationPlatformConflict("win32"), null);
  });

  it("uses the requested verification platform when sealing plan capability", async () => {
    const root = await generatedWorkspace();
    const posix = await upgradePlan.buildUpgradePlan(root, { allowNetwork: true, platform: "linux" });
    const windows = await upgradePlan.buildUpgradePlan(root, { allowNetwork: true, platform: "win32" });

    assert.equal(posix.canApply, false);
    assert.equal(posix.conflicts.some((item) =>
      /POSIX.*detached-session.*native process owner/iu.test(item)), true);
    assert.equal(windows.canApply, true);
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
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    const report = await applyWithVerifier(plan, async () => ({ ok: true }));

    assert.equal(report.ok, true);
    assert.equal(await exists(path.join(root, ".agentic", "transactions", plan.planId, "plan.json")), true);
    await assert.rejects(() => applyWithVerifier(plan, async () => ({ ok: true })), /already been applied/);
  });

  it("keeps consecutive bare upgrades idempotent while re-verifying current state", async () => {
    const root = await generatedWorkspace();
    const firstPlan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    const first = await applyWithVerifier(firstPlan, async () => ({ ok: true }), { allowCurrentReplay: true });
    const secondPlan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    const second = await applyWithVerifier(secondPlan, async () => ({ ok: true }), { allowCurrentReplay: true });
    assert.equal(first.status, "current");
    assert.equal(second.status, "current");
  });
});
