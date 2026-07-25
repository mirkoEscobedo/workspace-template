import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { buildSkillsLock } from "../src/skills/baseline.js";
import { applySkillUpdatePlan, planSkillUpdate } from "../src/skills/index.js";

const baseSkill = `---\nname: demo\ndescription: Demonstrate a baseline skill.\n---\n# Demo\n\nBase behavior.\n`;

async function skillFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-template-skills-"));
  const canonical = path.join(root, ".agentic", "skills", "demo");
  const baseline = path.join(root, ".agentic", "skill-baselines", "demo");
  const incoming = path.join(root, "incoming", "demo");
  await mkdir(canonical, { recursive: true });
  await mkdir(baseline, { recursive: true });
  await mkdir(incoming, { recursive: true });
  await writeFile(path.join(canonical, "SKILL.md"), baseSkill);
  await writeFile(path.join(baseline, "SKILL.md"), baseSkill);
  await writeFile(path.join(incoming, "SKILL.md"), baseSkill);
  await mkdir(path.join(root, ".agentic"), { recursive: true });
  await writeFile(path.join(root, ".agentic", "config.json"), `${JSON.stringify({ version: 2, agentTargets: [] }, null, 2)}\n`);
  await buildSkillsLock(root, { version: "0.6.0" });
  return { root, incoming: path.join(root, "incoming") };
}

