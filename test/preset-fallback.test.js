import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createProject } from "../src/create.js";
import {
  applyPresetPlan,
  buildPresetPlan,
  loadBuiltInPresets,
  resolvePreset,
  validatePreset,
} from "../src/presets/index.js";

const eligibleRoles = [
  "scout",
  "implementer",
  "reviewer-spec",
  "reviewer-code",
  "reviewer-ops",
  "repairer",
  "integrator",
];
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoots = [];
after(async () => { const owned = [...temporaryRoots]; await Promise.all(owned.map((root) => rm(root, { recursive: true, force: true }))); await Promise.all(owned.map((root) => assert.rejects(() => stat(root), { code: "ENOENT" }))); });

function schemaAccepts(value, schema) {
  function valid(candidate, rule) {
    if (rule.allOf?.some((item) => !valid(candidate, item))) return false;
    if (rule.if && valid(candidate, rule.if) && rule.then && !valid(candidate, rule.then)) return false;
    if (rule.const !== undefined && !Object.is(candidate, rule.const)) return false;
    if (rule.enum && !rule.enum.some((item) => Object.is(candidate, item))) return false;
    if (rule.type === "object" && (!candidate || typeof candidate !== "object" || Array.isArray(candidate))) return false;
    if (rule.type === "array" && !Array.isArray(candidate)) return false;
    if (rule.type === "string" && typeof candidate !== "string") return false;
    if (typeof candidate === "string" && rule.minLength !== undefined && candidate.length < rule.minLength) return false;
    if (typeof candidate === "string" && rule.pattern && !(new RegExp(rule.pattern).test(candidate))) return false;
    if (Array.isArray(candidate)) {
      if (rule.minItems !== undefined && candidate.length < rule.minItems) return false;
      if (rule.maxItems !== undefined && candidate.length > rule.maxItems) return false;
      if (rule.uniqueItems && new Set(candidate.map((item) => JSON.stringify(item))).size !== candidate.length) return false;
      if (rule.items && candidate.some((item) => !valid(item, rule.items))) return false;
    }
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      if (rule.minProperties !== undefined && Object.keys(candidate).length < rule.minProperties) return false;
      if (rule.required?.some((key) => !Object.hasOwn(candidate, key))) return false;
      for (const [key, item] of Object.entries(candidate)) {
        if (rule.properties?.[key]) {
          if (!valid(item, rule.properties[key])) return false;
        } else if (rule.additionalProperties === false) {
          return false;
        } else if (rule.additionalProperties && typeof rule.additionalProperties === "object") {
          if (!valid(item, rule.additionalProperties)) return false;
        }
      }
    }
    return true;
  }
  return valid(value, schema);
}

function projectOptions(target, preset = undefined) {
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
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-template-fallback-core-"));
  temporaryRoots.push(root);
  await createProject(projectOptions(root, preset));
  return root;
}

