import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  exists,
  hashFile,
  listFiles,
  readJsonIfExists,
  toPosixPath,
} from "../fs-utils.js";
import { assetsRoot } from "../asset-paths.js";
import { PRESET_ROLES } from "./catalog.js";

export const CODEX_ROLE_FILES = Object.freeze({
  planner: "planner.toml",
  scout: "scout.toml",
  implementer: "implementer.toml",
  "reviewer-spec": "reviewer-spec.toml",
  "reviewer-code": "reviewer-code.toml",
  "reviewer-ops": "reviewer-ops.toml",
  repairer: "repairer.toml",
  integrator: "integrator.toml",
});

export const PREFERRED_BROKER_ROLE_ID = "opencode_spark_broker";
const BROKER_FILE = "opencode-spark-broker.toml";
const BROKER_ROLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export function isSafeBrokerRoleId(roleId) {
  return typeof roleId === "string" && BROKER_ROLE_ID_PATTERN.test(roleId);
}

export function codexBrokerArtifactPath(roleId) {
  if (!isSafeBrokerRoleId(roleId)) {
    throw new Error(`Invalid preset broker role ID: ${roleId}`);
  }
  const destinationName = roleId === PREFERRED_BROKER_ROLE_ID ? BROKER_FILE : `${roleId}.toml`;
  return `.codex/agents/${destinationName}`;
}

export const PREFERRED_ROLE_IDS = Object.freeze({
  codex: Object.freeze({
    coordinator: "frontier_orchestrator",
    planner: "frontier_planner",
    scout: "frontier_scout",
    implementer: "ticket_implementer",
    "reviewer-spec": "reviewer_spec_authority",
    "reviewer-code": "reviewer_code_test",
    "reviewer-ops": "reviewer_operations_security",
    repairer: "ticket_repairer",
    integrator: "frontier_integrator",
  }),
  opencode: Object.freeze({
    coordinator: "frontier-orchestrator",
    planner: "frontier-planner",
    scout: "frontier-scout",
    implementer: "ticket-implementer",
    "reviewer-spec": "reviewer-spec-authority",
    "reviewer-code": "reviewer-code-test",
    "reviewer-ops": "reviewer-operations-security",
    repairer: "ticket-repairer",
    integrator: "frontier-integrator",
  }),
});

function parseTomlName(text) {
  return /^\s*name\s*=\s*["']([^"']+)["']/m.exec(text)?.[1];
}

async function managedFileRecords(root) {
  const manifest = await readJsonIfExists(path.join(root, ".agentic", "managed-files.json"));
  return manifest?.generator === "workspace-template" ? manifest.files ?? {} : {};
}

async function isManagedCurrent(root, relative, records) {
  const target = path.join(root, ...relative.split("/"));
  const record = records[relative];
  if (!record || !(await exists(target))) return false;
  return !record.hash || record.hash === await hashFile(target);
}

function nextRoleId(preferred, occupied, target) {
  if (!occupied.has(preferred)) return preferred;
  const separator = target === "codex" ? "_" : "-";
  const prefix = `wt${separator}${preferred}`;
  if (!occupied.has(prefix)) return prefix;
  for (let number = 2; ; number += 1) {
    const candidate = `wt${number}${separator}${preferred}`;
    if (!occupied.has(candidate)) return candidate;
  }
}

function brokerRoleIdForDestination(fileName) {
  const normalized = fileName.toLowerCase();
  if (normalized === BROKER_FILE) return PREFERRED_BROKER_ROLE_ID;
  return path.extname(normalized) === ".toml" ? path.basename(normalized, ".toml") : null;
}

export function overrideBlocksCodexFallback(override) {
  if (override.target !== "codex") return false;
  if (override.pointer === "/agents/enabled") return override.current !== true;
  if (override.pointer === "/agents/max_concurrent_threads_per_session") {
    return !Number.isInteger(override.current) || override.current < 1;
  }
  return false;
}

export function overrideBlocksFallback(override, fallback) {
  return overrideBlocksCodexFallback(override)
    || (fallback && override.target === fallback.delegateTarget);
}

