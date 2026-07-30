import path from "node:path";
import { PACKAGE_VERSION } from "../constants.js";
import { repositoryPreconditions } from "../plans/fingerprint.js";
import { createPlanEnvelope } from "../plans/schema.js";
import { assertSafeUpgradePath, inspectUpgradeWorkspace } from "./inspect.js";
import { planUpgradeArtifacts } from "./artifacts.js";
import { hashManagedAssetCatalog } from "../workspace-artifacts.js";
import { exists, hashFile, readJson, toPosixPath } from "../fs-utils.js";
import { discoverWorkspace } from "../workspace/discover.js";
import { loadEffectiveUpgradeWorkspace } from "./workspace.js";
import {
  normalizedVerificationPaths,
  sealVerificationInputSet,
} from "./verification-inputs.js";

function versionPart(value) {
  return String(value ?? "legacy").replace(/[^a-zA-Z0-9._-]+/g, "-");
}

const FORBIDDEN_VERIFICATION_EFFECT = /\b(?:curl|npx|scp|ssh|wget)\b|\bgit\s+(?:clone|fetch|pull|push)\b|\b(?:npm|pnpm|yarn|bun)\s+(?:add|ci|install|publish|remove)\b|\b(?:firebase\s+deploy|helm\s+install|kubectl\s+apply|netlify|vercel)\b/iu;
function normalizedPaths(paths) {
  return normalizedVerificationPaths(paths);
}

function isAtOrBelow(relative, candidates) {
  return candidates.some((candidate) => relative === candidate || relative.startsWith(`${candidate}/`));
}

export async function sealVerificationInputs(root, excludedPaths = [], options = {}) {
  const resolvedRoot = path.resolve(root);
  const excluded = normalizedPaths(excludedPaths);
  const sealed = await sealVerificationInputSet(resolvedRoot, excluded, options);
  const result = {
    algorithm: "sha256",
    hash: sealed.hash,
    excludedPaths: excluded,
    ignoredPaths: sealed.ignoredPaths,
  };
  if (sealed.unsupportedGitlinks.length > 0) {
    result.unsupportedGitlinks = sealed.unsupportedGitlinks;
  }
  if (sealed.unsupportedEmbeddedRepositories.length > 0) {
    result.unsupportedEmbeddedRepositories = sealed.unsupportedEmbeddedRepositories;
  }
  if (options.includeInventory) result.inventoryPaths = sealed.paths;
  return result;
}

async function verificationAuthorityEntry(root, module) {
  const manifestPath = module.manifest ? path.join(root, ...module.manifest.split("/")) : undefined;
  const violations = [];
  let dependencyInstall = null;
  const commandText = (module.commands?.fullSteps ?? [])
    .map((step) => [step.command, ...(step.args ?? [])].join(" "))
    .join("\n");
  if (FORBIDDEN_VERIFICATION_EFFECT.test(commandText)) {
    violations.push(`${module.id} verification command requests an unauthorized remote, dependency, publish, or deploy effect`);
  }
  if (manifestPath && module.project && ["javascript", "typescript", "react"].includes(module.project) && await exists(manifestPath)) {
    const manifest = await readJson(manifestPath);
    const dependencySections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
      .filter((section) => manifest[section] && Object.keys(manifest[section]).length > 0);
    const localBinScripts = [];
    const selectedScripts = new Set();
    for (const step of module.commands?.fullSteps ?? []) {
      const runIndex = step.args?.[0] === "run" ? 1 : 0;
      if (step.args?.[runIndex]) selectedScripts.add(step.args[runIndex]);
    }
    const pending = [...selectedScripts];
    while (pending.length > 0) {
      const name = pending.pop();
      const body = manifest.scripts?.[name];
      if (typeof body !== "string") continue;
      if (/\bnode_modules[\\/]\.bin[\\/]/iu.test(body)) localBinScripts.push(name);
      if (FORBIDDEN_VERIFICATION_EFFECT.test(body)) {
        violations.push(`${module.id} verification script '${name}' requests an unauthorized remote, dependency, publish, or deploy effect`);
      }
      for (const match of body.matchAll(/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([a-zA-Z0-9:_-]+)/gu)) {
        if (manifest.scripts?.[match[1]] && !selectedScripts.has(match[1])) {
          selectedScripts.add(match[1]);
          pending.push(match[1]);
        }
      }
    }
    if (dependencySections.length > 0 || localBinScripts.length > 0) {
      const evidence = [
        dependencySections.length > 0 ? `manifest declares ${dependencySections.join(", ")}` : null,
        localBinScripts.length > 0 ? `sealed script(s) ${[...new Set(localBinScripts)].sort().join(", ")} reference node_modules/.bin` : null,
      ].filter(Boolean).join("; ");
      if (module.packageManager === "npm") {
        const cwd = module.lockOwner ?? module.path;
        const hasLockfile = await exists(path.join(root, ...cwd.split("/"), "package-lock.json"));
        dependencyInstall = {
          command: "npm",
          args: [hasLockfile ? "ci" : "install", "--ignore-scripts"],
          cwd,
        };
      } else {
        violations.push(`${module.id} dependency-backed verification uses unsupported package manager '${module.packageManager}' (${evidence})`);
      }
    }
  }
  return {
    id: module.id,
    path: module.path,
    manifest: module.manifest ?? null,
    manifestHash: manifestPath && await exists(manifestPath) ? await hashFile(manifestPath) : null,
    fullSteps: module.commands?.fullSteps ?? [],
    dependencyInstall,
    authorityViolations: violations,
  };
}

