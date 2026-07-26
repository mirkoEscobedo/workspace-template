import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  canonicalJson,
  exists,
  hashBuffer,
  hashFile,
  readJson,
  readJsonIfExists,
  toPosixPath,
} from "../fs-utils.js";
import { createPlanEnvelope } from "../plans/schema.js";
import { repositoryPreconditions } from "../plans/fingerprint.js";
import { mergeStructuredConfig } from "../tooling/structured-edit.js";
import { architectureNote } from "../workspace-artifacts.js";
import { selectPreset } from "./catalog.js";
import {
  activePresetState,
  codexBrokerArtifactPath,
  isSafeBrokerRoleId,
  modelRoutingYaml,
  overrideBlocksFallback,
  renderCodexArtifacts,
  renderOpenCodeArtifacts,
  resolveRoleIds,
} from "./render.js";
import {
  assertNoPendingPresetTransaction,
  capturePresetParentIdentity,
} from "./transaction.js";

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function operation(relative, content, current) {
  const proposedHash = hashBuffer(content);
  if (current && hashBuffer(current) === proposedHash) {
    return { kind: "noop", path: relative, proposedHash, currentHash: proposedHash };
  }
  return {
    kind: current ? "update-preset-managed" : "create-preset-managed",
    path: relative,
    currentHash: current ? hashBuffer(current) : null,
    proposedHash,
    contentEncoding: "base64",
    content: content.toString("base64"),
  };
}

function reportOperation(current) {
  return {
    kind: current ? "update-preset-report" : "create-preset-report",
    path: ".agentic/preset-report.json",
    currentHash: current ? hashBuffer(current) : null,
  };
}

async function currentBuffer(root, relative) {
  const target = path.join(root, ...relative.split("/"));
  return (await exists(target)) ? readFile(target) : undefined;
}

async function isWholeFileManaged(root, relative, managed) {
  const record = managed.files?.[relative];
  const target = path.join(root, ...relative.split("/"));
  return Boolean(record && (await exists(target)) && (!record.hash || record.hash === await hashFile(target)));
}

