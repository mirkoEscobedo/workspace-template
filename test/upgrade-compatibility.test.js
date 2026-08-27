import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createProject, doctorProject } from "../src/index.js";
import { hashDirectory } from "../src/fs-utils.js";
import { applyWithVerifier, buildSupportedUpgradePlan } from "./upgrade-internal-harness.js";

async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "workspace-template-upgrade-legacy-"));
  const root = path.join(parent, "repo");
  await createProject({
    target: root, project: "javascript", style: "functional-core", tdd: "pragmatic",
    packageManager: "npm", agents: [], preset: "sol-codex",
    install: false, git: false, bootstrap: false, force: false, dryRun: false, yes: true,
  });
  const packagePath = path.join(root, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) delete packageJson[section];
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  return root;
}

describe("upgrade legacy compatibility", () => {
  it("recovers a missing legacy mode from timestamp property presence, including null", async () => {
    const root = await fixture();
    const configPath = path.join(root, ".agentic", "config.json");
    const profilePath = path.join(root, ".agentic", "profile.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    const profile = JSON.parse(await readFile(profilePath, "utf8"));
    config.version = 1;
    delete config.mode;
    config.createdAt = null;
    profile.version = 1;
    delete profile.mode;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(plan.metadata.upgrade.mode, "generated");
  });

  it("blocks contradictory and ambiguous origin evidence", async () => {
    const root = await fixture();
    const configPath = path.join(root, ".agentic", "config.json");
    const profilePath = path.join(root, ".agentic", "profile.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    const profile = JSON.parse(await readFile(profilePath, "utf8"));
    config.mode = "generated";
    profile.mode = "adopted";
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
    await assert.rejects(() => buildSupportedUpgradePlan(root, { allowNetwork: true }), /modes do not match/i);
  });

  it("applies authentic legacy generations, passes doctor, preserves protected paths, and becomes a no-op", async () => {
    for (const generation of [
      { config: 1, profile: 1, managed: 1, lock: 1 },
      { config: 2, profile: 2, managed: 2, lock: 2 },
      { config: 3, profile: 2, managed: 3, lock: 2 },
    ]) {
      const root = await fixture();
      const files = {
        config: path.join(root, ".agentic", "config.json"),
        profile: path.join(root, ".agentic", "profile.json"),
        managed: path.join(root, ".agentic", "managed-files.json"),
        lock: path.join(root, ".agentic", "skills.lock.json"),
      };
      const values = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, file]) => [
        name, JSON.parse(await readFile(file, "utf8")),
      ])));
      values.config.version = generation.config;
      values.profile.version = generation.profile;
      values.managed.version = generation.managed;
      values.lock.version = generation.lock;
      if (generation.config < 3) {
        delete values.config.mode;
        delete values.config.features;
        delete values.config.execution.preset;
        delete values.config.execution.routing;
        values.config.execution.coordinator = { model: "gpt-5.6-sol", reasoningEffort: "high" };
        values.config.execution.planner = { model: "gpt-5.6-sol", reasoningEffort: "high" };
        values.config.execution.workers = { model: "gpt-5.3-codex", reasoningEffort: "high" };
      }
      if (generation.profile === 1) {
        delete values.profile.mode;
        delete values.profile.testing;
        values.profile.architecture = values.profile.architectureName;
        delete values.profile.execution.preset;
        delete values.profile.execution.routing;
      }
      if (generation.managed < 3) {
        delete values.managed.settings;
        delete values.managed.generatorVersion;
      }
      if (generation.lock === 1) {
        delete values.lock.source.catalogHash;
        for (const record of Object.values(values.lock.skills)) {
          delete record.files;
          delete record.risk;
        }
      }
      for (const name of Object.keys(files)) {
        await writeFile(files[name], `${JSON.stringify(values[name], null, 2)}\n`);
      }
      const productBefore = await readFile(path.join(root, "package.json"));
      const memoryBefore = await hashDirectory(path.join(root, "docs", "agent"));
      const allowLegacyRisk = generation.lock === 1;
      const plan = await buildSupportedUpgradePlan(root, {
        allowNetwork: true,
        allowRiskyToolChanges: allowLegacyRisk,
      });
      assert.deepEqual(plan.metadata.sourceSchemas, {
        config: generation.config,
        profile: generation.profile,
        managedFiles: generation.managed,
        skillsLock: generation.lock,
      });
      assert.equal(plan.approvals.riskySkillPermissions, allowLegacyRisk);
      assert.equal(plan.canApply, true, plan.conflicts.join("\n"));
      await applyWithVerifier(plan, async () => ({ ok: true }));
      assert.equal((await doctorProject(root)).ok, true);
      const upgradedConfig = JSON.parse(await readFile(files.config, "utf8"));
      const upgradedProfile = JSON.parse(await readFile(files.profile, "utf8"));
      assert.equal(upgradedConfig.version, 4);
      assert.equal(upgradedConfig.execution.method, "adaptive");
      assert.equal(upgradedConfig.execution.defaultMode, "direct");
      assert.deepEqual(upgradedConfig.execution.limits, {
        semanticRepairs: 2,
        flakyReruns: 1,
      });
      assert.equal(upgradedProfile.version, 3);
      assert.equal(upgradedProfile.execution.method, "adaptive");
      assert.deepEqual(await readFile(path.join(root, "package.json")), productBefore);
      assert.equal(await hashDirectory(path.join(root, "docs", "agent")), memoryBefore);
      const second = await buildSupportedUpgradePlan(root, {
        allowNetwork: true,
        allowRiskyToolChanges: allowLegacyRisk,
      });
      assert.equal(second.approvals.riskySkillPermissions, allowLegacyRisk);
      assert.equal(
        second.metadata.upgrade.status,
        "current",
        JSON.stringify({
          generation,
          conflicts: second.conflicts,
          operations: second.operations.filter((item) => item.kind !== "noop").map((item) => [item.kind, item.path]),
        }),
      );
      assert.equal(second.metadata.upgrade.operationCount, 0);
    }
  });
});
