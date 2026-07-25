#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    shell: false,
    encoding: "utf8",
    stdio: "pipe",
    timeout: options.timeout ?? 180_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}):\n${result.stderr || result.stdout || result.error?.message || "unknown error"}`);
  }
  return result;
}

function runJson(command, args, options = {}) {
  const result = run(command, args, options);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Expected JSON from ${command} ${args.join(" ")}: ${error.message}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readable(file) {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

const argument = process.argv[2];
if (!argument) {
  console.error("Usage: node scripts/packed-smoke.js <workspace-template-*.tgz>");
  process.exit(2);
}

const tarball = path.resolve(argument);
const sandbox = await mkdtemp(path.join(os.tmpdir(), "caw-packed-smoke-"));
const consumer = path.join(sandbox, "consumer");
await mkdir(consumer, { recursive: true });
await writeJson(path.join(consumer, "package.json"), { name: "packed-smoke-consumer", private: true });
run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarball], {
  cwd: consumer,
  timeout: 240_000,
});

const packageRoot = path.join(consumer, "node_modules", "workspace-template");
const cli = path.join(packageRoot, "bin", "workspace-template.js");
const invoke = (args, options = {}) => run(process.execPath, [cli, ...args], options);
const invokeJson = (args, options = {}) => runJson(process.execPath, [cli, ...args], options);

assert.equal(invoke(["--version"]).stdout.trim(), "0.6.0");

// The actual packed payload must include the runtime, modular repository skills,
// operational scripts, and release docs.
for (const relative of [
  "src/index.js",
  "src/tooling/apply.js",
  "src/restructure/apply.js",
  "src/align/orchestrate.js",
  "assets/skills/wayfinder/SKILL.md",
  "assets/skills/execute-frontier/SKILL.md",
  "assets/scripts/managed_command.py",
  "docs/usage.md",
  "docs/guides/frontier-loop-user-guide.html",
]) {
  assert.equal(await readable(path.join(packageRoot, relative)), true, `packed file missing: ${relative}`);
}

// New-project creation from the installed tarball.
const generated = path.join(sandbox, "generated");
invoke(["create", generated, "--project", "typescript", "--no-install", "--no-git", "--yes", "--json"]);
const generatedDoctor = invokeJson(["doctor", generated, "--json"]);
assert.equal(generatedDoctor.ok, true, JSON.stringify(generatedDoctor.errors));
const codexConfig = await readFile(path.join(generated, ".codex", "config.toml"), "utf8");
assert.match(codexConfig, /model\s*=\s*"gpt-5\.6-sol"/);
assert.match(codexConfig, /default_subagent_model\s*=\s*"gpt-5\.3-codex"/);

// Existing-repository adoption round-trip from a persisted immutable plan.
const existing = path.join(sandbox, "existing");
await mkdir(path.join(existing, "src"), { recursive: true });
await writeJson(path.join(existing, "package.json"), {
  name: "existing-app",
  private: true,
  type: "module",
  scripts: { check: "node -e \"process.exit(0)\"" },
});
await writeJson(path.join(existing, "package-lock.json"), { name: "existing-app", lockfileVersion: 3 });
await writeFile(path.join(existing, "src", "index.js"), "export const value = 1;\n", "utf8");
await writeFile(path.join(existing, "AGENTS.md"), "# Existing project instructions\n", "utf8");
const sourceBefore = await readFile(path.join(existing, "src", "index.js"), "utf8");
const agentsBefore = await readFile(path.join(existing, "AGENTS.md"), "utf8");
const adoptionPlanPath = path.join(sandbox, "adoption-plan.json");
const adoptionPlan = invokeJson(["adopt", existing, "--dry-run", "--json", "--no-tickets", "--plan-out", adoptionPlanPath]);
assert.equal(adoptionPlan.command, "adopt");
assert.equal(adoptionPlan.canApply, true, adoptionPlan.conflicts?.join("\n"));
const adoptionResult = invokeJson(["adopt", existing, "--apply-plan", adoptionPlanPath, "--json"]);
assert.equal(adoptionResult.ok, true, JSON.stringify(adoptionResult.doctor?.errors));
assert.equal(await readFile(path.join(existing, "src", "index.js"), "utf8"), sourceBefore);
assert.equal(await readFile(path.join(existing, "AGENTS.md"), "utf8"), agentsBefore);
assert.equal(await readable(path.join(existing, ".agentic", "proposals", "AGENTS.md")), true);
assert.equal(invokeJson(["doctor", existing, "--json"]).ok, true);
const skillCheck = invokeJson(["skills", "update", existing, "--check", "--json"]);
assert.equal(Array.isArray(skillCheck.skills), true);
assert.equal(skillCheck.skills.length > 0, true);

// Packed workspace discovery and dependency-aware verification.
const workspace = path.join(sandbox, "workspace");
await mkdir(path.join(workspace, "packages", "core"), { recursive: true });
await mkdir(path.join(workspace, "packages", "app"), { recursive: true });
await writeJson(path.join(workspace, "package.json"), {
  name: "packed-workspace",
  private: true,
  workspaces: ["packages/*"],
  scripts: { check: "node -e \"process.exit(0)\"" },
});
await writeJson(path.join(workspace, "package-lock.json"), { name: "packed-workspace", lockfileVersion: 3 });
await writeJson(path.join(workspace, "packages", "core", "package.json"), {
  name: "@packed/core",
  private: true,
  type: "module",
  scripts: { check: "node -e \"process.exit(0)\"" },
});
await writeJson(path.join(workspace, "packages", "app", "package.json"), {
  name: "@packed/app",
  private: true,
  type: "module",
  scripts: { check: "node -e \"process.exit(0)\"" },
  dependencies: { "@packed/core": "workspace:*" },
});
const inspected = invokeJson(["inspect", workspace, "--workspace", "all", "--json"]);
assert.equal(inspected.workspace.modules.length, 2);
assert.equal(inspected.workspace.modules.find((item) => item.name === "@packed/app").dependencies.length, 1);
const verified = invokeJson(["verify", workspace, "--workspace", "all", "--scope", "all", "--json"]);
assert.equal(verified.ok, true, JSON.stringify(verified.results));

// Controlled local dependency installation from an immutable plan. This uses
// only a file: package and therefore proves the packed path without network.
const vendor = path.join(sandbox, "vendor", "local-tool");
await mkdir(vendor, { recursive: true });
await writeJson(path.join(vendor, "package.json"), { name: "local-tool", version: "1.0.0", type: "module" });
await writeFile(path.join(vendor, "index.js"), "export const localTool = true;\n", "utf8");
const tooling = path.join(sandbox, "tooling");
await mkdir(tooling, { recursive: true });
await writeJson(path.join(tooling, "package.json"), {
  name: "packed-tooling",
  private: true,
  type: "module",
  scripts: { check: "node -e \"process.exit(0)\"" },
});
await writeJson(path.join(tooling, "package-lock.json"), { name: "packed-tooling", lockfileVersion: 3 });
await writeJson(path.join(tooling, "tsconfig.json"), { compilerOptions: { strict: true } });
const toolingPlanPath = path.join(sandbox, "tooling-plan.json");
const toolingPlan = invokeJson([
  "tooling", "plan", tooling,
  "--dependency", "local-tool@file:../vendor/local-tool",
  "--kind", "development",
  "--scripts", "preserve",
  "--plan-out", toolingPlanPath,
  "--json",
]);
assert.equal(toolingPlan.canApply, true, toolingPlan.conflicts?.join("\n"));
assert.equal(toolingPlan.commands[0].network, false);
const toolingResult = invokeJson(["tooling", "install", tooling, "--apply-plan", toolingPlanPath, "--skip-verification", "--json"], { timeout: 240_000 });
assert.equal(toolingResult.ok, true, toolingResult.error);
const installedManifest = JSON.parse(await readFile(path.join(tooling, "package.json"), "utf8"));
assert.equal(typeof installedManifest.devDependencies?.["local-tool"], "string");

// Mechanical source restructuring from the packed artifact.
const restructure = path.join(sandbox, "restructure");
await mkdir(path.join(restructure, "src", "old"), { recursive: true });
await writeJson(path.join(restructure, "package.json"), {
  name: "packed-restructure",
  private: true,
  type: "module",
  scripts: { check: "node -e \"process.exit(0)\"" },
  devDependencies: { typescript: "5.0.0" },
});
await writeJson(path.join(restructure, "package-lock.json"), { name: "packed-restructure", lockfileVersion: 3 });
await writeJson(path.join(restructure, "tsconfig.json"), { compilerOptions: { strict: true } });
await writeFile(path.join(restructure, "src", "old", "util.ts"), "export const value = 1;\n", "utf8");
await writeFile(path.join(restructure, "src", "index.ts"), 'import { value } from "./old/util";\nexport { value };\n', "utf8");
const restructurePlanPath = path.join(sandbox, "restructure-plan.json");
const restructurePlan = invokeJson([
  "restructure", "plan", restructure,
  "--move", "src/old/util.ts=>src/new/util.ts",
  "--checkpoint", "copy",
  "--plan-out", restructurePlanPath,
  "--json",
]);
assert.equal(restructurePlan.canApply, true, restructurePlan.conflicts?.join("\n"));
const restructureResult = invokeJson(["restructure", "apply", restructure, "--apply-plan", restructurePlanPath, "--skip-final-verification", "--json"]);
assert.equal(restructureResult.ok, true, restructureResult.error);
assert.equal(await readable(path.join(restructure, "src", "new", "util.ts")), true);
assert.equal(await readable(path.join(restructure, "src", "old", "util.ts")), false);
assert.match(await readFile(path.join(restructure, "src", "index.ts"), "utf8"), /\.\/new\/util/);

// A bounded manual alignment must plan one slice and stop at one structured
// task without launching a model or changing application source.
const align = path.join(sandbox, "align");
await mkdir(path.join(align, "src", "orders"), { recursive: true });
await mkdir(path.join(align, "test"), { recursive: true });
await writeJson(path.join(align, "package.json"), {
  name: "packed-align",
  private: true,
  type: "module",
  scripts: { check: "node -e \"process.exit(0)\"" },
  devDependencies: { typescript: "5.0.0" },
});
await writeJson(path.join(align, "package-lock.json"), { name: "packed-align", lockfileVersion: 3 });
await writeJson(path.join(align, "tsconfig.json"), { compilerOptions: { strict: true } });
const alignSource = path.join(align, "src", "orders", "order-service.ts");
await writeFile(alignSource, "export function processOrder(total: number) { return { total, createdAt: Date.now() }; }\n", "utf8");
await writeFile(path.join(align, "test", "order-service.test.ts"), "// existing public-seam characterization placeholder\n", "utf8");
const alignBefore = await readFile(alignSource, "utf8");
const alignPlanPath = path.join(sandbox, "align-plan.json");
const alignPlan = invokeJson([
  "align", "plan", align,
  "--use-case", "src/orders/order-service.ts",
  "--style", "functional-core",
  "--characterization", "allow-existing",
  "--checkpoint", "copy",
  "--executor", "manual",
  "--plan-out", alignPlanPath,
  "--json",
]);
assert.equal(alignPlan.canApply, true, alignPlan.conflicts?.join("\n"));
assert.equal(alignPlan.alignment.tasks.length > 0, true);
const manual = invokeJson(["align", "execute", align, "--apply-plan", alignPlanPath, "--executor", "manual", "--json"]);
assert.equal(manual.status, "awaiting-manual");
assert.equal(manual.currentTask, alignPlan.alignment.tasks[0].id);
assert.equal(await readFile(alignSource, "utf8"), alignBefore);
const status = invokeJson(["align", "status", align, "--plan-id", alignPlan.planId, "--json"]);
assert.equal(status.report.status, "awaiting-manual");

console.log(JSON.stringify({
  ok: true,
  tarball,
  packageRoot,
  sandbox,
  checks: [
    "version-and-packed-payload",
    "create-and-doctor",
    "persisted-adoption-round-trip",
    "source-and-custom-instruction-preservation",
    "project-owned-skill-update-check",
    "workspace-discovery-and-verification",
    "offline-native-tooling-transaction",
    "mechanical-restructure-transaction",
    "manual-alignment-plan-and-stop-gate",
  ],
}, null, 2));