describe("project-owned skill upgrades", () => {
  it("three-way merges local edits while retaining the exact incoming baseline", async () => {
    const { root, incoming } = await skillFixture();
    await writeFile(path.join(root, ".agentic", "skills", "demo", "SKILL.md"), `${baseSkill}\nLocal project note.\n`);
    const incomingText = baseSkill.replace("Base behavior.", "Incoming upstream behavior.");
    await writeFile(path.join(incoming, "demo", "SKILL.md"), incomingText);

    const plan = await planSkillUpdate(root, { incomingRoot: incoming, skills: ["demo"] });
    assert.equal(plan.canApply, true, plan.conflicts.join("\n"));
    const report = await applySkillUpdatePlan(plan);
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));

    const installed = await readFile(path.join(root, ".agentic", "skills", "demo", "SKILL.md"), "utf8");
    const newBaseline = await readFile(path.join(root, ".agentic", "skill-baselines", "demo", "SKILL.md"), "utf8");
    assert.match(installed, /Incoming upstream behavior/);
    assert.match(installed, /Local project note/);
    assert.equal(newBaseline, incomingText);
    assert.doesNotMatch(newBaseline, /Local project note/);
  });

  it("blocks overlapping edits in atomic mode", async () => {
    const { root, incoming } = await skillFixture();
    await writeFile(path.join(root, ".agentic", "skills", "demo", "SKILL.md"), baseSkill.replace("Base behavior.", "Local behavior."));
    await writeFile(path.join(incoming, "demo", "SKILL.md"), baseSkill.replace("Base behavior.", "Incoming behavior."));
    const plan = await planSkillUpdate(root, { incomingRoot: incoming, skills: ["demo"] });
    assert.equal(plan.canApply, false);
    assert.match(plan.conflicts.join("\n"), /overlapping|conflict/i);
  });

  it("requires an explicit risk approval when incoming executable behavior is added", async () => {
    const { root, incoming } = await skillFixture();
    await mkdir(path.join(incoming, "demo", "scripts"), { recursive: true });
    await writeFile(path.join(incoming, "demo", "scripts", "run.js"), "console.log('run');\n");
    const blocked = await planSkillUpdate(root, { incomingRoot: incoming, skills: ["demo"] });
    assert.equal(blocked.canApply, false);
    assert.match(blocked.conflicts.join("\n"), /risky|executable|permission/i);
    const approved = await planSkillUpdate(root, { incomingRoot: incoming, skills: ["demo"], allowRiskyToolChanges: true });
    assert.equal(approved.canApply, true, approved.conflicts.join("\n"));
    assert.equal(approved.approvals.riskySkillPermissions, true);
  });

  it("invalidates an approved update when the incoming catalog changes", async () => {
    const { root, incoming } = await skillFixture();
    const plan = await planSkillUpdate(root, { incomingRoot: incoming, skills: ["demo"] });
    await writeFile(path.join(incoming, "demo", "SKILL.md"), `${baseSkill}\nChanged after review.\n`);
    await assert.rejects(applySkillUpdatePlan(plan), /incoming skill catalog changed after planning/i);
  });

  it("updates conflict-free skills in partial mode while preserving conflicted skills", async () => {
    const { root, incoming } = await skillFixture();
    const secondBase = `---\nname: other\ndescription: Another skill.\n---\n# Other\n\nBase.\n`;
    for (const parent of [
      path.join(root, ".agentic", "skills", "other"),
      path.join(root, ".agentic", "skill-baselines", "other"),
      path.join(incoming, "other"),
    ]) {
      await mkdir(parent, { recursive: true });
      await writeFile(path.join(parent, "SKILL.md"), secondBase);
    }
    await buildSkillsLock(root, { version: "0.6.0" });
    await writeFile(path.join(root, ".agentic", "skills", "demo", "SKILL.md"), baseSkill.replace("Base behavior.", "Local conflict."));
    await writeFile(path.join(incoming, "demo", "SKILL.md"), baseSkill.replace("Base behavior.", "Incoming conflict."));
    await writeFile(path.join(incoming, "other", "SKILL.md"), secondBase.replace("Base.", "Incoming update."));

    const plan = await planSkillUpdate(root, { incomingRoot: incoming, skills: ["demo", "other"], partial: true });
    assert.equal(plan.canApply, true);
    const report = await applySkillUpdatePlan(plan, { partial: true });
    assert.deepEqual(report.appliedSkills, ["other"]);
    assert.deepEqual(report.skippedSkills.map((item) => item.name), ["demo"]);
    assert.match(await readFile(path.join(root, ".agentic", "skills", "demo", "SKILL.md"), "utf8"), /Local conflict/);
    assert.match(await readFile(path.join(root, ".agentic", "skills", "other", "SKILL.md"), "utf8"), /Incoming update/);
  });

  it("requires an explicit removal approval and blocks deletion of a locally edited skill", async () => {
    const { root, incoming } = await skillFixture();
    await import("node:fs/promises").then(({ rm }) => rm(path.join(incoming, "demo"), { recursive: true, force: true }));
    const blocked = await planSkillUpdate(root, { incomingRoot: incoming, skills: ["demo"] });
    assert.equal(blocked.canApply, false);
    assert.match(blocked.conflicts.join("\n"), /allow-skill-removal/);

    const approved = await planSkillUpdate(root, { incomingRoot: incoming, skills: ["demo"], allowSkillRemoval: true });
    assert.equal(approved.canApply, true, approved.conflicts.join("\n"));
    await assert.rejects(applySkillUpdatePlan(approved), /allow-skill-removal/);
    const report = await applySkillUpdatePlan(approved, { allowSkillRemoval: true });
    assert.deepEqual(report.appliedSkills, ["demo"]);
    await assert.rejects(readFile(path.join(root, ".agentic", "skills", "demo", "SKILL.md"), "utf8"), /ENOENT/);

    const second = await skillFixture();
    await writeFile(path.join(second.root, ".agentic", "skills", "demo", "SKILL.md"), `${baseSkill}\nLocal edit.\n`);
    await import("node:fs/promises").then(({ rm }) => rm(path.join(second.incoming, "demo"), { recursive: true, force: true }));
    const conflict = await planSkillUpdate(second.root, { incomingRoot: second.incoming, skills: ["demo"], allowSkillRemoval: true });
    assert.equal(conflict.canApply, false);
    assert.match(conflict.conflicts.join("\n"), /deleted a locally modified file/);
  });

});