export async function upgradeVerificationAuthority(root, workspace) {
  return {
    modules: await Promise.all(workspace.modules.map((module) => verificationAuthorityEntry(root, module))),
    root: workspace.rootModule ? await verificationAuthorityEntry(root, workspace.rootModule) : null,
  };
}

export function assertLocalVerificationAuthority(authority) {
  const violations = [...authority.modules, authority.root].filter(Boolean)
    .flatMap((entry) => entry.authorityViolations ?? []);
  if (violations.length > 0) throw new Error(`Upgrade verification exceeds local authority:\n- ${violations.join("\n- ")}`);
}

export function upgradeVerificationPlatformConflict(platform = process.platform) {
  return platform === "win32"
    ? null
    : "POSIX upgrade verification cannot contain detached-session descendants without a native process owner";
}

export function defaultUpgradePlanPath(plan) {
  const upgrade = plan.metadata.upgrade;
  return `.agentic/plans/upgrades/upgrade-${versionPart(upgrade.fromVersion)}-to-${versionPart(upgrade.toVersion)}-${plan.planId.slice(0, 12)}.json`;
}

export async function buildUpgradePlan(rootDirectory, options = {}) {
  const snapshot = await inspectUpgradeWorkspace(rootDirectory, { reportRecovery: options.dryRun });
  if (snapshot.recoveryRequired) {
    return createPlanEnvelope({
      command: "upgrade",
      root: snapshot.root,
      operations: [],
      preconditions: [{ kind: "root", value: snapshot.root }],
      conflicts: [snapshot.recoveryRequired],
      metadata: {
        incomingCatalogHash: await hashManagedAssetCatalog(),
        upgrade: {
          fromVersion: "interrupted",
          toVersion: PACKAGE_VERSION,
          mode: "unknown",
          status: "recovery-required",
          operationCount: 0,
        },
      },
    });
  }
  const discoveredWorkspace = await discoverWorkspace(snapshot.root, { workspace: "all", includeRootModule: true, includeOpaque: true });
  const workspace = await loadEffectiveUpgradeWorkspace(snapshot.root, discoveredWorkspace, { mergeDiscovered: true });
  const desired = await planUpgradeArtifacts(snapshot, { ...options, workspace });
  const verificationCommands = await upgradeVerificationAuthority(snapshot.root, workspace);
  for (const operation of desired.operations) await assertSafeUpgradePath(snapshot.root, operation.path);
  const fingerprintPaths = [
    ".agentic/config.json",
    ".agentic/profile.json",
    ".agentic/managed-files.json",
    ".agentic/skills.lock.json",
    ".agentic/skills",
    ".agentic/skill-baselines",
    ".agentic/managed-projections.json",
    ".agentic/presets/builtin",
    ".agentic/presets/local",
    ...desired.operations.map((item) => item.path),
  ];
  const effective = desired.operations.filter((item) => item.kind !== "noop");
  const verificationInputPaths = normalizedPaths(
    [...verificationCommands.modules, verificationCommands.root]
      .filter(Boolean)
      .map((entry) => entry.manifest)
      .filter(Boolean),
  );
  const verificationInputs = await sealVerificationInputs(
    snapshot.root,
    desired.operations.map((item) => item.path),
  );
  const preconditions = await repositoryPreconditions(snapshot.root, [...new Set(fingerprintPaths)], { allowDirty: options.allowDirty });
  const dirty = preconditions.find((item) => item.kind === "git-dirty")?.value ?? [];
  const conflicts = [...desired.conflicts];
  for (const gitlink of verificationInputs.unsupportedGitlinks ?? []) {
    conflicts.push(`Git submodule verification input '${gitlink}' cannot be sealed; replace it with ordinary tracked files`);
  }
  for (const embedded of verificationInputs.unsupportedEmbeddedRepositories ?? []) {
    conflicts.push(`Embedded Git repository verification input '${embedded}' cannot be sealed; remove it or track it as ordinary files`);
  }
  if (!workspace.canUse) conflicts.push(...workspace.conflicts);
  for (const module of verificationCommands.modules) {
    if (module.fullSteps.length === 0) conflicts.push(`Missing full verification command for workspace module '${module.id}'`);
    conflicts.push(...module.authorityViolations);
  }
  if (verificationCommands.root && verificationCommands.root.fullSteps.length === 0) {
    conflicts.push("Missing full verification command for workspace root aggregate");
  }
  conflicts.push(...(verificationCommands.root?.authorityViolations ?? []));
  for (const operation of desired.operations) {
    const relative = toPosixPath(operation.path);
    if (isAtOrBelow(relative, verificationInputPaths)) {
      conflicts.push(`Planned operation '${relative}' touches a sealed verification input`);
    }
  }
  const hasVerificationCommands = [...verificationCommands.modules, verificationCommands.root]
    .filter(Boolean)
    .some((entry) => entry.fullSteps.length > 0);
  const platformConflict = upgradeVerificationPlatformConflict(options.platform);
  if (hasVerificationCommands && platformConflict) conflicts.push(platformConflict);
  if (hasVerificationCommands && !options.allowNetwork) {
    conflicts.push("Full verification cannot be portably confined from external filesystem or network effects; review and pass --allow-network to seal that authority");
  }
  if (dirty.length > 0 && !options.allowDirty) conflicts.push("Git working tree is dirty; review it and pass --allow-dirty to seal that exact state");
  return createPlanEnvelope({
    command: "upgrade",
    root: snapshot.root,
    scope: { mode: snapshot.mode, source: "installed-package" },
    preconditions,
    operations: desired.operations,
    approvals: {
      dirtyTree: Boolean(options.allowDirty),
      riskySkillPermissions: Boolean(options.allowRiskyToolChanges),
      skillRemoval: Boolean(options.allowSkillRemoval),
      network: Boolean(options.allowNetwork),
    },
    verification: [{ kind: "doctor", command: ["workspace-template", "doctor", "."] }],
    rollback: { strategy: "durable-file-backup", automatic: true },
    warnings: effective.length === 0 ? ["Workspace is already current."] : [],
    conflicts,
    metadata: {
      upgrade: {
        fromVersion: snapshot.fromVersion,
        toVersion: PACKAGE_VERSION,
        mode: snapshot.mode,
        status: effective.length === 0 && conflicts.length === 0 ? "current" : conflicts.length ? "blocked" : "ready",
        operationCount: effective.length,
      },
      preset: desired.presetState,
      incomingCatalogHash: await hashManagedAssetCatalog(),
      verificationCommands,
      verificationInputs,
      verificationInputPaths,
      sourceSchemas: {
        config: snapshot.config.version,
        profile: snapshot.profile.version,
        managedFiles: snapshot.managed.version,
        skillsLock: snapshot.skillsLock.version,
      },
    },
  });
}
