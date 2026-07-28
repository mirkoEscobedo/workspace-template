import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadBuiltInPresets, resolvePreset } from "../src/presets/catalog.js";
import { PREFERRED_ROLE_IDS, renderCodexArtifacts, renderOpenCodeArtifacts } from "../src/presets/render.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("Frontier harness preset rendering", () => {
  it("keeps source harness templates model-neutral", async () => {
    const codex = await readFile(path.join(root, "assets", "configs", "codex", "config.toml"), "utf8");
    assert.match(codex, /^model = "preset-rendered"/m);
    assert.match(codex, /^default_subagent_model = "preset-rendered"/m);
    const opencode = JSON.parse(await readFile(path.join(root, "assets", "configs", "opencode", "opencode.json"), "utf8"));
    for (const agent of Object.values(opencode.agent)) assert.equal(agent.model, "preset-rendered");
  });

  it("renders sol-only and sol-codex consistently for Codex and OpenCode", async () => {
    const presets = await loadBuiltInPresets();
    for (const preset of presets) {
      const resolved = resolvePreset(preset, ["codex", "opencode"]);
      const roleIds = structuredClone(PREFERRED_ROLE_IDS);
      const codex = await renderCodexArtifacts(resolved, roleIds);
      const config = codex.find((item) => item.path === ".codex/config.toml").content.toString("utf8");
      assert.match(config, new RegExp(`model = "${resolved.roles.coordinator.targets.codex}"`));
      assert.match(config, new RegExp(`default_subagent_model = "${resolved.roles.implementer.targets.codex}"`));
      const opencode = await renderOpenCodeArtifacts(resolved, roleIds);
      const document = JSON.parse(opencode.find((item) => item.path === "opencode.json").content.toString("utf8"));
      for (const [role, route] of Object.entries(resolved.roles)) {
        assert.equal(document.agent[roleIds.opencode[role]].model, route.targets.opencode);
        assert.equal(document.agent[roleIds.opencode[role]].reasoningEffort, route.reasoningEffort);
      }
    }
  });

  it("uses the OpenCode Spark model for sol-codex workers", async () => {
    const preset = (await loadBuiltInPresets()).find((item) => item.id === "sol-codex");
    const resolved = resolvePreset(preset, ["codex", "opencode"]);
    const roleIds = structuredClone(PREFERRED_ROLE_IDS);
    const codex = await renderCodexArtifacts(resolved, roleIds);
    const codexConfig = codex.find((item) => item.path === ".codex/config.toml").content.toString("utf8");
    assert.match(codexConfig, /^default_subagent_model = "gpt-5\.3-codex"$/m);

    const opencode = await renderOpenCodeArtifacts(resolved, roleIds);
    const document = JSON.parse(opencode.find((item) => item.path === "opencode.json").content.toString("utf8"));
    assert.equal(
      document.agent[roleIds.opencode.implementer].model,
      "openai/gpt-5.3-codex-spark",
    );
  });
});
