import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { rm } from "node:fs/promises";
import { commandExists, resolveProcessIdentity, runCommandAsync } from "../process-utils.js";
import { ensureDirectory, writeJson } from "../fs-utils.js";
import { includeDependents, owningModules, changedPathsFromGit } from "./affected.js";
import { discoverWorkspace } from "./discover.js";
import { topologicalLevels } from "./graph.js";

const VERIFICATION_ENVIRONMENT_KEYS = new Set([
  "APPDATA", "CI", "COLORTERM", "COMSPEC", "HOME", "LANG", "LC_ALL",
  "LOCALAPPDATA", "NUMBER_OF_PROCESSORS", "OS", "PATH", "PATHEXT",
  "PROCESSOR_ARCHITECTURE", "PROGRAMDATA", "PROGRAMFILES",
  "PROGRAMFILES(X86)", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "TERM",
  "TMP", "TMPDIR", "USERPROFILE", "WINDIR",
]);
const SENSITIVE_ENVIRONMENT_KEY = /(?:AUTH|BEARER|COOKIE|CREDENTIAL|KEY|PASS|PWD|SECRET|TOKEN)/iu;

export function sanitizeVerificationEnvironment(environment = process.env) {
  const env = {};
  const redactValues = [];
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) continue;
    if (VERIFICATION_ENVIRONMENT_KEYS.has(key.toUpperCase())) env[key] = value;
    else if (SENSITIVE_ENVIRONMENT_KEY.test(key)) redactValues.push(value);
  }
  return { env, redactValues };
}

function commandDigest(command, args) {
  return createHash("sha256").update(JSON.stringify([command, ...args])).digest("hex");
}

export class UpgradeVerificationRunner {
  constructor(options) {
    this.root = path.resolve(options.root);
    this.runId = options.runId;
    this.planId = options.planId;
    this.phaseId = options.phaseId;
    this.ticketId = options.ticketId ?? "UPG-004";
    this.timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
    this.ownershipTimeoutMs = options.ownershipTimeoutMs ?? 15_000;
    this.terminationGraceMs = options.terminationGraceMs ?? 1_000;
    this.maxOutputBytes = options.maxOutputBytes ?? 64 * 1024;
    this.signal = options.signal;
    this.identityResolver = options.identityResolver ?? resolveProcessIdentity;
    this.leaseWriter = options.leaseWriter ?? writeJson;
    this.environment = options.environment;
    this.platform = options.platform ?? process.platform;
  }

  async run(command, args, options = {}) {
    if (this.platform !== "win32") {
      throw new Error("POSIX upgrade verification cannot contain detached-session descendants without a native process owner");
    }
    const leaseDirectory = path.join(this.root, ".agent", "leases");
    const leasePath = path.join(leaseDirectory, `upgrade-verification-${randomUUID()}.json`);
    const timeoutMs = options.timeout ?? this.timeoutMs;
    const sanitized = sanitizeVerificationEnvironment(options.environment ?? this.environment ?? process.env);
    let lease;
    const result = await runCommandAsync(command, args, {
      cwd: options.cwd ?? this.root,
      env: sanitized.env,
      inheritEnv: false,
      timeout: timeoutMs,
      maxOutputBytes: options.maxOutputBytes ?? this.maxOutputBytes,
      terminationGraceMs: options.terminationGraceMs ?? this.terminationGraceMs,
      ownershipTimeoutMs: options.ownershipTimeoutMs ?? this.ownershipTimeoutMs,
      ownDescendants: true,
      signal: options.signal ?? this.signal,
      redactValues: sanitized.redactValues,
      barrierDirectory: path.join(leaseDirectory, ".barriers"),
      onSpawn: async (spawned) => {
        if (!spawned.ownershipEstablished) {
          throw new Error("Native verification process ownership was not established");
        }
        const identity = await (options.identityResolver ?? this.identityResolver)(spawned.pid);
        if (identity.state !== "alive" || !identity.identity) {
          throw new Error(`Verification process start identity is unresolved${identity.reason ? `: ${identity.reason}` : ""}`);
        }
        lease = {
          version: 1,
          runId: this.runId,
          ticketId: this.ticketId,
          planId: this.planId,
          phaseId: options.phaseId ?? this.phaseId,
          stepId: options.stepId,
          pid: spawned.pid,
          processStartIdentity: identity.identity,
          commandDigest: commandDigest(command, args),
          cwd: path.resolve(options.cwd ?? this.root),
          startedAt: new Date().toISOString(),
          deadline: new Date(Date.now() + timeoutMs).toISOString(),
          platformOwnership: spawned.platformOwnership,
        };
        await ensureDirectory(leaseDirectory);
        await this.leaseWriter(leasePath, lease);
      },
    });
    const final = {
      completedAt: new Date().toISOString(),
      status: result.status,
      signal: result.signal,
      timedOut: result.timedOut,
      aborted: result.aborted,
      zeroDescendants: result.ownership?.zeroDescendants === true,
      platformOwnership: result.ownership,
    };
    if (lease) {
      lease.final = final;
      await this.leaseWriter(leasePath, lease);
      if (!final.zeroDescendants) {
        throw new Error(`Verification process cleanup left descendants for PID ${lease.pid}; lease retained at ${leasePath}`);
      }
      await rm(leasePath);
    }
    if (result.error) throw result.error;
    if (!lease) throw new Error("Verification runner completed without a durable process lease");
    return {
      command: result.command,
      args: result.args,
      cwd: result.cwd,
      status: result.status,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error ? String(result.error.message ?? result.error) : undefined,
      timedOut: result.timedOut,
      aborted: result.aborted,
      durationMs: result.durationMs,
      lease: lease ? {
        runId: lease.runId,
        ticketId: lease.ticketId,
        planId: lease.planId,
        phaseId: lease.phaseId,
        stepId: lease.stepId,
        pid: lease.pid,
        processStartIdentity: lease.processStartIdentity,
        commandDigest: lease.commandDigest,
        deadline: lease.deadline,
        platformOwnership: lease.platformOwnership,
        final,
      } : undefined,
    };
  }
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function consume() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, consume));
  return results;
}

