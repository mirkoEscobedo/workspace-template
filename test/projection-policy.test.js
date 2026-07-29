import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { hashDirectory } from "../src/fs-utils.js";
import { buildSkillsLock } from "../src/skills/baseline.js";
import { applySkillUpdatePlan, planSkillUpdate } from "../src/skills/index.js";
import { syncSkills } from "../src/sync.js";

const demoSkill = `---
name: demo
description: Exercise projection policy.
---
# Demo

Canonical behavior.
`;

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function preservedFixture(configOverride = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-template-projection-policy-"));
  await writeJson(path.join(root, ".agentic", "config.json"), {
    version: 2,
    hostBundles: "preserve",
    agentTargets: ["codex", "opencode"],
    ...configOverride,
  });
  await mkdir(path.join(root, ".agentic", "skills", "demo"), { recursive: true });
  await writeFile(path.join(root, ".agentic", "skills", "demo", "SKILL.md"), demoSkill);
  await writeJson(path.join(root, ".agentic", "managed-projections.json"), {
    version: 2,
    generator: "workspace-template",
    generatedAt: null,
    canonical: ".agentic/skills",
    mode: "disabled",
    reason: "product-owned host bundles are preserved",
    agentTargets: ["codex", "opencode"],
    skillNames: ["demo"],
    projections: {},
  });
  await mkdir(path.join(root, ".agents", "skills", "product"), { recursive: true });
  await writeFile(path.join(root, ".agents", "skills", "product", "SKILL.md"), "product codex bundle\n");
  await mkdir(path.join(root, ".opencode", "skills", "product"), { recursive: true });
  await writeFile(path.join(root, ".opencode", "skills", "product", "SKILL.md"), "product opencode bundle\n");
  return root;
}

async function preservedUpdateFixture() {
  const root = await preservedFixture();
  const baselineSkill = path.join(root, ".agentic", "skill-baselines", "demo");
  await mkdir(baselineSkill, { recursive: true });
  await writeFile(path.join(baselineSkill, "SKILL.md"), demoSkill);
  await buildSkillsLock(root, { version: "0.6.0" });

  const incoming = await mkdtemp(path.join(os.tmpdir(), "workspace-template-projection-incoming-"));
  await mkdir(path.join(incoming, "demo"), { recursive: true });
  await writeFile(
    path.join(incoming, "demo", "SKILL.md"),
    demoSkill.replace("Canonical behavior.", "Incoming canonical behavior."),
  );
  return { root, incoming };
}

async function protectedSnapshot(root) {
  return {
    config: await readFile(path.join(root, ".agentic", "config.json")),
    manifest: await readFile(path.join(root, ".agentic", "managed-projections.json")),
    agents: await hashDirectory(path.join(root, ".agents")),
    opencode: await hashDirectory(path.join(root, ".opencode")),
  };
}

async function assertProtectedSnapshot(root, expected) {
  assert.deepEqual(await readFile(path.join(root, ".agentic", "config.json")), expected.config);
  assert.deepEqual(await readFile(path.join(root, ".agentic", "managed-projections.json")), expected.manifest);
  assert.equal(await hashDirectory(path.join(root, ".agents")), expected.agents);
  assert.equal(await hashDirectory(path.join(root, ".opencode")), expected.opencode);
}

async function fileInventory(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await fileInventory(root, absolute));
    else files.push(path.relative(root, absolute).split(path.sep).join("/"));
  }
  return files.sort();
}

async function wholeFixtureSnapshot(root) {
  return {
    hash: await hashDirectory(root),
    files: await fileInventory(root),
  };
}

async function assertWholeFixtureSnapshot(root, expected) {
  assert.equal(await hashDirectory(root), expected.hash);
  assert.deepEqual(await fileInventory(root), expected.files);
}

