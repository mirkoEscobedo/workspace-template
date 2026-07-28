import { readFile } from "node:fs/promises";
import path from "node:path";
import { generateAgentsMd, generateManagedAgentsBlock } from "./agents-md.js";
import { PACKAGE_VERSION } from "./constants.js";
import {
  exists,
  hashBuffer,
  hashFile,
  isPathInside,
  readJson,
  toPosixPath,
} from "./fs-utils.js";
import { inspectManagedBlock, upsertManagedBlock } from "./managed-sections.js";
import { isHostBundlePath } from "./host-bundles.js";
import { createPlanEnvelope, refreshPlanId } from "./plans/schema.js";
import { repositoryPreconditions } from "./plans/fingerprint.js";
import { createProfile, profileSchema } from "./profile.js";
import { DEFAULT_PRESET_ID, LEGACY_PRESET_ID, selectPreset } from "./presets/catalog.js";
import { activePresetState, resolveRoleIds } from "./presets/render.js";
import { ticketRetrofitArtifacts } from "./retrofit-tickets.js";
import {
  agenticReadme,
  architectureNote,
  canonicalSkillArtifacts,
  createAgenticConfig,
  dependencyNote,
  disabledProjectionArtifact,
  harnessArtifacts,
  policyArtifacts,
  presetCatalogArtifacts,
  projectMemoryArtifacts,
  projectionArtifacts,
  scriptArtifacts,
  skillBaselineArtifacts,
  skillLock,
  workspaceStateArtifacts,
} from "./workspace-artifacts.js";

const WRITE_ACTIONS = new Set(["create", "update-managed", "merge-managed-block", "propose"]);
const STRICT_PREFIXES = [
  ".agentic/skills/",
  ".agentic/skill-baselines/",
  ".agents/skills/",
  ".claude/skills/",
  ".github/skills/",
  ".opencode/skills/",
  ".gemini/skills/",
];
const PRESERVE_PREFIXES = ["docs/agent/", "docs/tickets/", ".agent/"];
const HARNESS_PREFIXES = [".codex/", ".opencode/prompts/", "opencode.json"];
export { isHostBundlePath } from "./host-bundles.js";

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function contentBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
}

function encodeContent(buffer) {
  return buffer.toString("base64");
}

function operationBase(relativePath, content, reason) {
  const buffer = contentBuffer(content);
  return {
    path: toPosixPath(relativePath),
    proposedHash: hashBuffer(buffer),
    contentEncoding: "base64",
    content: encodeContent(buffer),
    reason,
    blocking: false,
  };
}

