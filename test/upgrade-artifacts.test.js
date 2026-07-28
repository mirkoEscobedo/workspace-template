import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createProject } from "../src/index.js";
import { hashBuffer } from "../src/fs-utils.js";
import { inspectManagedBlock } from "../src/managed-sections.js";
import { applyWithVerifier, buildSupportedUpgradePlan } from "./upgrade-internal-harness.js";

async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "workspace-template-upgrade-artifacts-"));
  const root = path.join(parent, "repo");
  await createProject({
    target: root, project: "javascript", style: "functional-core", tdd: "pragmatic",
    packageManager: "npm", agents: ["codex", "opencode"], preset: "sol-codex",
    install: false, git: false, bootstrap: false, force: false, dryRun: false, yes: true,
  });
  const packagePath = path.join(root, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) delete packageJson[section];
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  return root;
}

describe("upgrade artifact reconciliation", () => {
  it("preserves adopted identity, provenance, product files, and local presets", async () => {
    const root = await fixture();
    const configPath = path.join(root, ".agentic", "config.json");
    const profilePath = path.join(root, ".agentic", "profile.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    const profile = JSON.parse(await readFile(profilePath, "utf8"));
    delete config.createdAt;
    config.mode = "adopted";
    config.adoptedAt = "2024-01-02T03:04:05.000Z";
    profile.mode = "adopted";
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
    const productPath = path.join(root, "src", "sentinel.js");
    await writeFile(productPath, "export const sentinel = 42;\n");
    const localPresetPath = path.join(root, ".agentic", "presets", "local", "team.json");
    const localPreset = `${JSON.stringify({
      version: 1,
      id: "team",
      description: "Repository-owned team routing.",
      stability: "experimental",
      models: {
        team: { reasoningEffort: "high", targets: { codex: "gpt-5.6-sol", opencode: "openai/gpt-5.6-sol" } },
      },
      roles: Object.fromEntries([
        "coordinator", "planner", "scout", "implementer", "reviewer-spec", "reviewer-code",
        "reviewer-ops", "repairer", "integrator",
      ].map((role) => [role, "team"])),
    }, null, 2)}\n`;
    await writeFile(localPresetPath, localPreset);

    const plan = await buildSupportedUpgradePlan(root, { allowDirty: true, allowNetwork: true });
    assert.equal(plan.metadata.upgrade.mode, "adopted");
    assert.equal(plan.operations.some((item) => item.path === "src/sentinel.js"), false);
    assert.equal(plan.operations.some((item) => item.path.includes("presets/local/team.json")), false);
    await applyWithVerifier(plan, async () => ({ ok: true }));

    const upgraded = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(upgraded.mode, "adopted");
    assert.equal(upgraded.adoptedAt, "2024-01-02T03:04:05.000Z");
    assert.equal(await readFile(productPath, "utf8"), "export const sentinel = 42;\n");
    assert.equal(await readFile(localPresetPath, "utf8"), localPreset);
  });

  it("blocks drift in a hash-owned managed artifact", async () => {
    const root = await fixture();
    await writeFile(path.join(root, ".agentic", "README.md"), "# user drift\n");
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(plan.canApply, false);
    assert.match(plan.conflicts.join("\n"), /managed file drift/i);
  });

  it("blocks drifted managed role files and honors an explicit preset selection", async () => {
    const root = await fixture();
    const selected = await buildSupportedUpgradePlan(root, { preset: "sol-only", presetExplicit: true, allowNetwork: true });
    assert.equal(selected.metadata.preset.id, "sol-only");
    const rolePath = path.join(root, ".codex", "agents", "scout.toml");
    await writeFile(rolePath, `${await readFile(rolePath, "utf8")}\n# local drift\n`);
    const drifted = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(drifted.canApply, false);
    assert.match(drifted.conflicts.join("\n"), /scout\.toml/);
  });

  it("updates only the managed AGENTS block and preserves adopted ownership", async () => {
    const root = await fixture();
    const agentsPath = path.join(root, "AGENTS.md");
    const configPath = path.join(root, ".agentic", "config.json");
    const profilePath = path.join(root, ".agentic", "profile.json");
    const manifestPath = path.join(root, ".agentic", "managed-files.json");
    const custom = `# Team policy

Keep this repository-specific instruction.

<!-- workspace-template:begin workspace-template version=2 -->
old managed content
<!-- workspace-template:end workspace-template -->
`;
    await writeFile(agentsPath, custom);
    const config = JSON.parse(await readFile(configPath, "utf8"));
    delete config.createdAt;
    config.mode = "adopted";
    config.adoptedAt = null;
    const profile = JSON.parse(await readFile(profilePath, "utf8"));
    profile.mode = "adopted";
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const managedBlock = inspectManagedBlock(custom);
    manifest.files["AGENTS.md"] = {
      mode: "managed-section",
      hash: hashBuffer(Buffer.from(custom)),
      managedBlockHash: hashBuffer(Buffer.from(managedBlock.body)),
    };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(agentsPath, `${custom}\nRepository-owned note added after adoption.\n`);

    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(plan.canApply, true, plan.conflicts.join("\n"));
    await applyWithVerifier(plan, async () => ({ ok: true }));

    const upgraded = await readFile(agentsPath, "utf8");
    assert.match(upgraded, /Keep this repository-specific instruction/);
    assert.match(upgraded, /Repository-owned note added after adoption/);
    assert.match(upgraded, /## Agentic workspace/);
    assert.doesNotMatch(upgraded, /old managed content/);
    const upgradedManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(upgradedManifest.files["AGENTS.md"].mode, "managed-section");
    const drifted = upgraded.replace("## Agentic workspace", "## User-edited managed workspace");
    await writeFile(agentsPath, drifted);
    const blocked = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(blocked.canApply, false);
    assert.match(blocked.conflicts.join("\n"), /AGENTS\.md/);
  });
});
