import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createProject, readJournal } from "../src/index.js";
import { exists, hashBuffer, hashDirectory } from "../src/fs-utils.js";
import { assetsSkills } from "../src/workspace-artifacts.js";
import { inspectUpgradeWorkspace } from "../src/upgrade/inspect.js";
import { planSkillUpgrade } from "../src/upgrade/skills.js";
import { applyWithVerifier, buildSupportedUpgradePlan } from "./upgrade-internal-harness.js";

async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "workspace-template-upgrade-skills-"));
  const root = path.join(parent, "repo");
  await createProject({
    target: root, project: "javascript", style: "functional-core", tdd: "pragmatic",
    packageManager: "npm", agents: ["codex"], preset: "sol-codex",
    install: false, git: false, bootstrap: false, force: false, dryRun: false, yes: true,
  });
  const packagePath = path.join(root, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) delete packageJson[section];
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  return root;
}

describe("upgrade skill reconciliation", () => {
  it("preserves non-overlapping canonical skill edits through upgrade and projection", async () => {
    const root = await fixture();
    const canonical = path.join(root, ".agentic", "skills", "verify", "SKILL.md");
    await writeFile(canonical, `${await readFile(canonical, "utf8")}\n<!-- repository extension -->\n`);
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(plan.canApply, true, plan.conflicts.join("\n"));
    await applyWithVerifier(plan, async () => ({ ok: true }));
    assert.match(await readFile(canonical, "utf8"), /repository extension/);
    assert.match(await readFile(path.join(root, ".agents", "skills", "verify", "SKILL.md"), "utf8"), /repository extension/);
    const applied = (await readJournal(root, plan.planId))
      .filter((event) => event.event === "operation")
      .map((event) => event.path);
    const payloadIndex = applied.indexOf(".agents/skills/verify/SKILL.md");
    assert.notEqual(payloadIndex, -1);
    assert.equal(applied.indexOf(".agentic/managed-projections.json") > payloadIndex, true);
    assert.equal(applied.indexOf(".agentic/skills.lock.json") > payloadIndex, true);
  });

  it("reports an overlapping three-way merge conflict without writing", async () => {
    const root = await fixture();
    const baseline = path.join(root, ".agentic", "skill-baselines", "verify", "SKILL.md");
    const canonical = path.join(root, ".agentic", "skills", "verify", "SKILL.md");
    const incoming = await readFile(baseline, "utf8");
    const line = incoming.split("\n").find((item) => item.trim() && !item.startsWith("---"));
    await writeFile(baseline, incoming.replace(line, `${line} baseline-old`));
    await writeFile(canonical, incoming.replace(line, `${line} local-change`));
    const before = await readFile(canonical, "utf8");
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(plan.canApply, false);
    assert.match(plan.conflicts.join("\n"), /skill merge conflict/i);
    assert.equal(await readFile(canonical, "utf8"), before);
  });

  it("removes an upstream-deleted skill file from canonical, baseline, and projections", async () => {
    const root = await fixture();
    const relative = path.join("verify", "legacy.md");
    const canonical = path.join(root, ".agentic", "skills", relative);
    const baseline = path.join(root, ".agentic", "skill-baselines", relative);
    const projected = path.join(root, ".agents", "skills", relative);
    const content = "legacy package file\n";
    await writeFile(canonical, content);
    await writeFile(baseline, content);
    await writeFile(projected, content);

    const lockPath = path.join(root, ".agentic", "skills.lock.json");
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    lock.skills.verify.baselineHash = await hashDirectory(path.dirname(baseline));
    lock.skills.verify.installedHash = await hashDirectory(path.dirname(canonical));
    lock.skills.verify.files["legacy.md"] = {
      baselineHash: hashBuffer(Buffer.from(content)),
      installedHash: hashBuffer(Buffer.from(content)),
    };
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const projectionsPath = path.join(root, ".agentic", "managed-projections.json");
    const projections = JSON.parse(await readFile(projectionsPath, "utf8"));
    projections.projections.codex.hash = await hashDirectory(path.join(root, ".agents", "skills"));
    await writeFile(projectionsPath, `${JSON.stringify(projections, null, 2)}\n`);

    const plan = await buildSupportedUpgradePlan(root, { allowSkillRemoval: true, allowNetwork: true });
    assert.equal(plan.canApply, true, plan.conflicts.join("\n"));
    assert.equal(plan.operations.some((item) =>
      item.kind === "delete-upgrade-managed" && item.path === ".agents/skills/verify/legacy.md"), true);
    await applyWithVerifier(plan, async () => ({ ok: true }));
    assert.equal(await exists(canonical), false);
    assert.equal(await exists(baseline), false);
    assert.equal(await exists(projected), false);
  });

  it("rejects incomplete marker keys and unrecorded projection directories", async () => {
    const root = await fixture();
    const canonical = path.join(root, ".agentic", "skills", "verify", "SKILL.md");
    await writeFile(canonical, `${await readFile(canonical, "utf8")}\n<!-- local extension -->\n`);
    await applyWithVerifier(await buildSupportedUpgradePlan(root, { allowNetwork: true }), async () => ({ ok: true }));
    const markerPath = path.join(root, ".agents", "skills", ".managed-by-workspace-template.json");
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    delete marker.skillHashes.verify;
    await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
    const missingKey = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(missingKey.canApply, false);
    assert.match(missingKey.conflicts.join("\n"), /projection (drift|catalog mismatch)/i);

    marker.skillHashes.verify = (JSON.parse(await readFile(
      path.join(root, ".agentic", "skills.lock.json"),
      "utf8",
    ))).skills.verify.installedHash;
    await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
    const manifestPath = path.join(root, ".agentic", "managed-projections.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const originalManifest = structuredClone(manifest);
    manifest.projections.codex.skills = manifest.projections.codex.skills.filter((name) => name !== "verify");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const manifestMismatch = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(manifestMismatch.canApply, false);
    assert.match(manifestMismatch.conflicts.join("\n"), /projection (drift|catalog mismatch)/i);
    delete originalManifest.skillHashes;
    await writeFile(manifestPath, `${JSON.stringify(originalManifest, null, 2)}\n`);
    const missingGlobalHashes = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(missingGlobalHashes.canApply, false);
    assert.match(missingGlobalHashes.conflicts.join("\n"), /projection (drift|catalog mismatch)/i);
    originalManifest.skillHashes = Object.fromEntries(
      Object.entries(JSON.parse(await readFile(
        path.join(root, ".agentic", "skills.lock.json"),
        "utf8",
      )).skills).map(([name, record]) => [name, record.installedHash]),
    );
    await writeFile(manifestPath, `${JSON.stringify(originalManifest, null, 2)}\n`);
    await mkdir(path.join(root, ".agents", "skills", "unrecorded"), { recursive: true });
    await writeFile(path.join(root, ".agents", "skills", "unrecorded", "SKILL.md"), "# unmanaged\n");
    const extraDirectory = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(extraDirectory.canApply, false);
    assert.match(extraDirectory.conflicts.join("\n"), /projection (drift|catalog mismatch)/i);
  });

  it("advances a valid hash-keyed projection when the incoming catalog adds a skill", async () => {
    const root = await fixture();
    const canonical = path.join(root, ".agentic", "skills", "verify", "SKILL.md");
    await writeFile(canonical, `${await readFile(canonical, "utf8")}\n<!-- modernize projection marker -->\n`);
    await applyWithVerifier(await buildSupportedUpgradePlan(root, { allowNetwork: true }), async () => ({ ok: true }));

    const incoming = await mkdtemp(path.join(os.tmpdir(), "workspace-template-incoming-skills-"));
    await cp(assetsSkills, incoming, { recursive: true });
    await mkdir(path.join(incoming, "future-skill"), { recursive: true });
    await writeFile(path.join(incoming, "future-skill", "SKILL.md"), `---
name: future-skill
description: Test-only incoming skill.
---

# Future skill
`);
    const result = await planSkillUpgrade(await inspectUpgradeWorkspace(root), {
      incomingSkillsRoot: incoming,
    });
    assert.equal(result.conflicts.some((item) => /projection (drift|catalog mismatch)/i.test(item)), false, result.conflicts.join("\n"));
    assert.equal(result.operations.some((item) =>
      item.path === ".agents/skills/future-skill/SKILL.md" && item.kind === "create-upgrade-managed"), true);
  });

  it("blocks whole-skill removal when the old projected skill has drifted", async () => {
    const root = await fixture();
    const canonical = path.join(root, ".agentic", "skills", "wayfinder", "SKILL.md");
    await writeFile(canonical, `${await readFile(canonical, "utf8")}\n<!-- modernize projection marker -->\n`);
    await applyWithVerifier(await buildSupportedUpgradePlan(root, { allowNetwork: true }), async () => ({ ok: true }));
    const projected = path.join(root, ".agents", "skills", "verify", "SKILL.md");
    await writeFile(projected, `${await readFile(projected, "utf8")}\n<!-- projection drift -->\n`);

    const incoming = await mkdtemp(path.join(os.tmpdir(), "workspace-template-incoming-skills-"));
    await cp(assetsSkills, incoming, { recursive: true });
    await rm(path.join(incoming, "verify"), { recursive: true, force: true });
    const result = await planSkillUpgrade(await inspectUpgradeWorkspace(root), {
      incomingSkillsRoot: incoming,
      allowSkillRemoval: true,
    });
    assert.match(result.conflicts.join("\n"), /projection drift.*verify/i);
  });
});