function sameValue(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function mergeWithSettingOwnership(text, format, patches, settings = {}) {
  let content = text;
  const overrides = [];
  const managed = {};
  for (const patch of [...patches].sort((left, right) => left.path.localeCompare(right.path))) {
    const preserved = mergeStructuredConfig(content, format, [patch], "preserve");
    const conflict = preserved.conflicts[0];
    const previous = settings[patch.path];
    if (conflict && previous && sameValue(previous.value, conflict.current)) {
      const replaced = mergeStructuredConfig(content, format, [patch], "replace");
      content = replaced.content;
      managed[patch.path] = { value: structuredClone(patch.value) };
      continue;
    }
    content = preserved.content;
    if (conflict) {
      overrides.push({
        pointer: patch.path,
        current: conflict.current,
        requested: patch.value,
        reason: "preserved user-owned setting",
      });
    } else {
      managed[patch.path] = { value: structuredClone(patch.value) };
    }
  }
  return { content, overrides, managed };
}

function codexPatches(resolved) {
  return [
    { path: "/model", value: resolved.roles.coordinator.targets.codex },
    { path: "/model_reasoning_effort", value: resolved.roles.coordinator.reasoningEffort },
    { path: "/agents/enabled", value: true },
    { path: "/agents/max_concurrent_threads_per_session", value: 3 },
    { path: "/agents/default_subagent_model", value: resolved.roles.implementer.targets.codex },
    { path: "/agents/default_subagent_reasoning_effort", value: resolved.roles.implementer.reasoningEffort },
  ];
}

function openCodePatches(rendered, roleIds) {
  const output = [{ path: "/default_agent", value: roleIds.opencode.coordinator }];
  for (const [id, agent] of Object.entries(rendered.agent)) {
    output.push({ path: `/agent/${id}`, value: agent });
  }
  return output;
}

async function renderedHarness(root, agentTargets, resolved, roleIds, managed) {
  const artifacts = [];
  const overrides = [];
  const settings = structuredClone(managed.settings ?? {});

  if (agentTargets.includes("codex")) {
    const rendered = await renderCodexArtifacts(resolved, roleIds);
    for (const artifact of rendered.filter((item) => item.path.startsWith(".codex/agents/"))) artifacts.push(artifact);
    const desiredConfig = rendered.find((item) => item.path === ".codex/config.toml");
    const current = await currentBuffer(root, desiredConfig.path);
    if (!current || await isWholeFileManaged(root, desiredConfig.path, managed)) {
      artifacts.push(desiredConfig);
    } else {
      const merged = mergeWithSettingOwnership(
        current.toString("utf8"),
        "toml",
        codexPatches(resolved),
        settings[desiredConfig.path],
      );
      settings[desiredConfig.path] = merged.managed;
      overrides.push(...merged.overrides.map((item) => ({ target: "codex", path: desiredConfig.path, ...item })));
      artifacts.push({ path: desiredConfig.path, content: Buffer.from(merged.content) });
    }
  }

  if (agentTargets.includes("opencode")) {
    const rendered = await renderOpenCodeArtifacts(resolved, roleIds);
    for (const artifact of rendered.filter((item) => item.path.startsWith(".opencode/prompts/"))) artifacts.push(artifact);
    const desiredConfig = rendered.find((item) => item.path === "opencode.json");
    const desiredDocument = JSON.parse(desiredConfig.content.toString("utf8"));
    const current = await currentBuffer(root, desiredConfig.path);
    if (!current || await isWholeFileManaged(root, desiredConfig.path, managed)) {
      artifacts.push(desiredConfig);
    } else {
      let merged;
      try {
        merged = mergeWithSettingOwnership(
          current.toString("utf8"),
          "json",
          openCodePatches(desiredDocument, roleIds),
          settings[desiredConfig.path],
        );
      } catch (error) {
        overrides.push({
          target: "opencode",
          path: desiredConfig.path,
          pointer: "/",
          current: "<invalid JSON>",
          requested: "<generated agents>",
          reason: `preserved invalid user-owned configuration: ${error.message}`,
        });
        merged = { content: current.toString("utf8"), overrides: [], managed: settings[desiredConfig.path] ?? {} };
      }
      settings[desiredConfig.path] = merged.managed;
      overrides.push(...merged.overrides.map((item) => ({ target: "opencode", path: desiredConfig.path, ...item })));
      artifacts.push({ path: desiredConfig.path, content: Buffer.from(merged.content) });
    }
  }
  const fallback = resolved.fallbacks?.codexChildModelRefusal;
  if (overrides.some((override) => overrideBlocksFallback(override, fallback))) {
    const brokerRoleId = roleIds.broker?.codexChildModelRefusal;
    if (brokerRoleId) {
      const brokerPath = codexBrokerArtifactPath(brokerRoleId);
      const index = artifacts.findIndex((artifact) => artifact.path === brokerPath);
      if (index >= 0) artifacts.splice(index, 1);
    }
  }
  return { artifacts, overrides, settings };
}

function updatedConfig(config, presetState) {
  const value = structuredClone(config);
  value.version = Math.max(3, value.version ?? 0);
  value.execution ??= {};
  value.execution.preset = presetState;
  const summary = (role) => ({ model: role.targets?.codex ?? role.targets?.opencode, reasoningEffort: role.reasoningEffort });
  value.execution.coordinator = summary(presetState.roles.coordinator);
  value.execution.planner = summary(presetState.roles.planner);
  value.execution.workers = summary(presetState.roles.implementer);
  value.execution.routing = presetState.roles;
  return value;
}

function updatedProfile(profile, presetState) {
  const value = structuredClone(profile);
  value.execution ??= {};
  value.execution.preset = presetState;
  const summary = (role) => ({ model: role.targets?.codex ?? role.targets?.opencode, reasoningEffort: role.reasoningEffort });
  value.execution.coordinator = summary(presetState.roles.coordinator);
  value.execution.planner = summary(presetState.roles.planner);
  value.execution.workers = summary(presetState.roles.implementer);
  value.execution.routing = presetState.roles;
  return value;
}

function updateManagedManifest(managed, operations, settings, retiredPaths = []) {
  const value = structuredClone(managed);
  value.version = Math.max(3, value.version ?? 0);
  value.generator = "workspace-template";
  value.files ??= {};
  value.settings = settings;
  for (const relative of retiredPaths) delete value.files[relative];
  for (const relative of Object.keys(settings)) delete value.files[relative];
  for (const item of operations) {
    if (!["create-preset-managed", "update-preset-managed", "noop"].includes(item.kind)) continue;
    if (settings[item.path]) continue;
    value.files[item.path] = { mode: "managed", hash: item.proposedHash };
  }
  return value;
}

async function retiredBroker(root, previousPreset, nextPreset, managed) {
  const previousRoleId = previousPreset?.fallbacks?.codexChildModelRefusal?.brokerRoleId;
  const nextRoleId = nextPreset?.fallbacks?.codexChildModelRefusal?.brokerRoleId;
  if (!previousRoleId || previousRoleId === nextRoleId) {
    return { operations: [], paths: [], preserved: [] };
  }
  if (!isSafeBrokerRoleId(previousRoleId)) {
    return { operations: [], paths: [], preserved: [] };
  }
  const relative = codexBrokerArtifactPath(previousRoleId);
  const record = managed.files?.[relative];
  if (!record) return { operations: [], paths: [], preserved: [] };
  const current = await currentBuffer(root, relative);
  if (!current) return { operations: [], paths: [relative], preserved: [] };
  const currentHash = hashBuffer(current);
  if (!record.hash || record.hash === currentHash) {
    return {
      operations: [{
        kind: "delete-preset-managed",
        path: relative,
        currentHash,
        proposedHash: null,
      }],
      paths: [relative],
      preserved: [],
    };
  }
  return { operations: [], paths: [relative], preserved: [relative] };
}

export async function buildPresetPlan(rootDirectory, options = {}) {
  const root = path.resolve(rootDirectory);
  await assertNoPendingPresetTransaction(root);
  const configPath = path.join(root, ".agentic", "config.json");
  if (!(await exists(configPath))) throw new Error("Agent presets require an adopted workspace with .agentic/config.json");
  const config = await readJson(configPath);
  if (config.generator !== "workspace-template") throw new Error(".agentic/config.json is not owned by workspace-template");
  const agentTargets = config.agentTargets ?? [];
  const selection = await selectPreset(root, options.preset, agentTargets, { catalog: options.catalog });
  const roleIds = await resolveRoleIds(root, agentTargets, config.execution?.preset, selection.resolved);
  const managedPath = path.join(root, ".agentic", "managed-files.json");
  const managed = await readJsonIfExists(managedPath) ?? { version: 3, generator: "workspace-template", files: {}, settings: {} };
  const harness = await renderedHarness(root, agentTargets, selection.resolved, roleIds, managed);
  const presetState = activePresetState(selection.resolved, roleIds, harness.overrides);
  const profilePath = path.join(root, ".agentic", "profile.json");
  const profile = await readJson(profilePath);
  const artifacts = [
    ...harness.artifacts,
    { path: ".agentic/config.json", content: jsonBuffer(updatedConfig(config, presetState)) },
    { path: ".agentic/profile.json", content: jsonBuffer(updatedProfile(profile, presetState)) },
    { path: ".agentic/policies/model-routing.yaml", content: Buffer.from(modelRoutingYaml(selection.resolved, presetState)) },
    {
      path: ".agentic/implementation-profile.md",
      content: Buffer.from(architectureNote({
        project: config.project,
        style: config.style,
        tdd: config.tdd,
        mode: options.mode ?? config.mode,
        presetState,
      })),
    },
  ];
  const operations = [];
  for (const artifact of artifacts.sort((left, right) => left.path.localeCompare(right.path))) {
    const current = await currentBuffer(root, artifact.path);
    operations.push(operation(artifact.path, Buffer.isBuffer(artifact.content) ? artifact.content : Buffer.from(artifact.content), current));
  }
  const retired = await retiredBroker(root, config.execution?.preset, presetState, managed);
  operations.push(...retired.operations);
  const nextManaged = updateManagedManifest(managed, operations, harness.settings, retired.paths);
  const currentReport = await currentBuffer(root, ".agentic/preset-report.json");
  operations.push(reportOperation(currentReport));
  const currentManaged = await currentBuffer(root, ".agentic/managed-files.json");
  operations.sort((left, right) => left.path.localeCompare(right.path));
  operations.push(operation(".agentic/managed-files.json", jsonBuffer(nextManaged), currentManaged));
  for (const item of operations) {
    await capturePresetParentIdentity(root, item.path, { allowMissing: true });
  }
  const fingerprintPaths = [
    ".agentic/config.json",
    ".agentic/profile.json",
    ".agentic/managed-files.json",
    ".agentic/presets/builtin",
    ".agentic/presets/local",
    ...operations.map((item) => item.path),
  ];
  return createPlanEnvelope({
    command: "preset",
    subcommand: "apply",
    root,
    scope: { preset: selection.resolved.id, agentTargets },
    preconditions: await repositoryPreconditions(root, [...new Set(fingerprintPaths)], { allowDirty: options.allowDirty }),
    operations,
    approvals: { dirtyTree: Boolean(options.allowDirty) },
    warnings: [
      ...(harness.overrides.length > 0
        ? [`Preset will be partially active because ${harness.overrides.length} user-owned setting(s) are preserved.`]
        : []),
      ...(retired.preserved.length > 0
        ? [`Preserved drifted retired broker artifact(s): ${retired.preserved.join(", ")}.`]
        : []),
    ],
    conflicts: [],
    metadata: {
      preset: presetState,
      previousPreset: config.execution?.preset?.id ?? null,
      sessionRestartRequired: true,
    },
  });
}