describe("projection policy", () => {
  it("makes implicit sync a no-op when product host bundles are preserved", async () => {
    const root = await preservedFixture();
    const before = await protectedSnapshot(root);
    const wholeBefore = await wholeFixtureSnapshot(root);

    const result = await syncSkills(root);

    assert.equal(result.mode, "disabled");
    assert.equal(result.status, "no-projection");
    assert.deepEqual(result.projections, {});
    await assertProtectedSnapshot(root, before);
    await assertWholeFixtureSnapshot(root, wholeBefore);
  });

  it("makes implicit sync a no-op when projection mode is disabled", async () => {
    const root = await preservedFixture({
      hostBundles: "managed",
      projections: {
        mode: "disabled",
        reason: "repository projections are externally managed",
        agentTargets: ["codex", "opencode"],
      },
    });
    const before = await protectedSnapshot(root);
    const wholeBefore = await wholeFixtureSnapshot(root);

    const result = await syncSkills(root);

    assert.equal(result.mode, "disabled");
    assert.equal(result.status, "no-projection");
    assert.equal(result.reason, "repository projections are externally managed");
    await assertProtectedSnapshot(root, before);
    await assertWholeFixtureSnapshot(root, wholeBefore);
  });

  it("treats an explicit empty target list as a disabled no-op", async () => {
    const cases = [
      await preservedFixture(),
      await preservedFixture({
        hostBundles: "managed",
        projections: {
          mode: "disabled",
          reason: "repository projections are externally managed",
          agentTargets: ["codex", "opencode"],
        },
      }),
    ];

    for (const root of cases) {
      const before = await wholeFixtureSnapshot(root);

      const result = await syncSkills(root, []);

      assert.equal(result.mode, "disabled");
      assert.equal(result.status, "no-projection");
      await assertWholeFixtureSnapshot(root, before);
    }
  });

  it("rejects explicit targets that cross a disabled projection boundary before writing", async () => {
    const root = await preservedFixture();
    const before = await protectedSnapshot(root);

    await assert.rejects(
      syncSkills(root, ["codex"]),
      /protected.*codex|codex.*protected|projection.*disabled/i,
    );

    await assertProtectedSnapshot(root, before);

    const disabledRoot = await preservedFixture({
      hostBundles: "managed",
      projections: {
        mode: "disabled",
        reason: "repository projections are externally managed",
        agentTargets: ["codex", "opencode"],
      },
    });
    const disabledBefore = await protectedSnapshot(disabledRoot);

    await assert.rejects(
      syncSkills(disabledRoot, ["claude"]),
      /protected.*claude|claude.*protected|projection.*disabled/i,
    );

    await assertProtectedSnapshot(disabledRoot, disabledBefore);
  });

  it("updates canonical skills, baselines, and lock without touching disabled projections", async () => {
    const { root, incoming } = await preservedUpdateFixture();
    const before = await protectedSnapshot(root);
    const lockPath = path.join(root, ".agentic", "skills.lock.json");
    const oldLock = await readFile(lockPath);
    const plan = await planSkillUpdate(root, { incomingRoot: incoming, skills: ["demo"] });

    const report = await applySkillUpdatePlan(plan);

    assert.equal(report.ok, true);
    assert.equal(report.projection.mode, "disabled");
    assert.equal(report.projection.status, "no-projection");
    assert.match(
      await readFile(path.join(root, ".agentic", "skills", "demo", "SKILL.md"), "utf8"),
      /Incoming canonical behavior/,
    );
    assert.match(
      await readFile(path.join(root, ".agentic", "skill-baselines", "demo", "SKILL.md"), "utf8"),
      /Incoming canonical behavior/,
    );
    assert.notDeepEqual(await readFile(lockPath), oldLock);
    await assertProtectedSnapshot(root, before);
  });

  it("continues to repair projections in managed mode", async () => {
    const root = await preservedFixture({ hostBundles: "managed" });
    await syncSkills(root);
    const codexProjection = path.join(root, ".agents", "skills", "demo", "SKILL.md");
    const opencodeProjection = path.join(root, ".opencode", "skills", "demo", "SKILL.md");
    await writeFile(codexProjection, "drifted codex projection\n");
    await writeFile(opencodeProjection, "drifted opencode projection\n");

    const result = await syncSkills(root);

    assert.equal(result.mode, undefined);
    assert.deepEqual(result.agentTargets, ["codex", "opencode"]);
    assert.equal(await readFile(codexProjection, "utf8"), demoSkill);
    assert.equal(await readFile(opencodeProjection, "utf8"), demoSkill);
  });
});