function isStrictPath(relativePath) {
  return STRICT_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

function isPreservePath(relativePath) {
  return PRESERVE_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

function isHarnessPath(relativePath) {
  return HARNESS_PREFIXES.some((prefix) => relativePath === prefix || relativePath.startsWith(prefix));
}

function proposalPath(relativePath) {
  return toPosixPath(path.posix.join(".agentic/proposals", relativePath));
}

async function loadOwnership(root) {
  let config;
  let managed = { files: {} };
  let skillLockValue = { skills: {} };
  const configPath = path.join(root, ".agentic", "config.json");
  const managedPath = path.join(root, ".agentic", "managed-files.json");
  const skillLockPath = path.join(root, ".agentic", "skills.lock.json");
  if (await exists(configPath)) {
    try { config = await readJson(configPath); } catch { config = undefined; }
  }
  if (await exists(managedPath)) {
    try { managed = await readJson(managedPath); } catch { managed = { files: {} }; }
  }
  if (await exists(skillLockPath)) {
    try { skillLockValue = await readJson(skillLockPath); } catch { skillLockValue = { skills: {} }; }
  }
  return { config, managed, skillLock: skillLockValue };
}

function isGeneratorOwned(relativePath, currentHash, ownership) {
  const record = ownership.managed?.files?.[relativePath];
  if (record?.hash && record.hash === currentHash) return true;
  if (record?.mode === "managed" || record?.mode === "managed-section" || record?.mode === "proposal") {
    return record.hash === undefined || record.hash === currentHash;
  }

  if (ownership.config?.generator === "workspace-template") {
    if (relativePath.startsWith(".agentic/") && !relativePath.startsWith(".agentic/skills/")) return true;
    if ([".codex/config.toml", ".codex/hooks.json", "opencode.json"].includes(relativePath)) return true;
  }

  const skillMatch = /^\.agentic\/skills\/([^/]+)\/(.+)$/.exec(relativePath);
  if (skillMatch) {
    const fileRecord = ownership.skillLock?.skills?.[skillMatch[1]]?.files?.[skillMatch[2]];
    return Boolean(fileRecord?.baselineHash && fileRecord.baselineHash === currentHash);
  }
  return false;
}

async function classifyArtifact(root, artifact, ownership, conflictMode) {
  const relativePath = toPosixPath(artifact.path);
  const destination = path.join(root, ...relativePath.split("/"));
  if (!isPathInside(root, destination)) {
    return { ...operationBase(relativePath, artifact.content, "path escapes repository root"), action: "conflict", blocking: true };
  }

  const desired = contentBuffer(artifact.content);
  const base = operationBase(relativePath, desired, artifact.reason ?? "install Frontier Loop artifact");
  if (!(await exists(destination))) return { ...base, action: "create", currentHash: null, ownership: "generator" };

  const currentHash = await hashFile(destination);
  if (currentHash === base.proposedHash) {
    return { ...base, action: "noop", currentHash, ownership: isStrictPath(relativePath) ? "adopt-identical" : "generator-or-identical" };
  }

  if (isGeneratorOwned(relativePath, currentHash, ownership)) {
    return { ...base, action: "update-managed", currentHash, ownership: "generator" };
  }

  if (isPreservePath(relativePath)) {
    return {
      path: relativePath,
      action: "preserve",
      currentHash,
      proposedHash: base.proposedHash,
      reason: "existing repository documentation or local state is preserved",
      ownership: "user",
      blocking: false,
    };
  }

  if (isStrictPath(relativePath)) {
    return {
      path: relativePath,
      action: "conflict",
      currentHash,
      proposedHash: base.proposedHash,
      reason: relativePath.startsWith(".agentic/skills/")
        ? "unmanaged divergent canonical skill collision"
        : "unmanaged divergent projected skill collision",
      ownership: "user",
      blocking: true,
    };
  }

  if (conflictMode === "fail") {
    return {
      path: relativePath,
      action: "conflict",
      currentHash,
      proposedHash: base.proposedHash,
      reason: "unmanaged file differs and conflict policy is fail",
      ownership: "user",
      blocking: true,
    };
  }

  // Structured harness/config files are never edited by a text managed-block policy.
  if (conflictMode === "propose" || conflictMode === "managed-block" || isHarnessPath(relativePath)) {
    const proposedPath = proposalPath(relativePath);
    const proposed = {
      path: proposedPath,
      content: desired,
      reason: `proposal for preserved custom ${relativePath}`,
    };
    const classified = await classifyArtifact(root, proposed, ownership, "fail");
    if (classified.action === "conflict") {
      return {
        ...classified,
        reason: `proposal path ${proposedPath} is unmanaged and differs; review or remove it before adoption`,
      };
    }
    return { ...classified, action: classified.action === "noop" ? "noop" : "propose", sourcePath: relativePath, ownership: "proposal" };
  }

  return {
    path: relativePath,
    action: "conflict",
    currentHash,
    proposedHash: base.proposedHash,
    reason: "unhandled unmanaged collision",
    ownership: "user",
    blocking: true,
  };
}

async function classifyAgents(root, context, ownership, conflictMode) {
  const relativePath = "AGENTS.md";
  const destination = path.join(root, relativePath);
  const full = generateAgentsMd({ ...context, mode: "adopted" });
  const fullBuffer = Buffer.from(full, "utf8");
  const base = operationBase(relativePath, fullBuffer, "install repository instructions");

  if (!(await exists(destination))) return { ...base, action: "create", currentHash: null, ownership: "generator" };
  const current = await readFile(destination, "utf8");
  const currentHash = hashBuffer(Buffer.from(current));
  if (currentHash === base.proposedHash) return { ...base, action: "noop", currentHash, ownership: "generator-or-identical" };

  if (isGeneratorOwned(relativePath, currentHash, ownership)) {
    return { ...base, action: "update-managed", currentHash, ownership: "generator" };
  }

  const block = inspectManagedBlock(current);
  if (block.state === "invalid") {
    return {
      path: relativePath,
      action: "conflict",
      currentHash,
      proposedHash: base.proposedHash,
      reason: block.reason,
      ownership: "user",
      blocking: true,
    };
  }

  const managedBody = generateManagedAgentsBlock(context);
  if (block.state === "valid" || conflictMode === "managed-block") {
    const merged = upsertManagedBlock(current, managedBody);
    return {
      ...operationBase(relativePath, merged, block.state === "valid" ? "update managed AGENTS.md block" : "append managed AGENTS.md block"),
      action: "merge-managed-block",
      currentHash,
      ownership: "managed-section",
    };
  }

  if (conflictMode === "fail") {
    return {
      path: relativePath,
      action: "conflict",
      currentHash,
      proposedHash: base.proposedHash,
      reason: "custom AGENTS.md has no managed block",
      ownership: "user",
      blocking: true,
    };
  }

  const proposal = `${current.trimEnd()}\n\n${upsertManagedBlock("", managedBody).trim()}\n`;
  const proposedArtifact = {
    path: ".agentic/proposals/AGENTS.md",
    content: Buffer.from(`<!-- GENERATED PROPOSAL BY workspace-template ${PACKAGE_VERSION}; review before applying -->\n${proposal}`),
    reason: "proposal preserves custom AGENTS.md and adds the Frontier Loop managed block",
  };
  const classified = await classifyArtifact(root, proposedArtifact, ownership, "fail");
  if (classified.action === "conflict") return classified;
  return { ...classified, action: classified.action === "noop" ? "noop" : "propose", sourcePath: "AGENTS.md", ownership: "proposal" };
}

async function proposalDispositionArtifact(root, mode) {
  if (mode !== "reject") return undefined;
  const relative = ".agentic/proposals/AGENTS.md";
  const destination = path.join(root, ...relative.split("/"));
  return {
    path: ".agentic/proposal-disposition.json",
    content: jsonBuffer({
      version: 1,
      path: relative,
      status: "rejected",
      hash: await exists(destination) ? await hashFile(destination) : null,
      reason: "repository-owned AGENTS.md remains canonical; generated proposal was explicitly rejected",
    }),
    reason: "record the reviewed AGENTS proposal disposition",
  };
}

async function projectMemoryForAdoption(root, mode) {
  const artifacts = await projectMemoryArtifacts();
  if (mode !== "preserve") return artifacts;
  return Promise.all(artifacts.map(async (artifact) => {
    const destination = path.join(root, ...artifact.path.split("/"));
    return await exists(destination)
      ? { ...artifact, content: await readFile(destination), reason: "preserve reviewed project memory and bind its exact hash" }
      : artifact;
  }));
}

function commandVerification(snapshot, options) {
  const steps = snapshot.commands?.fullSteps ?? [];
  return {
    doctor: true,
    projectCommand: snapshot.commands?.full ?? null,
    projectCommands: steps,
    requested: Boolean(options.verify),
  };
}

function planWarnings(snapshot) {
  const warnings = [
    ...(snapshot.project.warnings ?? []),
    ...(snapshot.packageManager.warnings ?? []),
    ...(snapshot.git.warnings ?? []),
  ];
  if (!snapshot.git.repository) warnings.push("Adoption is allowed without Git, but rollback and auditability are weaker.");
  if (snapshot.ticketTracks.length > 0) warnings.push("Recovered ticket status, risk, conflict, and dependency data is marked UNREVIEWED and must be checked against the live repository.");
  return [...new Set(warnings)];
}

function inferredPresetId(options, config) {
  if (options.presetExplicit) return options.preset;
  if (config?.execution?.preset?.id) return config.execution.preset.id;
  const coordinator = config?.execution?.coordinator?.model;
  const planner = config?.execution?.planner?.model;
  const worker = config?.execution?.workers?.model;
  if (coordinator === "gpt-5.6-sol" && planner === "gpt-5.6-sol" && worker === "gpt-5.3-codex") return LEGACY_PRESET_ID;
  return options.preset ?? DEFAULT_PRESET_ID;
}

async function preservedHarnessOverrides(root, agents, ownership) {
  const overrides = [];
  for (const [agent, relative] of [["codex", ".codex/config.toml"], ["opencode", "opencode.json"]]) {
    if (!agents.includes(agent)) continue;
    const target = path.join(root, ...relative.split("/"));
    if (!(await exists(target))) continue;
    const currentHash = await hashFile(target);
    if (isGeneratorOwned(relative, currentHash, ownership)) continue;
    overrides.push({
      target: agent,
      path: relative,
      pointer: "/",
      current: "<preserved user-owned configuration>",
      requested: "<active preset routing>",
      reason: "existing root harness configuration is preserved; run preset plan/apply to merge non-conflicting settings",
    });
  }
  return overrides;
}

async function desiredArtifacts(snapshot, options, context, selection, roleIds, presetState) {
  const mode = "adopted";
  const config = createAgenticConfig({
    mode,
    project: context.project,
    style: context.style,
    tdd: context.tdd,
    packageManager: context.packageManager,
    agents: context.agents,
    // Deterministic plan; the apply report carries the real timestamp.
    originalTimestamp: null,
    presetState,
    hostBundles: options.hostBundles ?? "managed",
  });
  if ((options.hostBundles ?? "managed") === "preserve") {
    config.projections = {
      mode: "disabled",
      reason: "product-owned host bundles are preserved",
      agentTargets: [...context.agents].sort(),
    };
  }
  const profile = createProfile({ project: context.project, style: context.style, tdd: context.tdd, agents: context.agents, mode, presetState });
  const artifacts = [
    { path: ".agentic/README.md", content: agenticReadme(mode) },
    { path: ".agentic/implementation-profile.md", content: architectureNote({ ...context, mode, presetState }) },
    { path: ".agentic/dependency-snapshot.md", content: dependencyNote(context.project) },
    { path: ".agentic/config.json", content: jsonBuffer(config) },
    { path: ".agentic/profile.json", content: jsonBuffer(profile) },
    { path: ".agentic/profile.schema.json", content: jsonBuffer(profileSchema()) },
    ...(await canonicalSkillArtifacts()),
    ...(await skillBaselineArtifacts()),
    ...(await policyArtifacts(selection.resolved, presetState)),
    ...(await presetCatalogArtifacts()),
    ...(await scriptArtifacts()),
    ...(options.docs === false ? [] : await projectMemoryForAdoption(snapshot.root, options.agentDocs)),
    ...(await harnessArtifacts(context.agents, selection.resolved, roleIds)),
    ...((options.hostBundles ?? "managed") === "preserve"
      ? [await disabledProjectionArtifact(context.agents, "product-owned host bundles are preserved")]
      : await projectionArtifacts(context.agents)),
    ...([await proposalDispositionArtifact(snapshot.root, options.agentsProposal)].filter(Boolean)),
    ...(await workspaceStateArtifacts(snapshot.workspace, context, { nestedInstructions: options.nestedInstructions ?? "auto" })),
    ...(options.tickets === false ? [] : await ticketRetrofitArtifacts(snapshot.root, snapshot.ticketTracks, { ...options, presetState })),
  ];

  artifacts.push({ path: ".agentic/skills.lock.json", content: jsonBuffer(await skillLock()) });
  return artifacts
    .filter((artifact) => options.hostBundles !== "preserve" || !isHostBundlePath(artifact.path))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function buildManagedManifest(operations) {
  const files = {};
  for (const operation of operations) {
    if (!["create", "update-managed", "merge-managed-block", "propose", "noop"].includes(operation.action)) continue;
    if (!operation.proposedHash) continue;
    const record = {
      mode: operation.action === "merge-managed-block" ? "managed-section" : operation.action === "propose" ? "proposal" : "managed",
      hash: operation.proposedHash,
    };
    if (record.mode === "managed-section" && operation.content) {
      const content = Buffer.from(operation.content, operation.contentEncoding ?? "base64").toString("utf8");
      const block = inspectManagedBlock(content);
      if (block.state === "valid") record.managedBlockHash = hashBuffer(Buffer.from(block.body));
    }
    files[operation.path] = record;
  }
  return {
    version: 2,
    generator: "workspace-template",
    generatorVersion: PACKAGE_VERSION,
    files,
  };
}

export async function buildAdoptionPlan(snapshot, options) {
  const context = {
    projectName: path.basename(snapshot.root),
    project: snapshot.project.value,
    style: options.style,
    tdd: options.tdd,
    packageManager: snapshot.packageManager.value,
    commands: snapshot.commands,
    workspace: snapshot.workspace,
    agents: options.agents,
  };
  const ownership = await loadOwnership(snapshot.root);
  const presetId = inferredPresetId(options, ownership.config);
  const selection = await selectPreset(snapshot.root, presetId, context.agents, { allowEmpty: true });
  const roleIds = await resolveRoleIds(snapshot.root, context.agents, ownership.config?.execution?.preset);
  const presetState = activePresetState(
    selection.resolved,
    roleIds,
    await preservedHarnessOverrides(snapshot.root, context.agents, ownership),
  );
  context.preset = presetId;
  context.presetState = presetState;
  const operations = [];

  if (options.agentsProposal === "reject") {
    const destination = path.join(snapshot.root, "AGENTS.md");
    operations.push({
      path: "AGENTS.md",
      action: "preserve",
      currentHash: await hashFile(destination),
      proposedHash: await hashFile(destination),
      reason: "repository-owned AGENTS.md remains canonical; generated proposal explicitly rejected",
      ownership: "user",
      blocking: false,
    });
  } else {
    operations.push(await classifyAgents(snapshot.root, context, ownership, options.conflict));
  }
  for (const artifact of await desiredArtifacts(snapshot, options, context, selection, roleIds, presetState)) {
    operations.push(await classifyArtifact(snapshot.root, artifact, ownership, options.conflict));
  }

  // The ownership manifest is derived after all other operation modes are known.
  const managedArtifact = {
    path: ".agentic/managed-files.json",
    content: jsonBuffer(buildManagedManifest(operations)),
    reason: "record generator ownership and content hashes",
  };
  operations.push(await classifyArtifact(snapshot.root, managedArtifact, ownership, options.conflict));
  operations.sort((left, right) => left.path.localeCompare(right.path));

  const conflictDetails = [];
  if (snapshot.project.blocking) conflictDetails.push({ kind: "project", message: snapshot.project.blocking });
  if (snapshot.packageManager.blocking) conflictDetails.push({ kind: "package-manager", message: snapshot.packageManager.blocking });
  if (snapshot.git.repository && !snapshot.git.targetIsRoot) conflictDetails.push({ kind: "git-root", message: `Target must equal Git root ${snapshot.git.root}.` });
  if (snapshot.git.dirty && !options.allowDirty) conflictDetails.push({ kind: "dirty-tree", message: "Git working tree is dirty; use --allow-dirty only after reviewing the unrelated changes." });
  for (const unsafe of snapshot.unsafeSymlinks) conflictDetails.push({ kind: "unsafe-symlink", message: `${unsafe.path} resolves outside the repository: ${unsafe.resolved}` });
  for (const operation of operations.filter((item) => item.blocking)) conflictDetails.push({ kind: "path", path: operation.path, message: operation.reason });
  const conflicts = conflictDetails.map((conflict) => `${conflict.path ? `${conflict.path}: ` : ""}${conflict.message}`);

  const selected = {
    project: context.project,
    style: context.style,
    tdd: context.tdd,
    packageManager: context.packageManager,
    agentTargets: context.agents,
    docs: options.docs !== false,
    tickets: options.tickets !== false,
    conflict: options.conflict,
    hostBundles: options.hostBundles ?? "managed",
    agentsProposal: options.agentsProposal ?? "propose",
    agentDocs: options.agentDocs ?? "template",
    preset: presetId,
  };
  const preconditions = await repositoryPreconditions(
    snapshot.root,
    Object.keys(snapshot.identityFiles ?? {}),
    { allowDirty: options.allowDirty },
  );
  const base = createPlanEnvelope({
    command: "adopt",
    root: snapshot.root,
    scope: { mode: "repository", ticketTracks: snapshot.ticketTracks.map((track) => track.path) },
    preconditions,
    operations: operations.map((operation) => ({ ...operation, kind: operation.action })),
    approvals: { dirtyTree: options.allowDirty },
    verification: (snapshot.commands?.fullSteps ?? []).map((step, index) => ({
      id: `project-${index + 1}`,
      executable: step.command,
      args: step.args ?? [],
      cwd: ".",
      required: Boolean(options.verify),
    })),
    warnings: planWarnings(snapshot),
    conflicts,
    metadata: {
      adoptionVerification: commandVerification(snapshot, options),
      conflictDetails,
    },
  });
  return refreshPlanId({
    ...base,
    detected: snapshot,
    selected,
    conflictDetails,
  });
}

export function isWriteOperation(operation) {
  return WRITE_ACTIONS.has(operation.action ?? operation.kind);
}

export function decodeOperationContent(operation) {
  if (!operation.content) throw new Error(`Operation ${operation.path} has no content`);
  if (operation.contentEncoding !== "base64") throw new Error(`Unsupported content encoding for ${operation.path}`);
  return Buffer.from(operation.content, "base64");
}