export async function resolveRoleIds(rootDirectory, agentTargets, existingPreset = undefined, resolvedPreset = undefined) {
  const root = path.resolve(rootDirectory);
  const records = await managedFileRecords(root);
  const roleIds = {};

  if (agentTargets.includes("codex")) {
    const occupied = new Set();
    const blockedPreferredRoles = new Set();
    let brokerPathBlocked = false;
    const agentsRoot = path.join(root, ".codex", "agents");
    for (const file of await listFiles(agentsRoot)) {
      if (path.extname(file).toLowerCase() !== ".toml") continue;
      const relative = toPosixPath(path.relative(root, file));
      if (await isManagedCurrent(root, relative, records)) continue;
      if (path.basename(file).toLowerCase() === BROKER_FILE) brokerPathBlocked = true;
      const brokerDestinationRoleId = brokerRoleIdForDestination(path.basename(file));
      if (brokerDestinationRoleId) occupied.add(brokerDestinationRoleId);
      const name = parseTomlName(await readFile(file, "utf8"));
      if (name) occupied.add(name);
      for (const [role, fileName] of Object.entries(CODEX_ROLE_FILES)) {
        if (path.basename(file).toLowerCase() === fileName.toLowerCase()) blockedPreferredRoles.add(role);
      }
    }
    roleIds.codex = {};
    for (const role of PRESET_ROLES) {
      const recorded = existingPreset?.roleIds?.codex?.[role];
      roleIds.codex[role] = recorded && !occupied.has(recorded)
        ? recorded
        : nextRoleId(
            blockedPreferredRoles.has(role) ? `wt_${PREFERRED_ROLE_IDS.codex[role]}` : PREFERRED_ROLE_IDS.codex[role],
            occupied,
            "codex",
          );
      occupied.add(roleIds.codex[role]);
    }
    if (resolvedPreset?.fallbacks?.codexChildModelRefusal && agentTargets.includes("opencode")) {
      if (brokerPathBlocked) occupied.add(PREFERRED_BROKER_ROLE_ID);
      const recorded = existingPreset?.fallbacks?.codexChildModelRefusal?.brokerRoleId;
      const brokerRoleId = isSafeBrokerRoleId(recorded) && !occupied.has(recorded)
        ? recorded
        : nextRoleId(PREFERRED_BROKER_ROLE_ID, occupied, "codex");
      roleIds.broker = { codexChildModelRefusal: brokerRoleId };
      occupied.add(brokerRoleId);
    }
  }

  if (agentTargets.includes("opencode")) {
    const occupied = new Set();
    const opencodePath = path.join(root, "opencode.json");
    if (await exists(opencodePath) && !(await isManagedCurrent(root, "opencode.json", records))) {
      try {
        const document = JSON.parse(await readFile(opencodePath, "utf8"));
        for (const id of Object.keys(document.agent ?? {})) occupied.add(id);
      } catch {
        // Invalid user-owned configuration is preserved; adoption will propose
        // a complete generated configuration rather than attempting a merge.
      }
    }
    roleIds.opencode = {};
    for (const role of PRESET_ROLES) {
      const recorded = existingPreset?.roleIds?.opencode?.[role];
      roleIds.opencode[role] = recorded && !occupied.has(recorded)
        ? recorded
        : nextRoleId(PREFERRED_ROLE_IDS.opencode[role], occupied, "opencode");
      occupied.add(roleIds.opencode[role]);
    }
  }
  return roleIds;
}

function replaceTomlScalar(text, key, value) {
  const expression = new RegExp(`^${key}\\s*=.*$`, "m");
  const rendered = `${key} = ${JSON.stringify(value)}`;
  return expression.test(text) ? text.replace(expression, rendered) : `${rendered}\n${text}`;
}

