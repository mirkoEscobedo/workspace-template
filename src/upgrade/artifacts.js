import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  exists,
  hashBuffer,
  hashFile,
  normalizeTextLineEndings,
} from "../fs-utils.js";
import { PACKAGE_VERSION } from "../constants.js";
import { loadPresetCatalog } from "../presets/catalog.js";
import { buildPresetPlan } from "../presets/plan.js";
import {
  agenticReadme,
  createAgenticConfig,
  dependencyNote,
  policyArtifacts,
  presetCatalogArtifacts,
  scriptArtifacts,
  workspaceStateArtifacts,
} from "../workspace-artifacts.js";
import { createProfile, profileSchema } from "../profile.js";
import { planSkillUpgrade } from "./skills.js";
import { commandsFor, generateAgentsMd, generateManagedAgentsBlock } from "../agents-md.js";
import { isHostBundlePath } from "../host-bundles.js";
import { inspectManagedBlock, upsertManagedBlock } from "../managed-sections.js";
import { loadEffectiveUpgradeWorkspace } from "./workspace.js";

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function current(root, relative) {
  const file = path.join(root, ...relative.split("/"));
  return (await exists(file)) ? readFile(file) : undefined;
}

function operation(relative, content, existing) {
  const buffer = normalizeTextLineEndings(Buffer.isBuffer(content) ? content : Buffer.from(content));
  const proposedHash = hashBuffer(buffer);
  const currentHash = existing ? hashBuffer(existing) : null;
  if (currentHash === proposedHash) return { kind: "noop", path: relative, currentHash, proposedHash };
  return {
    kind: existing ? "update-upgrade-managed" : "create-upgrade-managed",
    path: relative,
    currentHash,
    proposedHash,
    contentEncoding: "base64",
    content: buffer.toString("base64"),
  };
}

