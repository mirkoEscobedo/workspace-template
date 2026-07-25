import path from "node:path";
import { PACKAGE_VERSION } from "../constants.js";
import { canonicalJson, hashText, isPathInside, toPosixPath } from "../fs-utils.js";

export const PLAN_SCHEMA_VERSION = 2;


function compactJsonValue(value) {
  if (Array.isArray(value)) return value.map(compactJsonValue);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, compactJsonValue(item)]),
    );
  }
  return value;
}
const APPROVAL_NAMES = [
  "dirtyTree",
  "lifecycleScripts",
  "network",
  "riskySkillPermissions",
  "runtimeDependencies",
  "semanticChanges",
  "skillRemoval",
];

export function stableStringify(value) {
  return canonicalJson(value);
}

function normalizedApprovals(value = {}) {
  return Object.fromEntries(APPROVAL_NAMES.map((name) => [name, Boolean(value[name])]));
}

export function normalizeArgv(command) {
  if (!command || typeof command !== "object") throw new Error("Plan command entry must be an object");
  const executable = command.executable ?? command.command;
  if (typeof executable !== "string" || !executable.trim()) throw new Error("Plan command executable is required");
  const args = command.args ?? [];
  if (!Array.isArray(args) || args.some((item) => typeof item !== "string")) throw new Error("Plan command args must be a string array");
  const moduleId = command.moduleId ?? command.module;
  return {
    ...(command.id !== undefined ? { id: command.id } : {}),
    ...(moduleId !== undefined ? { moduleId } : {}),
    executable,
    args: [...args],
    cwd: toPosixPath(command.cwd ?? "."),
    env: Object.fromEntries(Object.entries(command.env ?? {}).sort(([left], [right]) => left.localeCompare(right))),
    timeoutMs: Number.isFinite(command.timeoutMs) ? command.timeoutMs : 15 * 60 * 1000,
    maxOutputBytes: Number.isFinite(command.maxOutputBytes) ? command.maxOutputBytes : 100_000,
    network: Boolean(command.network),
    lifecycleScripts: Boolean(command.lifecycleScripts),
    expectedPaths: [...new Set((command.expectedPaths ?? []).map(toPosixPath))].sort(),
    ...(Array.isArray(command.dependencies) ? { dependencies: command.dependencies.map((item) => ({ ...item })) } : {}),
    ...(command.reason !== undefined ? { reason: command.reason } : {}),
  };
}

export function normalizeOperation(operation) {
  if (!operation || typeof operation !== "object") throw new Error("Plan operation must be an object");
  const kind = operation.kind ?? operation.action;
  if (typeof kind !== "string" || !kind) throw new Error("Plan operation kind is required");
  const normalized = compactJsonValue({ ...operation, kind });
  delete normalized.action;
  for (const key of ["path", "from", "to", "cwd", "baselinePath", "localPath", "incomingPath", "proposalPath"]) {
    if (typeof normalized[key] === "string") normalized[key] = toPosixPath(normalized[key]);
  }
  if (Array.isArray(normalized.paths)) normalized.paths = [...new Set(normalized.paths.map(toPosixPath))].sort();
  return normalized;
}

function planWithoutIdentity(plan) {
  const { planId: _planId, integrity: _integrity, ...rest } = plan;
  return rest;
}

export function planDigest(plan) {
  return hashText(stableStringify(planWithoutIdentity(plan)));
}

export function createPlanEnvelope(input) {
  if (!input?.command) throw new Error("Plan command is required");
  if (!input?.root) throw new Error("Plan root is required");
  const root = path.resolve(input.root);
  const plan = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    command: input.command,
    subcommand: input.subcommand ?? null,
    root,
    package: { name: "workspace-template", version: PACKAGE_VERSION },
    createdBy: { package: "workspace-template", version: PACKAGE_VERSION },
    scope: input.scope ?? {},
    preconditions: input.preconditions ?? [],
    operations: (input.operations ?? []).map(normalizeOperation),
    commands: (input.commands ?? []).map(normalizeArgv),
    approvals: normalizedApprovals(input.approvals),
    verification: input.verification ?? [],
    rollback: input.rollback ?? {},
    nestedPlans: input.nestedPlans ?? [],
    metadata: input.metadata ?? {},
    ...(input.workspace !== undefined ? { workspace: input.workspace } : {}),
    ...(input.tooling !== undefined ? { tooling: input.tooling } : {}),
    ...(input.skillUpdate !== undefined ? { skillUpdate: input.skillUpdate } : {}),
    ...(input.restructure !== undefined ? { restructure: input.restructure } : {}),
    ...(input.alignment !== undefined ? { alignment: input.alignment } : {}),
    warnings: [...new Set(input.warnings ?? [])],
    conflicts: [...new Set(input.conflicts ?? [])],
    canApply: input.canApply === false ? false : (input.conflicts ?? []).length === 0,
  };
  const compact = compactJsonValue(plan);
  const digest = planDigest(compact);
  return { ...compact, planId: digest.slice(0, 32), integrity: { algorithm: "sha256", digest } };
}

