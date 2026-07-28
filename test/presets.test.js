import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createProject } from "../src/create.js";
import { doctorProject } from "../src/doctor.js";
import { exists, readJson, writeJson } from "../src/fs-utils.js";
import {
  applyPresetPlan,
  buildPresetPlan,
  listPresets,
  loadBuiltInPresets,
  loadPresetCatalog,
  presetStatus,
  validatePreset,
} from "../src/presets/index.js";

function options(target, preset = undefined) {
  return {
    target,
    project: "javascript",
    style: "simple",
    tdd: "pragmatic",
    packageManager: "npm",
    agents: ["codex", "opencode"],
    preset,
    install: false,
    git: false,
    bootstrap: false,
    force: false,
    dryRun: false,
    yes: true,
    docs: true,
    tickets: true,
  };
}

async function workspace(preset = undefined) {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-template-preset-"));
  await createProject(options(root, preset));
  return root;
}

describe("agent preset catalog and switching", () => {
  it("validates both built-ins with complete fixed-role routing", async () => {
    const presets = await loadBuiltInPresets();
    assert.deepEqual(presets.map((preset) => preset.id), ["sol-codex", "sol-only"]);
    for (const preset of presets) {
      assert.equal(validatePreset(preset, preset.path, { allowLoaderMetadata: true }).version, 1);
    }
    assert.throws(
      () => validatePreset({ version: 1, id: "Bad ID", description: "bad", stability: "stable", models: {}, roles: {} }),
      /kebab-case/,
    );
  });

  it("installs every built-in while selecting sol-only by default", async () => {
    const root = await workspace();
    assert.equal(await exists(path.join(root, ".agentic", "presets", "builtin", "sol-only.json")), true);
    assert.equal(await exists(path.join(root, ".agentic", "presets", "builtin", "sol-codex.json")), true);
    const config = await readJson(path.join(root, ".agentic", "config.json"));
    assert.equal(config.execution.preset.id, "sol-only");
    assert.equal(config.execution.workers.model, "gpt-5.6-sol");
    const listed = await listPresets(root);
    assert.equal(listed.presets.length, 2);
    assert.equal(listed.presets.find((preset) => preset.active)?.id, "sol-only");
  });

  it("selects sol-codex initially without omitting inactive presets", async () => {
    const root = await workspace("sol-codex");
    const config = await readJson(path.join(root, ".agentic", "config.json"));
    assert.equal(config.execution.preset.id, "sol-codex");
    assert.equal(config.execution.workers.model, "gpt-5.3-codex-spark");
    assert.equal(await exists(path.join(root, ".agentic", "presets", "builtin", "sol-only.json")), true);
  });

  it("switches through immutable plans and rejects stale repository state", async () => {
    const root = await workspace();
    const toSplit = await buildPresetPlan(root, { preset: "sol-codex" });
    assert.equal(toSplit.canApply, true);
    assert.equal(toSplit.metadata.previousPreset, "sol-only");
    await applyPresetPlan(toSplit);
    assert.equal((await doctorProject(root)).ok, true);
    assert.deepEqual(await presetStatus(root), {
      root,
      activeId: "sol-codex",
      status: "active",
      fingerprint: toSplit.metadata.preset.fingerprint,
      overrides: [],
      errors: [],
    });
    const backToSol = await buildPresetPlan(root, { preset: "sol-only", allowDirty: true });
    await writeFile(path.join(root, ".agentic", "config.json"), `${await readFile(path.join(root, ".agentic", "config.json"), "utf8")}\n`);
    await assert.rejects(() => applyPresetPlan(backToSol), /preconditions no longer hold|fingerprinted path changed|working tree changed/);
  });

  it("preserves local experiments and rejects duplicate built-in IDs", async () => {
    const root = await workspace();
    const localRoot = path.join(root, ".agentic", "presets", "local");
    await mkdir(localRoot, { recursive: true });
    const base = await readJson(path.join(root, ".agentic", "presets", "builtin", "sol-only.json"));
    const experimental = { ...base, id: "my-experiment", stability: "experimental", description: "Local experiment" };
    await writeJson(path.join(localRoot, "my-experiment.json"), experimental);
    let catalog = await loadPresetCatalog(root);
    assert.deepEqual(catalog.presets.map((preset) => preset.id), ["my-experiment", "sol-codex", "sol-only"]);
    const plan = await buildPresetPlan(root, { preset: "my-experiment" });
    await applyPresetPlan(plan);
    assert.equal((await presetStatus(root)).activeId, "my-experiment");
    assert.equal(await exists(path.join(localRoot, "my-experiment.json")), true);
    await writeJson(path.join(localRoot, "duplicate.json"), { ...base, description: "Illegal shadow" });
    await assert.rejects(() => loadPresetCatalog(root), /Duplicate preset id 'sol-only'/);
  });

  it("preserves drifted root settings and same-name custom agents as partial overrides", async () => {
    const root = await workspace();
    const configPath = path.join(root, ".codex", "config.toml");
    const customConfig = (await readFile(configPath, "utf8"))
      .replace('model = "gpt-5.6-sol"', 'model = "custom-model"')
      .concat('\ncustom_setting = "keep-me"\n');
    await writeFile(configPath, customConfig);
    const plannerPath = path.join(root, ".codex", "agents", "planner.toml");
    await writeFile(plannerPath, `name = "frontier_planner"\ndescription = "custom planner"\ndeveloper_instructions = "keep me"\n`);

    const plan = await buildPresetPlan(root, { preset: "sol-codex", allowDirty: true });
    assert.equal(plan.metadata.preset.status, "partial");
    assert.equal(plan.metadata.preset.roleIds.codex.planner, "wt_frontier_planner");
    assert.equal(plan.metadata.preset.overrides.some((item) => item.pointer === "/model"), true);
    await applyPresetPlan(plan);

    assert.match(await readFile(configPath, "utf8"), /model = "custom-model"/);
    assert.match(await readFile(configPath, "utf8"), /custom_setting = "keep-me"/);
    assert.match(await readFile(plannerPath, "utf8"), /custom planner/);
    assert.equal(await exists(path.join(root, ".codex", "agents", "wt_frontier_planner.toml")), true);
    const status = await presetStatus(root);
    assert.equal(status.status, "partial");
    assert.equal(status.overrides.length > 0, true);
  });
});