async function verifyModule(root, module, options = {}) {
  const cwd = path.join(root, module.path === "." ? "" : module.path);
  const results = [];
  if (!module.commands?.fullSteps?.length) return { module: module.id, moduleId: module.id, path: module.path, state: "skipped", reason: "no verification command detected", results };
  for (const [stepIndex, step] of module.commands.fullSteps.entries()) {
    if (!commandExists(step.command)) {
      results.push({ ...step, state: "unknown", status: null, reason: `${step.command} is not available` });
      return { module: module.id, moduleId: module.id, path: module.path, state: "unknown", results };
    }
    const result = await (options.runner ?? runCommandAsync)(step.command, step.args, {
      cwd,
      timeout: options.timeoutMs ?? 30 * 60 * 1000,
      maxOutputBytes: options.maxOutputBytes ?? 100_000,
      signal: options.signal,
      phaseId: options.phaseId,
      stepId: `${module.id}:${stepIndex + 1}`,
    });
    results.push({ ...result, state: result.status === 0 ? "passed" : "failed" });
    if (result.status !== 0) return { module: module.id, moduleId: module.id, path: module.path, state: "failed", results };
  }
  return { module: module.id, moduleId: module.id, path: module.path, state: "passed", results };
}

export function selectVerificationModules(workspace, options = {}) {
  if (options.scope === "root") return workspace.rootModule ? [workspace.rootModule] : workspace.modules.filter((module) => module.path === ".");
  let selected;
  if (options.scope === "module") {
    const requested = new Set(options.modules ?? []);
    if (requested.size === 0) throw new Error("--scope module requires at least one --module selector");
    const matched = workspace.modules.filter((module) => requested.has(module.id) || requested.has(module.path));
    const matchedSelectors = new Set(matched.flatMap((module) => [module.id, module.path]));
    const unknown = [...requested].filter((value) => !matchedSelectors.has(value));
    if (unknown.length > 0) throw new Error(`Unknown module selector(s): ${unknown.join(", ")}`);
    return matched;
  }
  if (options.scope === "affected") {
    const changed = options.changedPaths ?? changedPathsFromGit(options.root, options.affectedFrom);
    selected = includeDependents(workspace, owningModules(workspace, changed));
  } else selected = new Set(workspace.modules.map((module) => module.id));
  return workspace.modules.filter((module) => selected.has(module.id));
}

export async function verifyWorkspace(root, workspaceOrOptions = {}, maybeOptions = {}) {
  const hasWorkspace = Array.isArray(workspaceOrOptions?.modules);
  const options = hasWorkspace ? maybeOptions : workspaceOrOptions;
  const workspace = hasWorkspace
    ? workspaceOrOptions
    : await discoverWorkspace(root, { workspace: options.workspace ?? "all", includeRootModule: false, includeOpaque: true });
  if (!workspace.canUse) {
    throw new Error(`Workspace conflicts:\n- ${workspace.conflicts.join("\n- ")}`);
  }
  const selected = selectVerificationModules(workspace, { ...options, root });
  if (options.scope === "root" && selected.length === 0) {
    return {
      version: 1,
      root,
      scope: "root",
      selected: [],
      results: [{ module: "workspace-root", moduleId: "workspace-root", path: ".", state: "unknown", reason: "no distinct workspace-root aggregate command was detected", results: [] }],
      ok: false,
    };
  }
  const selectedIds = new Set(selected.map((module) => module.id));
  const normalized = selected.map((module) => ({ ...module, dependencies: module.dependencies.filter((id) => selectedIds.has(id)) }));
  const byId = new Map(normalized.map((module) => [module.id, module]));
  const status = new Map();
  const results = [];
  for (const level of topologicalLevels(normalized)) {
    const runnable = [];
    for (const id of level) {
      const module = byId.get(id);
      const blockedBy = module.dependencies.filter((dependency) => ["failed", "blocked", "unknown"].includes(status.get(dependency)));
      if (blockedBy.length > 0) {
        status.set(id, "blocked");
        results.push({ module: id, moduleId: id, path: module.path, state: "blocked", blockedBy, results: [] });
      } else runnable.push(module);
    }
    const levelResults = await runPool(runnable, options.concurrency ?? Math.min(4, Math.max(1, runnable.length)), (module) => verifyModule(root, module, options));
    for (const result of levelResults) {
      status.set(result.module, result.state);
      results.push(result);
      if (options.failFast && result.state === "failed") break;
    }
    if (options.failFast && results.some((result) => result.state === "failed")) break;
  }
  results.sort((a, b) => a.path.localeCompare(b.path));
  const ok = results.every((result) => ["passed", "skipped"].includes(result.state));
  return { version: 1, root, scope: options.scope ?? "all", selected: selected.map((module) => module.id), results, ok };
}
