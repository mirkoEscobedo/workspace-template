import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("Frontier harness defaults", () => {
  it("uses Sol high only for the coordinator/planner and Codex 5.3 high for all other Codex roles", async () => {
    const global = await readFile(path.join(root, "assets", "configs", "codex", "config.toml"), "utf8");
    assert.match(global, /^model = "gpt-5\.6-sol"/m);
    assert.match(global, /^model_reasoning_effort = "high"/m);
    assert.match(global, /^default_subagent_model = "gpt-5\.3-codex"/m);
    assert.match(global, /^default_subagent_reasoning_effort = "high"/m);
    assert.match(global, /^max_concurrent_threads_per_session = 3/m);

    const roles = [
      "scout.toml",
      "implementer.toml",
      "reviewer-spec.toml",
      "reviewer-code.toml",
      "reviewer-ops.toml",
      "repairer.toml",
      "integrator.toml",
    ];
    for (const role of roles) {
      const content = await readFile(path.join(root, "assets", "configs", "codex", "agents", role), "utf8");
      assert.match(content, /^model = "gpt-5\.3-codex"/m, role);
      assert.match(content, /^model_reasoning_effort = "high"/m, role);
    }
    const planner = await readFile(path.join(root, "assets", "configs", "codex", "agents", "planner.toml"), "utf8");
    assert.match(planner, /^model = "gpt-5\.6-sol"/m);
  });

  it("contains the same role split in OpenCode", async () => {
    const config = JSON.parse(await readFile(path.join(root, "assets", "configs", "opencode", "opencode.json"), "utf8"));
    assert.equal(config.agent["frontier-orchestrator"].model, "openai/gpt-5.6-sol");
    assert.equal(config.agent["frontier-planner"].model, "openai/gpt-5.6-sol");
    for (const [name, agent] of Object.entries(config.agent)) {
      if (["frontier-orchestrator", "frontier-planner"].includes(name)) continue;
      assert.equal(agent.model, "openai/gpt-5.3-codex", name);
      assert.equal(agent.reasoningEffort, "high", name);
    }
  });
});