export async function renderCodexArtifacts(resolved, roleIds) {
  const configSource = path.join(assetsRoot, "configs", "codex", "config.toml");
  let config = await readFile(configSource, "utf8");
  config = replaceTomlScalar(config, "model", resolved.roles.coordinator.targets.codex);
  config = replaceTomlScalar(config, "model_reasoning_effort", resolved.roles.coordinator.reasoningEffort);
  config = replaceTomlScalar(config, "default_subagent_model", resolved.roles.implementer.targets.codex);
  config = replaceTomlScalar(config, "default_subagent_reasoning_effort", resolved.roles.implementer.reasoningEffort);
  const artifacts = [
    { path: ".codex/config.toml", content: Buffer.from(config) },
    { path: ".codex/hooks.json", content: await readFile(path.join(assetsRoot, "configs", "codex", "hooks.json")) },
  ];
  for (const [role, fileName] of Object.entries(CODEX_ROLE_FILES)) {
    let content = await readFile(path.join(assetsRoot, "configs", "codex", "agents", fileName), "utf8");
    content = replaceTomlScalar(content, "name", roleIds.codex[role]);
    content = replaceTomlScalar(content, "model", resolved.roles[role].targets.codex);
    content = replaceTomlScalar(content, "model_reasoning_effort", resolved.roles[role].reasoningEffort);
    const destinationName = roleIds.codex[role] === PREFERRED_ROLE_IDS.codex[role]
      ? fileName
      : `${roleIds.codex[role]}.toml`;
    artifacts.push({ path: `.codex/agents/${destinationName}`, content: Buffer.from(content) });
  }
  if (resolved.fallbacks?.codexChildModelRefusal && roleIds.opencode) {
    const fallback = resolved.fallbacks.codexChildModelRefusal;
    const brokerRoleId = roleIds.broker?.codexChildModelRefusal ?? PREFERRED_BROKER_ROLE_ID;
    let content = await readFile(path.join(assetsRoot, "configs", "codex", "agents", BROKER_FILE), "utf8");
    content = replaceTomlScalar(content, "name", brokerRoleId);
    content = replaceTomlScalar(content, "model", fallback.brokerModel.model);
    content = replaceTomlScalar(content, "model_reasoning_effort", fallback.brokerModel.reasoningEffort);
    artifacts.push({ path: codexBrokerArtifactPath(brokerRoleId), content: Buffer.from(content) });
  }
  return artifacts;
}

export async function renderOpenCodeArtifacts(resolved, roleIds) {
  const source = JSON.parse(await readFile(path.join(assetsRoot, "configs", "opencode", "opencode.json"), "utf8"));
  const sourceIds = PREFERRED_ROLE_IDS.opencode;
  const renderedAgents = {};
  for (const role of PRESET_ROLES) {
    const sourceId = sourceIds[role];
    const destinationId = roleIds.opencode[role];
    const agent = structuredClone(source.agent[sourceId]);
    agent.model = resolved.roles[role].targets.opencode;
    agent.reasoningEffort = resolved.roles[role].reasoningEffort;
    if (agent.prompt) {
      const file = path.basename(agent.prompt.match(/\{file:(.+)\}/)?.[1] ?? "");
      if (file) agent.prompt = `{file:./.opencode/prompts/frontier-loop/${file}}`;
    }
    renderedAgents[destinationId] = agent;
  }
  source.default_agent = roleIds.opencode.coordinator;
  source.agent = renderedAgents;
  const coordinator = source.agent[roleIds.opencode.coordinator];
  if (coordinator?.permission) {
    coordinator.permission.task = {
      "*": "deny",
      ...Object.fromEntries(
        PRESET_ROLES
          .filter((role) => role !== "coordinator")
          .map((role) => [roleIds.opencode[role], "allow"]),
      ),
    };
  }
  const artifacts = [{
    path: "opencode.json",
    content: Buffer.from(`${JSON.stringify(source, null, 2)}\n`),
  }];
  const promptsRoot = path.join(assetsRoot, "configs", "opencode", "prompts");
  for (const file of await listFiles(promptsRoot)) {
    artifacts.push({
      path: toPosixPath(path.posix.join(".opencode/prompts/frontier-loop", path.relative(promptsRoot, file))),
      content: await readFile(file),
    });
  }
  return artifacts;
}