function uniqueOperations(operations) {
  const byPath = new Map();
  for (const item of operations) byPath.set(item.path, item);
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function rootCommands(workspace, project, packageManager) {
  const module = workspace?.modules?.find((item) => item.path === ".") ?? workspace?.rootModule;
  const scripts = new Set(module?.commands?.scripts ?? []);
  const defaults = commandsFor(project, packageManager);
  const has = (...names) => names.some((name) => scripts.has(name));
  return {
    setup: defaults.setup,
    dev: has("dev") ? defaults.dev : undefined,
    targeted: has("test") ? defaults.targeted : undefined,
    test: has("test") ? defaults.test : undefined,
    typecheck: has("typecheck", "type-check", "check:types", "types") ? defaults.typecheck : undefined,
    lint: has("lint") ? defaults.lint : undefined,
    format: has("format") ? defaults.format : undefined,
    full: module?.commands?.full,
  };
}

async function managedWorkspaceArtifacts(snapshot, config, discoveredWorkspace) {
  const effectiveWorkspace = await loadEffectiveUpgradeWorkspace(snapshot.root, discoveredWorkspace);
  if (!effectiveWorkspace?.modules?.length) return [];
  const context = {
    projectName: path.basename(snapshot.root),
    project: config.project,
    style: config.style,
    tdd: config.tdd,
    packageManager: config.packageManager,
    commands: snapshot.mode === "generated"
      ? commandsFor(config.project, config.packageManager)
      : rootCommands(effectiveWorkspace, config.project, config.packageManager),
    workspace: effectiveWorkspace,
  };
  const artifacts = await workspaceStateArtifacts(effectiveWorkspace, context, { nestedInstructions: "auto" });
  const rootOwnership = snapshot.managed.files?.["AGENTS.md"];
  const existingRoot = await current(snapshot.root, "AGENTS.md");
  if (existingRoot && !rootOwnership) {
    return artifacts;
  }
  if (existingRoot && rootOwnership?.mode === "managed-section") {
    artifacts.push({
      path: "AGENTS.md",
      content: Buffer.from(upsertManagedBlock(existingRoot.toString("utf8"), generateManagedAgentsBlock(context))),
      ownershipMode: "managed-section",
    });
  } else if (existingRoot && rootOwnership?.mode === "proposal") {
    artifacts.push({ path: "AGENTS.md", content: existingRoot, ownershipMode: "proposal" });
  } else {
    artifacts.push({
      path: "AGENTS.md",
      content: Buffer.from(generateAgentsMd({ ...context, mode: snapshot.mode })),
      ownershipMode: "managed",
    });
  }
  return artifacts;
}

export async function planUpgradeArtifacts(snapshot, options = {}) {
  const preserveHostBundles = snapshot.config.hostBundles === "preserve";
  const catalog = await loadPresetCatalog(snapshot.root, { preferPackageBuiltIns: true });
  const legacySplit = snapshot.config.execution?.coordinator?.model === "gpt-5.6-sol"
    && snapshot.config.execution?.planner?.model === "gpt-5.6-sol"
    && snapshot.config.execution?.workers?.model === "gpt-5.3-codex";
  const presetId = options.presetExplicit
    ? options.preset
    : snapshot.config.execution?.preset?.id ?? (legacySplit ? "sol-codex" : options.preset ?? "sol-only");
  const presetPlan = await buildPresetPlan(snapshot.root, {
    ...options,
    mode: snapshot.mode,
    preset: presetId,
    catalog,
  });
  const presetState = presetPlan.metadata.preset;
  const presetConfigOperation = presetPlan.operations.find((item) => item.path === ".agentic/config.json" && item.content);
  const presetProfileOperation = presetPlan.operations.find((item) => item.path === ".agentic/profile.json" && item.content);
  const presetManagedOperation = presetPlan.operations.find((item) => item.path === ".agentic/managed-files.json" && item.content);
  const presetConfig = presetConfigOperation
    ? JSON.parse(Buffer.from(presetConfigOperation.content, "base64").toString("utf8"))
    : structuredClone(snapshot.config);
  const originTimestamp = snapshot.mode === "adopted" ? snapshot.config.adoptedAt : snapshot.config.createdAt;
  const config = {
    ...createAgenticConfig({
      mode: snapshot.mode,
      project: snapshot.config.project,
      style: snapshot.config.style,
      tdd: snapshot.config.tdd,
      packageManager: snapshot.config.packageManager,
      agents: snapshot.config.agentTargets ?? snapshot.profile.agentTargets ?? [],
      originalTimestamp: originTimestamp,
      docs: snapshot.config.features?.durableAgentDocs ?? true,
      tickets: snapshot.config.features?.ticketContracts ?? true,
      presetState,
      hostBundles: snapshot.config.hostBundles ?? "managed",
    }),
    ...presetConfig,
  };
  config.hostBundles = preserveHostBundles ? "preserve" : "managed";
  config.version = 3;
  config.generatorVersion = PACKAGE_VERSION;
  config.mode = snapshot.mode;
  const presetProfile = presetProfileOperation
    ? JSON.parse(Buffer.from(presetProfileOperation.content, "base64").toString("utf8"))
    : structuredClone(snapshot.profile);
  const profileBase = createProfile({
      project: config.project,
      style: config.style,
      tdd: config.tdd,
      agents: config.agentTargets ?? [],
      mode: snapshot.mode,
      presetState,
    });
  const profile = {
    ...profileBase,
    ...presetProfile,
  };
  if (snapshot.profile.version < 2 || typeof profile.architecture !== "object" || profile.architecture === null) {
    profile.architecture = profileBase.architecture;
  }
  profile.version = 2;
  profile.mode = snapshot.mode;
  const baseArtifacts = [
    { path: ".agentic/README.md", content: agenticReadme(snapshot.mode) },
    { path: ".agentic/dependency-snapshot.md", content: dependencyNote(config.project) },
    { path: ".agentic/profile.schema.json", content: jsonBuffer(profileSchema()) },
    ...(await presetCatalogArtifacts()),
    ...(await scriptArtifacts()),
    ...(await policyArtifacts(catalog.byId.get(presetId) ? {
      id: presetState.id,
      roles: presetState.roles,
    } : presetState, presetState)).filter((item) => item.path !== ".agentic/policies/model-routing.yaml"),
  ];
  const operations = [];
  for (const item of presetPlan.operations.filter((entry) => (
    entry.path !== ".agentic/managed-files.json"
      && (!preserveHostBundles || !isHostBundlePath(entry.path))
  ))) {
    const normalizedItem = item.content
      ? {
          ...item,
          content: normalizeTextLineEndings(Buffer.from(item.content, item.contentEncoding ?? "base64")).toString("base64"),
        }
      : item;
    if (normalizedItem.content) {
      normalizedItem.proposedHash = hashBuffer(Buffer.from(normalizedItem.content, normalizedItem.contentEncoding ?? "base64"));
    }
    const record = snapshot.managed.files?.[normalizedItem.path];
    const structured = snapshot.managed.settings?.[normalizedItem.path];
    const identityFile = [".agentic/config.json", ".agentic/profile.json"].includes(normalizedItem.path);
    if (!identityFile && !structured && normalizedItem.currentHash && (!record?.hash || record.hash !== normalizedItem.currentHash)) {
      operations.push({ ...normalizedItem, kind: "blocked-drift", content: undefined, contentEncoding: undefined });
    } else {
      operations.push(normalizedItem);
    }
  }
  operations.push(operation(".agentic/config.json", jsonBuffer(config), await current(snapshot.root, ".agentic/config.json")));
  operations.push(operation(".agentic/profile.json", jsonBuffer(profile), await current(snapshot.root, ".agentic/profile.json")));
  for (const artifact of baseArtifacts) {
    if (artifact.path.startsWith(".agentic/presets/local/")) continue;
    const existing = await current(snapshot.root, artifact.path);
    const ownership = snapshot.managed.files?.[artifact.path];
    if (existing && !ownership) {
      operations.push({ kind: "blocked-drift", path: artifact.path, currentHash: hashBuffer(existing), proposedHash: hashBuffer(Buffer.from(artifact.content)) });
      continue;
    }
    if (existing && ownership?.hash && await hashFile(path.join(snapshot.root, ...artifact.path.split("/"))) !== ownership.hash) {
      operations.push({ kind: "blocked-drift", path: artifact.path, currentHash: hashBuffer(existing), proposedHash: hashBuffer(Buffer.from(artifact.content)) });
      continue;
    }
    operations.push(operation(artifact.path, artifact.content, existing));
  }
  for (const [relative, ownership] of Object.entries(snapshot.managed.files ?? {})) {
    if (preserveHostBundles && isHostBundlePath(relative)) continue;
    if (!relative.startsWith(".codex/agents/") && !relative.startsWith(".opencode/prompts/")) continue;
    const existing = await current(snapshot.root, relative);
    if (existing && ownership.hash && hashBuffer(existing) !== ownership.hash) {
      operations.push({ kind: "blocked-drift", path: relative, currentHash: hashBuffer(existing), proposedHash: ownership.hash });
    }
  }
  const skills = await planSkillUpgrade(snapshot, { ...options, preserveHostBundles });
  operations.push(...skills.operations);
  const workspaceArtifacts = await managedWorkspaceArtifacts(snapshot, config, options.workspace);
  const ownershipModes = new Map();
  const managedBlockHashes = new Map();
  for (const artifact of workspaceArtifacts) {
    const existing = await current(snapshot.root, artifact.path);
    const ownership = snapshot.managed.files?.[artifact.path];
    ownershipModes.set(artifact.path, artifact.ownershipMode ?? ownership?.mode ?? "managed");
    if (existing && ownership?.mode === "managed-section") {
      const block = inspectManagedBlock(existing.toString("utf8"));
      const currentBlockHash = block.state === "valid" ? hashBuffer(Buffer.from(block.body)) : null;
      const trustedBlockHash = ownership.managedBlockHash
        ?? (ownership.hash === hashBuffer(existing) ? currentBlockHash : null);
      if (!trustedBlockHash || currentBlockHash !== trustedBlockHash) {
        operations.push({
          kind: "blocked-drift",
          path: artifact.path,
          currentHash: hashBuffer(existing),
          proposedHash: hashBuffer(Buffer.from(artifact.content)),
        });
        continue;
      }
      const proposedBlock = inspectManagedBlock(Buffer.from(artifact.content).toString("utf8"));
      if (proposedBlock.state === "valid") managedBlockHashes.set(artifact.path, hashBuffer(Buffer.from(proposedBlock.body)));
    }
    if (existing && ownership?.mode !== "managed-section"
      && (!ownership?.hash || ownership.hash !== hashBuffer(existing))) {
      operations.push({
        kind: "blocked-drift",
        path: artifact.path,
        currentHash: hashBuffer(existing),
        proposedHash: hashBuffer(Buffer.from(artifact.content)),
      });
      continue;
    }
    operations.push(operation(artifact.path, artifact.content, existing));
  }
  const desiredOwnedPaths = new Set(operations.map((item) => item.path));
  const obsoletePrefixes = [
    ".agentic/scripts/",
    ".agentic/policies/",
    ".agentic/presets/builtin/",
    ".codex/agents/",
    ".opencode/prompts/",
    ".agentic/modules/",
  ];
  for (const [relative, ownership] of Object.entries(snapshot.managed.files ?? {})) {
    if (preserveHostBundles && isHostBundlePath(relative)) continue;
    if (!obsoletePrefixes.some((prefix) => relative.startsWith(prefix)) || desiredOwnedPaths.has(relative)) continue;
    const existing = await current(snapshot.root, relative);
    if (!existing) continue;
    if (ownership.hash && ownership.hash === hashBuffer(existing)) operations.push({ kind: "delete-upgrade-managed", path: relative, currentHash: ownership.hash, proposedHash: null });
    else operations.push({ kind: "blocked-drift", path: relative, currentHash: hashBuffer(existing), proposedHash: null });
  }
  const conflicts = [...skills.conflicts];
  for (const item of operations.filter((entry) => entry.kind === "blocked-drift")) conflicts.push(`Managed file drift blocks upgrade: ${item.path}`);

  const beforeManifest = uniqueOperations(operations);
  const managed = presetManagedOperation
    ? JSON.parse(Buffer.from(presetManagedOperation.content, "base64").toString("utf8"))
    : structuredClone(snapshot.managed);
  managed.version = 3;
  managed.generator = "workspace-template";
  managed.generatorVersion = PACKAGE_VERSION;
  managed.files ??= {};
  for (const relative of Object.keys(managed.files)) {
    if (relative.startsWith("docs/agent/") || relative.startsWith("docs/tickets/") || relative.startsWith(".agentic/presets/local/")
      || (preserveHostBundles && isHostBundlePath(relative))) {
      delete managed.files[relative];
    }
  }
  if (preserveHostBundles && managed.settings) {
    for (const relative of Object.keys(managed.settings)) {
      if (isHostBundlePath(relative)) delete managed.settings[relative];
    }
  }
  for (const item of beforeManifest) {
    if (item.kind === "delete-upgrade-managed") {
      delete managed.files[item.path];
      continue;
    }
    if (!item.proposedHash || item.kind === "blocked-drift") continue;
    if (managed.settings?.[item.path]) continue;
    managed.files[item.path] = {
      mode: ownershipModes.get(item.path) ?? snapshot.managed.files?.[item.path]?.mode ?? "managed",
      hash: item.proposedHash,
    };
    if (managed.files[item.path].mode === "managed-section") {
      managed.files[item.path].managedBlockHash = managedBlockHashes.get(item.path)
        ?? snapshot.managed.files?.[item.path]?.managedBlockHash;
    }
  }
  managed.files = Object.fromEntries(Object.entries(managed.files).sort(([left], [right]) => left.localeCompare(right)));
  operations.push(operation(".agentic/managed-files.json", jsonBuffer(managed), await current(snapshot.root, ".agentic/managed-files.json")));
  return { operations: uniqueOperations(operations), conflicts, presetState };
}