export const sealPlan = createPlanEnvelope;

export function validatePlanShape(plan, expected = {}) {
  const expectedCommand = typeof expected === "string" ? expected : expected.command;
  const expectedSubcommand = typeof expected === "object" ? expected.subcommand : undefined;
  const errors = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) errors.push("plan must be an object");
  if (plan?.schemaVersion !== PLAN_SCHEMA_VERSION) errors.push(`unsupported schemaVersion '${plan?.schemaVersion}'`);
  if (typeof plan?.planId !== "string" || !plan.planId) errors.push("planId is required");
  if (typeof plan?.command !== "string" || !plan.command) errors.push("command is required");
  if (expectedCommand && plan?.command !== expectedCommand) errors.push(`expected command '${expectedCommand}', received '${plan?.command}'`);
  if (expectedSubcommand !== undefined && (plan?.subcommand ?? null) !== expectedSubcommand) {
    errors.push(`expected subcommand '${expectedSubcommand}', received '${plan?.subcommand}'`);
  }
  if (typeof plan?.root !== "string" || !path.isAbsolute(plan.root)) errors.push("root must be an absolute path");
  if (plan?.package?.name !== "workspace-template") errors.push("package.name is invalid");
  if (plan?.package?.version !== PACKAGE_VERSION) errors.push(`plan package version '${plan?.package?.version}' does not match '${PACKAGE_VERSION}'`);
  for (const key of ["preconditions", "operations", "commands", "verification", "nestedPlans", "warnings", "conflicts"]) {
    if (!Array.isArray(plan?.[key])) errors.push(`${key} must be an array`);
  }
  if (!plan?.approvals || typeof plan.approvals !== "object") errors.push("approvals must be an object");
  if (plan?.root && Array.isArray(plan?.operations)) {
    for (const operation of plan.operations) {
      for (const key of ["path", "from", "to", "baselinePath", "localPath", "incomingPath", "proposalPath"]) {
        if (operation[key] && !isPathInside(plan.root, path.resolve(plan.root, operation[key]))) {
          errors.push(`operation '${operation.kind}' has unsafe ${key}: ${operation[key]}`);
        }
      }
    }
  }
  if (plan?.root && Array.isArray(plan?.commands)) {
    for (const command of plan.commands) {
      if (!isPathInside(plan.root, path.resolve(plan.root, command.cwd ?? "."))) errors.push(`command cwd escapes root: ${command.cwd}`);
    }
  }
  if (plan?.planId) {
    const digest = planDigest(plan);
    if (plan.planId !== digest.slice(0, 32)) errors.push("planId does not match plan contents; the plan may have been edited");
    if (plan.integrity?.digest !== digest || plan.integrity?.algorithm !== "sha256") errors.push("plan integrity metadata does not match plan contents");
  }
  return { ok: errors.length === 0, errors };
}

export function assertValidPlan(plan, expected = {}) {
  const report = validatePlanShape(plan, expected);
  if (!report.ok) throw new Error(`Invalid plan:\n- ${report.errors.join("\n- ")}`);
  return plan;
}

export function assertApprovals(plan, requirements = {}) {
  for (const [name, required] of Object.entries(requirements)) {
    if (required && !plan.approvals?.[name]) throw new Error(`Plan requires explicit approval: ${name}`);
  }
  return plan;
}

export function refreshPlanId(plan) {
  const compact = compactJsonValue(plan);
  const digest = planDigest(compact);
  return { ...compact, planId: digest.slice(0, 32), integrity: { algorithm: "sha256", digest } };
}