describe("conditional preset fallback", () => {
  it("resolves the exact sol-codex Spark fallback while sol-only stays broker-free", async () => {
    const presets = await loadBuiltInPresets();
    const solCodex = presets.find((preset) => preset.id === "sol-codex");
    const solOnly = presets.find((preset) => preset.id === "sol-only");

    assert.deepEqual(solCodex.fallbacks, {
      codexChildModelRefusal: {
        roles: eligibleRoles,
        brokerModel: "terra-medium",
        delegateTarget: "opencode",
      },
    });
    const resolved = resolvePreset(solCodex, ["codex", "opencode"]);
    assert.deepEqual(resolved.fallbacks, {
      codexChildModelRefusal: {
        roles: eligibleRoles,
        brokerModel: {
          alias: "terra-medium",
          target: "codex",
          model: "gpt-5.6-terra",
          reasoningEffort: "medium",
        },
        delegateTarget: "opencode",
      },
    });
    for (const role of eligibleRoles) {
      assert.deepEqual(resolved.roles[role], {
        alias: "codex-spark-xhigh",
        reasoningEffort: "xhigh",
        targets: {
          codex: "gpt-5.3-codex-spark",
          opencode: "openai/gpt-5.3-codex-spark",
        },
      });
    }
    for (const role of ["coordinator", "planner"]) {
      assert.equal(resolved.roles[role].targets.codex, "gpt-5.6-sol");
      assert.equal(resolved.roles[role].reasoningEffort, "high");
    }
    assert.equal(Object.hasOwn(resolvePreset(solOnly), "fallbacks"), false);
    assert.equal(solOnly.fingerprint, "793606dafbcd5571feb039beaad992c501952fe7a8d33a913a035653a10420b6");
  });

  it("rejects every malformed fallback boundary while legacy version-1 presets remain valid", async () => {
    const presets = await loadBuiltInPresets();
    const solCodex = presets.find((preset) => preset.id === "sol-codex");
    const solOnly = presets.find((preset) => preset.id === "sol-only");
    assert.equal(validatePreset(solOnly, solOnly.path, { allowLoaderMetadata: true }).version, 1);

    const rejects = (mutate, pattern) => {
      const candidate = structuredClone(solCodex);
      mutate(candidate);
      assert.throws(
        () => validatePreset(candidate, "<candidate>", { allowLoaderMetadata: true }),
        pattern,
      );
    };
    rejects(
      (candidate) => {
        candidate.fallbacks.otherFallback = structuredClone(candidate.fallbacks.codexChildModelRefusal);
      },
      /only codexChildModelRefusal/,
    );
    rejects(
      (candidate) => {
        candidate.fallbacks.codexChildModelRefusal.roles[0] = "coordinator";
      },
      /ineligible role/,
    );
    rejects(
      (candidate) => {
        candidate.fallbacks.codexChildModelRefusal.roles[1] = "scout";
      },
      /duplicate role/,
    );
    rejects(
      (candidate) => {
        candidate.fallbacks.codexChildModelRefusal.brokerModel = "missing-alias";
      },
      /declared model alias/,
    );
    rejects(
      (candidate) => {
        candidate.fallbacks.codexChildModelRefusal.delegateTarget = "codex";
      },
      /must be opencode/,
    );
    rejects(
      (candidate) => {
        delete candidate.models["codex-spark-xhigh"].targets.opencode;
      },
      /has no opencode model binding/,
    );
    rejects(
      (candidate) => {
        candidate.fallbacks.codexChildModelRefusal.roles = "scout";
      },
      /must be an array/,
    );
    rejects(
      (candidate) => {
        candidate.fallbacks.codexChildModelRefusal.retry = true;
      },
      /unsupported field/,
    );
  });

  it("keeps schema and runtime fallback validation aligned for relational aliases and bindings", async () => {
    const schema = JSON.parse(
      await readFile(path.join(repositoryRoot, "assets", "presets", "preset.schema.json"), "utf8"),
    );
    const validPreset = JSON.parse(
      await readFile(path.join(repositoryRoot, "assets", "presets", "builtin", "sol-codex.json"), "utf8"),
    );
    const fixtures = [
      { name: "valid fallback", mutate() {}, accepted: true },
      {
        name: "undeclared broker alias",
        mutate(candidate) {
          candidate.fallbacks.codexChildModelRefusal.brokerModel = "missing-alias";
        },
        accepted: false,
      },
      {
        name: "broker missing native target",
        mutate(candidate) {
          delete candidate.models["terra-medium"].targets.codex;
        },
        accepted: false,
      },
      {
        name: "semantic role missing delegate target",
        mutate(candidate) {
          delete candidate.models["codex-spark-xhigh"].targets.opencode;
        },
        accepted: false,
      },
      {
        name: "wrong Terra model",
        mutate(candidate) {
          candidate.models["terra-medium"].targets.codex = "gpt-5.6-sol";
        },
        accepted: false,
      },
      {
        name: "wrong Terra reasoning",
        mutate(candidate) {
          candidate.models["terra-medium"].reasoningEffort = "high";
        },
        accepted: false,
      },
      {
        name: "wrong native Spark model",
        mutate(candidate) {
          candidate.models["codex-spark-xhigh"].targets.codex = "gpt-5.3-codex";
        },
        accepted: false,
      },
      {
        name: "wrong OpenCode Spark model",
        mutate(candidate) {
          candidate.models["codex-spark-xhigh"].targets.opencode = "openai/gpt-5.3-codex";
        },
        accepted: false,
      },
      {
        name: "wrong Spark reasoning",
        mutate(candidate) {
          candidate.models["codex-spark-xhigh"].reasoningEffort = "high";
        },
        accepted: false,
      },
      {
        name: "unknown fallback field",
        mutate(candidate) {
          candidate.fallbacks.codexChildModelRefusal.retry = true;
        },
        accepted: false,
      },
    ];

    for (const fixture of fixtures) {
      const candidate = structuredClone(validPreset);
      fixture.mutate(candidate);
      assert.equal(schemaAccepts(candidate, schema), fixture.accepted, `${fixture.name}: schema`);
      let runtimeAccepted = true;
      try {
        validatePreset(candidate, `<${fixture.name}>`);
      } catch {
        runtimeAccepted = false;
      }
      assert.equal(runtimeAccepted, fixture.accepted, `${fixture.name}: runtime`);
    }
  });

  it("plans a truthful transport broker without touching a user-owned collision", async () => {
    const root = await workspace();
    const collision = path.join(root, ".codex", "agents", "opencode-spark-broker.toml");
    await mkdir(path.dirname(collision), { recursive: true });
    const customAgent = 'name = "opencode_spark_broker"\ndescription = "user owned"\n';
    await writeFile(collision, customAgent);

    const plan = await buildPresetPlan(root, { preset: "sol-codex", allowDirty: true });
    const fallback = plan.metadata.preset.fallbacks.codexChildModelRefusal;
    assert.equal(fallback.brokerRoleId, "wt_opencode_spark_broker");
    assert.deepEqual(fallback.brokerModel, {
      alias: "terra-medium",
      target: "codex",
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
    });
    assert.deepEqual(fallback.roles, eligibleRoles);
    assert.equal(fallback.delegateTarget, "opencode");
    for (const role of eligibleRoles) {
      assert.deepEqual(fallback.delegateRoles[role], {
        roleId: plan.metadata.preset.roleIds.opencode[role],
        model: "openai/gpt-5.3-codex-spark",
        variant: "xhigh",
      });
    }

    const broker = plan.operations.find(
      (operation) => operation.path === ".codex/agents/wt_opencode_spark_broker.toml",
    );
    assert.equal(broker.kind, "create-preset-managed");
    const brokerText = Buffer.from(broker.content, "base64").toString("utf8");
    assert.match(brokerText, /^name = "wt_opencode_spark_broker"$/m);
    assert.match(brokerText, /^model = "gpt-5.6-terra"$/m);
    assert.match(brokerText, /^model_reasoning_effort = "medium"$/m);
    assert.match(brokerText, /transport-only/i);
    assert.equal(
      plan.operations.some((operation) => operation.path === ".codex/agents/opencode-spark-broker.toml"),
      false,
    );
    for (const statePath of [".agentic/config.json", ".agentic/profile.json"]) {
      const stateOperation = plan.operations.find((operation) => operation.path === statePath);
      const state = JSON.parse(Buffer.from(stateOperation.content, "base64").toString("utf8"));
      assert.deepEqual(state.execution.preset.fallbacks.codexChildModelRefusal, fallback);
    }
    const routingOperation = plan.operations.find(
      (operation) => operation.path === ".agentic/policies/model-routing.yaml",
    );
    const routing = Buffer.from(routingOperation.content, "base64").toString("utf8");
    assert.match(routing, /broker_role_id: wt_opencode_spark_broker/);
    assert.match(routing, /model: gpt-5\.6-terra/);
    assert.match(routing, /eligible_roles: \[scout, implementer, reviewer-spec, reviewer-code, reviewer-ops, repairer, integrator\]/);
    assert.match(routing, /role_id: frontier-scout/);
    assert.match(routing, /model: openai\/gpt-5\.3-codex-spark/);
    assert.match(routing, /variant: xhigh/);
    assert.equal(await readFile(collision, "utf8"), customAgent);
  });

  it("reserves every broker destination filename and parsed role ID across chained collisions", async () => {
    const root = await workspace();
    const agentsRoot = path.join(root, ".codex", "agents");
    const collisions = new Map([
      ["opencode-spark-broker.toml", 'name = "unrelated_preferred"\n'],
      ["wt_opencode_spark_broker.toml", 'name = "unrelated_prefixed"\n'],
      ["wt2_opencode_spark_broker.toml", 'name = "another_unrelated_role"\n'],
      ["parsed-id.toml", 'name = "wt3_opencode_spark_broker"\n'],
    ]);
    for (const [file, bytes] of collisions) await writeFile(path.join(agentsRoot, file), bytes);

    const plan = await buildPresetPlan(root, { preset: "sol-codex", allowDirty: true });
    assert.equal(
      plan.metadata.preset.fallbacks.codexChildModelRefusal.brokerRoleId,
      "wt4_opencode_spark_broker",
    );
    assert.ok(
      plan.operations.some(
        (operation) => operation.path === ".codex/agents/wt4_opencode_spark_broker.toml",
      ),
    );
    for (const [file, expected] of collisions) {
      assert.equal(await readFile(path.join(agentsRoot, file), "utf8"), expected);
      assert.equal(
        plan.operations.some((operation) => operation.path === `.codex/agents/${file}`),
        false,
      );
    }
  });

  it("does not claim a fallback route when user-owned OpenCode state cannot materialize it", async () => {
    const root = await workspace();
    const opencodePath = path.join(root, "opencode.json");
    const invalidUserConfig = "{ user-owned invalid JSON\n";
    await writeFile(opencodePath, invalidUserConfig);

    const plan = await buildPresetPlan(root, { preset: "sol-codex", allowDirty: true });
    assert.equal(plan.metadata.preset.status, "partial");
    assert.equal(Object.hasOwn(plan.metadata.preset, "fallbacks"), false);
    assert.equal(Object.hasOwn(plan.metadata.preset.roleIds, "broker"), false);
    assert.equal(
      plan.metadata.preset.overrides.some(
        (override) => override.target === "opencode" && override.pointer === "/",
      ),
      true,
    );
    assert.equal(
      plan.operations.find((operation) => operation.path === "opencode.json").kind,
      "noop",
    );
    assert.equal(await readFile(opencodePath, "utf8"), invalidUserConfig);
  });

  it("does not orphan a broker when an OpenCode partial apply is deactivated", async () => {
    const root = await workspace("sol-codex");
    const opencodePath = path.join(root, "opencode.json");
    const brokerPath = path.join(root, ".codex", "agents", "opencode-spark-broker.toml");
    const invalidUserConfig = "{ preserved user-owned invalid JSON\n";
    assert.match(await readFile(brokerPath, "utf8"), /transport-only/i);
    const initialManaged = JSON.parse(
      await readFile(path.join(root, ".agentic", "managed-files.json"), "utf8"),
    );
    assert.equal(Object.hasOwn(initialManaged.files, ".codex/agents/opencode-spark-broker.toml"), true);
    await writeFile(opencodePath, invalidUserConfig);

    const partialPlan = await buildPresetPlan(root, { preset: "sol-codex", allowDirty: true });
    assert.equal(partialPlan.metadata.preset.status, "partial");
    assert.equal(
      partialPlan.operations.find(
        (operation) => operation.path === ".codex/agents/opencode-spark-broker.toml",
      ).kind,
      "delete-preset-managed",
    );
    await applyPresetPlan(partialPlan);
    await assert.rejects(() => readFile(brokerPath), { code: "ENOENT" });
    assert.equal(await readFile(opencodePath, "utf8"), invalidUserConfig);
    const partialManaged = JSON.parse(
      await readFile(path.join(root, ".agentic", "managed-files.json"), "utf8"),
    );
    assert.equal(
      Object.hasOwn(partialManaged.files, ".codex/agents/opencode-spark-broker.toml"),
      false,
    );

    const deactivate = await buildPresetPlan(root, { preset: "sol-only", allowDirty: true });
    await applyPresetPlan(deactivate);
    assert.equal(await readFile(opencodePath, "utf8"), invalidUserConfig);
    await assert.rejects(() => readFile(brokerPath), { code: "ENOENT" });
    const managed = JSON.parse(
      await readFile(path.join(root, ".agentic", "managed-files.json"), "utf8"),
    );
    assert.equal(
      Object.keys(managed.files).some((relative) => relative.includes("opencode_spark_broker")
        || relative.endsWith("/opencode-spark-broker.toml")),
      false,
    );
  });

  it("does not materialize or claim a broker when preserved Codex state disables agents", async () => {
    const root = await workspace();
    const codexPath = path.join(root, ".codex", "config.toml");
    const disabled = (await readFile(codexPath, "utf8")).replace(
      /^enabled = true$/m,
      "enabled = false",
    );
    await writeFile(codexPath, disabled);

    const plan = await buildPresetPlan(root, { preset: "sol-codex", allowDirty: true });
    assert.equal(plan.metadata.preset.status, "partial");
    assert.equal(Object.hasOwn(plan.metadata.preset, "fallbacks"), false);
    assert.equal(Object.hasOwn(plan.metadata.preset.roleIds, "broker"), false);
    assert.equal(
      plan.metadata.preset.overrides.some(
        (override) => override.target === "codex"
          && override.pointer === "/agents/enabled"
          && override.current === false,
      ),
      true,
    );
    assert.equal(
      plan.operations.some(
        (operation) => operation.path === ".codex/agents/opencode-spark-broker.toml"
          || operation.path.includes("opencode_spark_broker"),
      ),
      false,
    );
    const routing = Buffer.from(
      plan.operations.find(
        (operation) => operation.path === ".agentic/policies/model-routing.yaml",
      ).content,
      "base64",
    ).toString("utf8");
    assert.doesNotMatch(routing, /^fallbacks:/m);
    assert.equal(
      plan.operations.find((operation) => operation.path === ".codex/config.toml").kind,
      "noop",
    );
    assert.match(await readFile(codexPath, "utf8"), /^enabled = false$/m);
  });

  it("removes only an owned current broker and relinquishes a drifted broker", async () => {
    const brokerRelative = ".codex/agents/opencode-spark-broker.toml";

    const managedRoot = await workspace("sol-codex");
    const managedBroker = path.join(managedRoot, ...brokerRelative.split("/"));
    const reapplied = await buildPresetPlan(managedRoot, { preset: "sol-codex" });
    assert.equal(
      reapplied.metadata.preset.fallbacks.codexChildModelRefusal.brokerRoleId,
      "opencode_spark_broker",
    );
    assert.equal(
      reapplied.operations.find((operation) => operation.path === brokerRelative).kind,
      "noop",
    );
    const managedPlan = await buildPresetPlan(managedRoot, { preset: "sol-only" });
    const removal = managedPlan.operations.find((operation) => operation.path === brokerRelative);
    assert.ok(removal, "the managed broker should have a removal operation");
    assert.equal(removal.kind, "delete-preset-managed");
    assert.equal(typeof removal.currentHash, "string");
    assert.equal(removal.proposedHash, null);
    await applyPresetPlan(managedPlan);
    await assert.rejects(() => readFile(managedBroker), { code: "ENOENT" });
    const managedManifest = JSON.parse(
      await readFile(path.join(managedRoot, ".agentic", "managed-files.json"), "utf8"),
    );
    assert.equal(Object.hasOwn(managedManifest.files, brokerRelative), false);
    assert.equal(
      Object.hasOwn(
        JSON.parse(await readFile(path.join(managedRoot, ".agentic", "config.json"), "utf8")).execution.preset,
        "fallbacks",
      ),
      false,
    );

    const driftedRoot = await workspace("sol-codex");
    const driftedBroker = path.join(driftedRoot, ...brokerRelative.split("/"));
    const customBytes = Buffer.from(`${await readFile(driftedBroker, "utf8")}\n# user-owned drift\n`);
    await writeFile(driftedBroker, customBytes);
    const driftedPlan = await buildPresetPlan(driftedRoot, { preset: "sol-only", allowDirty: true });
    assert.equal(driftedPlan.operations.some((operation) => operation.path === brokerRelative), false);
    await applyPresetPlan(driftedPlan);
    assert.deepEqual(await readFile(driftedBroker), customBytes);
    const driftedManifest = JSON.parse(
      await readFile(path.join(driftedRoot, ".agentic", "managed-files.json"), "utf8"),
    );
    assert.equal(Object.hasOwn(driftedManifest.files, brokerRelative), false);
  });
});
