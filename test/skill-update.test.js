import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createProject } from "../src/create.js";
import { copyDirectory, hashDirectory, readJson } from "../src/fs-utils.js";
import { applySkillUpdatePlan } from "../src/skills/update-apply.js";
import { planSkillUpdate } from "../src/skills/update-plan.js";
import { assetsSkills } from "../src/workspace-artifacts.js";
import { temporaryDirectory } from "./helpers.js";

async function generatedProject() {
  const parent = await temporaryDirectory("caw-skills-");
  const root = path.join(parent, "project");
  await createProject({
    target: root,
    project: "typescript",
    style: "functional-core",
    tdd: "pragmatic",
    packageManager: "npm",
    agents: [],
    install: false,
    git: false,
    bootstrap: false,
    force: false,
    dryRun: false,
    yes: true,
  });
  return root;
}

async function incomingCatalog() {
  const root = await temporaryDirectory("caw-incoming-skills-");
  await copyDirectory(assetsSkills, root);
  return root;
}

describe("project-owned skill upgrades", () => {
  it("three-way merges non-overlapping local and incoming edits, then advances the baseline", async () => {
    const root = await generatedProject();
    const incoming = await incomingCatalog();
    const localFile = path.join(root, ".agentic", "skills", "wayfinder", "SKILL.md");
    const incomingFile = path.join(incoming, "wayfinder", "SKILL.md");
    await writeFile(localFile, (await readFile(localFile, "utf8")).replace(
      "Otherwise return to `delivery-loop`; ambiguity, unfamiliar code, or a failed implementation is not sufficient admission.",
      "Otherwise return to `delivery-loop`; ambiguity, unfamiliar code, or a failed implementation is not sufficient admission. Retain this local project convention.",
    ));
    await writeFile(incomingFile, (await readFile(incomingFile, "utf8")).replace(
      "Wayfinder never implements, repairs, approves authority gates, or automatically invokes plan compilation.",
      "Wayfinder never implements, repairs, approves authority gates, or automatically invokes plan compilation. Incoming catalogs must preserve this boundary.",
    ));

    const plan = await planSkillUpdate(root, { incomingRoot: incoming, skills: ["wayfinder"] });
    assert.equal(plan.canApply, true, plan.conflicts.join("\n"));
    const skill = plan.skillUpdate.skills[0];
    assert.equal(skill.conflicts.length, 0);
    assert.equal(skill.changed, true);
    assert.equal(skill.files.find((file) => file.path === "SKILL.md").action, "merged");

    const report = await applySkillUpdatePlan(plan);
    assert.equal(report.ok, true);
    const merged = await readFile(localFile, "utf8");
    assert.match(merged, /Retain this local project convention/);
    assert.match(merged, /Incoming catalogs must preserve this boundary/);
    const baseline = path.join(root, ".agentic", "skill-baselines", "wayfinder");
    assert.equal(await hashDirectory(baseline), await hashDirectory(path.dirname(incomingFile)));
    assert.notEqual(await hashDirectory(baseline), await hashDirectory(path.dirname(localFile)));
    const lock = await readJson(path.join(root, ".agentic", "skills.lock.json"));
    assert.equal(lock.version, 2);
    assert.equal(lock.skills.wayfinder.baselineHash, await hashDirectory(baseline));
    assert.equal(lock.skills.wayfinder.installedHash, await hashDirectory(path.dirname(localFile)));
  });

  it("blocks overlapping local and incoming edits without overwriting local content", async () => {
    const root = await generatedProject();
    const incoming = await incomingCatalog();
    const localFile = path.join(root, ".agentic", "skills", "wayfinder", "SKILL.md");
    const incomingFile = path.join(incoming, "wayfinder", "SKILL.md");
    const original = await readFile(localFile, "utf8");
    await writeFile(localFile, original.replace("# Wayfinder", "# Local Wayfinder"));
    await writeFile(incomingFile, original.replace("# Wayfinder", "# Incoming Wayfinder"));
    const plan = await planSkillUpdate(root, { incomingRoot: incoming, skills: ["wayfinder"] });
    assert.equal(plan.canApply, false);
    assert.match(plan.conflicts.join("\n"), /overlapping local and incoming edits/);
    assert.match(await readFile(localFile, "utf8"), /# Local Wayfinder/);
  });

  it("requires explicit review when incoming skills add executable or shell behavior", async () => {
    const root = await generatedProject();
    const incoming = await incomingCatalog();
    const scripts = path.join(incoming, "wayfinder", "scripts");
    await mkdir(scripts, { recursive: true });
    await writeFile(path.join(scripts, "probe.sh"), "#!/bin/sh\necho probe\n");
    const blocked = await planSkillUpdate(root, { incomingRoot: incoming, skills: ["wayfinder"] });
    assert.equal(blocked.canApply, false);
    assert.match(blocked.conflicts.join("\n"), /risky|executable|tool-permission/i);

    const approved = await planSkillUpdate(root, {
      incomingRoot: incoming,
      skills: ["wayfinder"],
      allowRiskyToolChanges: true,
    });
    assert.equal(approved.canApply, true, approved.conflicts.join("\n"));
    await assert.rejects(applySkillUpdatePlan(approved), /allow-risky-tool-changes/);
    const report = await applySkillUpdatePlan(approved, { allowRiskyToolChanges: true });
    assert.equal(report.ok, true);
  });

  it("applies conflict-free skills only when partial mode was explicitly planned", async () => {
    const root = await generatedProject();
    const incoming = await incomingCatalog();
    const localWayfinder = path.join(root, ".agentic", "skills", "wayfinder", "SKILL.md");
    const incomingWayfinder = path.join(incoming, "wayfinder", "SKILL.md");
    const wayfinderBase = await readFile(localWayfinder, "utf8");
    await writeFile(localWayfinder, wayfinderBase.replace("# Wayfinder", "# Local Wayfinder"));
    await writeFile(incomingWayfinder, wayfinderBase.replace("# Wayfinder", "# Incoming Wayfinder"));

    const incomingTdd = path.join(incoming, "tdd", "SKILL.md");
    await writeFile(incomingTdd, `${await readFile(incomingTdd, "utf8")}\n<!-- incoming tdd clarification -->\n`);
    const plan = await planSkillUpdate(root, {
      incomingRoot: incoming,
      skills: ["wayfinder", "tdd"],
      partial: true,
    });
    assert.equal(plan.canApply, true);
    const report = await applySkillUpdatePlan(plan, { partial: true });
    assert.deepEqual(report.appliedSkills, ["tdd"]);
    assert.deepEqual(report.skippedSkills.map((item) => item.name), ["wayfinder"]);
    assert.match(await readFile(localWayfinder, "utf8"), /# Local Wayfinder/);
    assert.match(await readFile(path.join(root, ".agentic", "skills", "tdd", "SKILL.md"), "utf8"), /incoming tdd clarification/);
  });

  it("invalidates the update when the incoming catalog changes after review", async () => {
    const root = await generatedProject();
    const incoming = await incomingCatalog();
    const incomingFile = path.join(incoming, "wayfinder", "SKILL.md");
    await writeFile(incomingFile, `${await readFile(incomingFile, "utf8")}\n<!-- reviewed incoming -->\n`);
    const plan = await planSkillUpdate(root, { incomingRoot: incoming, skills: ["wayfinder"] });
    await writeFile(incomingFile, `${await readFile(incomingFile, "utf8")}\n<!-- changed after review -->\n`);
    await assert.rejects(applySkillUpdatePlan(plan), /catalog changed after planning/);
  });

  it("stages atomic directory swaps beside the repository instead of using system temp", async () => {
    const root = await generatedProject();
    const incoming = await incomingCatalog();
    const incomingFile = path.join(incoming, "wayfinder", "SKILL.md");
    await writeFile(incomingFile, `${await readFile(incomingFile, "utf8")}\n<!-- same-volume staging -->\n`);
    const plan = await planSkillUpdate(root, { incomingRoot: incoming, skills: ["wayfinder"] });
    const keys = ["TMPDIR", "TMP", "TEMP"];
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    const unavailableSystemTemp = path.join(root, "missing-system-temp");
    for (const key of keys) process.env[key] = unavailableSystemTemp;
    try {
      const report = await applySkillUpdatePlan(plan);
      assert.equal(report.ok, true);
      assert.match(
        await readFile(path.join(root, ".agentic", "skills", "wayfinder", "SKILL.md"), "utf8"),
        /same-volume staging/,
      );
    } finally {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  });

});