export function activePresetState(resolved, roleIds, overrides = []) {
  const activeRoleIds = structuredClone(roleIds);
  const activeOverrides = structuredClone(overrides);
  const value = {
    id: resolved.id,
    source: resolved.source,
    fingerprint: resolved.fingerprint,
    stability: resolved.stability,
    status: "active",
    roleIds: activeRoleIds,
    overrides: activeOverrides,
    roles: resolved.roles,
  };
  const fallback = resolved.fallbacks?.codexChildModelRefusal;
  if (fallback) {
    const blockedByPreservedDelegateState = activeOverrides.some(
      (override) => override.target === fallback.delegateTarget,
    );
    const blockedByPreservedCodexState = activeOverrides.some(overrideBlocksCodexFallback);
    if (
      activeRoleIds.codex
      && activeRoleIds.opencode
      && !blockedByPreservedDelegateState
      && !blockedByPreservedCodexState
    ) {
      const brokerRoleId = activeRoleIds.broker?.codexChildModelRefusal ?? PREFERRED_BROKER_ROLE_ID;
      activeRoleIds.broker ??= {};
      activeRoleIds.broker.codexChildModelRefusal = brokerRoleId;
      value.fallbacks = {
        codexChildModelRefusal: {
          brokerRoleId,
          brokerModel: structuredClone(fallback.brokerModel),
          roles: [...fallback.roles],
          delegateTarget: fallback.delegateTarget,
          delegateRoles: Object.fromEntries(fallback.roles.map((role) => [
            role,
            {
              roleId: activeRoleIds.opencode[role],
              model: resolved.roles[role].targets.opencode,
              variant: resolved.roles[role].reasoningEffort,
            },
          ])),
        },
      };
    } else {
      delete activeRoleIds.broker;
      if (!blockedByPreservedDelegateState && !blockedByPreservedCodexState) {
        activeOverrides.push({
          target: "fallback",
          path: ".agentic/config.json",
          pointer: "/execution/preset/fallbacks/codexChildModelRefusal",
          current: null,
          requested: "codex-to-opencode",
          reason: "fallback requires both codex and opencode agent targets",
        });
      }
    }
  }
  value.status = activeOverrides.length > 0 ? "partial" : "active";
  return value;
}

export function modelRoutingYaml(resolved, state) {
  const lines = [
    "schema_version: 2",
    `preset: ${resolved.id}`,
    `preset_source: ${resolved.source}`,
    `preset_fingerprint: ${resolved.fingerprint}`,
    `status: ${state.status}`,
    "roles:",
  ];
  for (const role of PRESET_ROLES) {
    const route = resolved.roles[role];
    lines.push(`  ${role}:`);
    lines.push(`    alias: ${route.alias}`);
    lines.push(`    reasoning_effort: ${route.reasoningEffort}`);
    lines.push("    targets:");
    for (const [target, model] of Object.entries(route.targets)) lines.push(`      ${target}: ${model}`);
  }
  const fallback = state.fallbacks?.codexChildModelRefusal;
  if (fallback) {
    lines.push("fallbacks:");
    lines.push("  codex_child_model_refusal:");
    lines.push(`    broker_role_id: ${fallback.brokerRoleId}`);
    lines.push("    broker_model:");
    lines.push(`      alias: ${fallback.brokerModel.alias}`);
    lines.push(`      target: ${fallback.brokerModel.target}`);
    lines.push(`      model: ${fallback.brokerModel.model}`);
    lines.push(`      reasoning_effort: ${fallback.brokerModel.reasoningEffort}`);
    lines.push(`    eligible_roles: [${fallback.roles.join(", ")}]`);
    lines.push(`    delegate_target: ${fallback.delegateTarget}`);
    lines.push("    delegate_roles:");
    for (const role of fallback.roles) {
      const delegate = fallback.delegateRoles[role];
      lines.push(`      ${role}:`);
      lines.push(`        role_id: ${delegate.roleId}`);
      lines.push(`        model: ${delegate.model}`);
      lines.push(`        variant: ${delegate.variant}`);
    }
  }
  lines.push("concurrency:");
  lines.push("  max_subagents: 3");
  lines.push("  default_writers: 1");
  lines.push("  lane_3_writers: 1");
  lines.push("landing: serial");
  return `${lines.join("\n")}\n`;
}
