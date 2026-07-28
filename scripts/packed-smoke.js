#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
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

async function treeDigest(root) {
  const hash = createHash("sha256");
  async function walk(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative);
      else {
        hash.update(relative);
        hash.update("\0");
        hash.update(await readFile(path.join(directory, entry.name)));
        hash.update("\0");
      }
    }
  }
  await walk(root);
  return hash.digest("hex");
}

const npmCli = process.env.npm_execpath
  ?? (process.platform === "win32"
    ? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
    : null);
const runNpm = (args, options = {}) => run(npmCli ? process.execPath : "npm", npmCli ? [npmCli, ...args] : args, options);
const runNpmJson = (args, options = {}) => runJson(npmCli ? process.execPath : "npm", npmCli ? [npmCli, ...args] : args, options);

let argument = process.argv[2];
let sandbox;
try {
sandbox = await mkdtemp(path.join(os.tmpdir(), "caw-packed-smoke-"));
if (!argument) {
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = runNpmJson(["pack", "--json", "--pack-destination", sandbox], { cwd: sourceRoot });
  argument = path.join(sandbox, result[0].filename);
}

const tarball = path.resolve(argument);
const consumer = path.join(sandbox, "consumer");
await mkdir(consumer, { recursive: true });
await writeJson(path.join(consumer, "package.json"), { name: "packed-smoke-consumer", private: true });
const npmInstall = ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarball];
runNpm(npmInstall, {
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
  "src/upgrade/index.js",
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
assert.match(codexConfig, /default_subagent_model\s*=\s*"gpt-5\.6-sol"/);
assert.equal(await readable(path.join(generated, ".agentic", "presets", "builtin", "sol-only.json")), true);
assert.equal(await readable(path.join(generated, ".agentic", "presets", "builtin", "sol-codex.json")), true);
const presetList = invokeJson(["preset", "list", generated, "--json"]);
assert.equal(presetList.activeId, "sol-only");
assert.equal(presetList.presets.length >= 2, true);

const generatedPresetPlanPath = path.join(sandbox, "generated-sol-codex-plan.json");
const generatedPresetPlan = invokeJson([
  "preset", "plan", generated, "--preset", "sol-codex", "--plan-out", generatedPresetPlanPath, "--json",
]);
assert.equal(generatedPresetPlan.command, "preset");
const generatedPresetApply = invokeJson([
  "preset", "apply", generated, "--apply-plan", generatedPresetPlanPath, "--json",
]);
assert.equal(generatedPresetApply.ok, true);
assert.equal(invokeJson(["preset", "status", generated, "--json"]).activeId, "sol-codex");
const splitCodexConfig = await readFile(path.join(generated, ".codex", "config.toml"), "utf8");
assert.match(splitCodexConfig, /default_subagent_model\s*=\s*"gpt-5\.3-codex-spark"/);
assert.match(splitCodexConfig, /default_subagent_reasoning_effort\s*=\s*"xhigh"/);
const splitImplementer = await readFile(path.join(generated, ".codex", "agents", "implementer.toml"), "utf8");
assert.match(splitImplementer, /model\s*=\s*"gpt-5\.3-codex-spark"/);
assert.match(splitImplementer, /model_reasoning_effort\s*=\s*"xhigh"/);
const splitOpenCode = JSON.parse(await readFile(path.join(generated, "opencode.json"), "utf8"));
assert.equal(splitOpenCode.agent["ticket-implementer"].model, "openai/gpt-5.3-codex-spark");
assert.equal(splitOpenCode.agent["ticket-implementer"].reasoningEffort, "xhigh");

const generatedPackagePath = path.join(generated, "package.json");
const generatedPackage = JSON.parse(await readFile(generatedPackagePath, "utf8"));
const dependencyBlockedResult = spawnSync(process.execPath, [
  cli, "upgrade", generated, "--dry-run", "--allow-network", "--json",
], {
  encoding: "utf8",
  shell: false,
  stdio: "pipe",
  timeout: 180_000,
});
assert.equal(dependencyBlockedResult.status, 1);
const dependencyBlockedPlan = JSON.parse(dependencyBlockedResult.stdout);
assert.match(dependencyBlockedPlan.conflicts.join("\n"), /dependency-backed verification is unsupported by the isolated checkpoint/i);
generatedPackage.scripts.check = "node -e \"process.exit(0)\"";
delete generatedPackage.dependencies;
delete generatedPackage.devDependencies;
delete generatedPackage.optionalDependencies;
delete generatedPackage.peerDependencies;
await writeJson(generatedPackagePath, generatedPackage);
const upgradePreview = invokeJson(["upgrade", generated, "--dry-run", "--allow-network", "--json"]);
assert.equal(upgradePreview.command, "upgrade");
assert.equal(upgradePreview.metadata.upgrade.mode, "generated");
const savedUpgrade = invokeJson(["upgrade", generated, "--plan-out", "--allow-network", "--json"]);
assert.equal(savedUpgrade.status, "planned");
assert.match(savedUpgrade.planPath, /[\\/]\.agentic[\\/]plans[\\/]upgrades[\\/]upgrade-0\.6\.0-to-0\.6\.0-[a-f0-9]{12}\.json$/);
const generatedUpgradePlanPath = savedUpgrade.planPath;
const tamperedUpgradePlanPath = path.join(sandbox, "tampered-upgrade.json");
const tamperedUpgradePlan = JSON.parse(await readFile(generatedUpgradePlanPath, "utf8"));
tamperedUpgradePlan.metadata.upgrade.mode = "adopted";
await writeJson(tamperedUpgradePlanPath, tamperedUpgradePlan);
assert.throws(
  () => invoke(["upgrade", generated, "--apply-plan", tamperedUpgradePlanPath, "--json"]),
  /failed/,
);
const generatedUpgrade = invokeJson(["upgrade", generated, "--apply-plan", generatedUpgradePlanPath, "--json"]);
assert.equal(generatedUpgrade.ok, true);
const secondUpgrade = invokeJson(["upgrade", generated, "--dry-run", "--allow-network", "--json"]);
assert.equal(secondUpgrade.metadata.upgrade.status, "current");
const rollbackTarget = path.join(generated, ".agentic", "README.md");
await unlink(rollbackTarget);
const rollbackPlan = invokeJson(["upgrade", generated, "--dry-run", "--allow-network", "--json"]);
let verificationCalls = 0;
const packedUpgradeInternals = await import(pathToFileURL(path.join(packageRoot, "src", "upgrade", "apply.js")).href);
const packedUpgradeHarness = packedUpgradeInternals.createUpgradeApplyTestHarness({
  verifier: async () => {
    verificationCalls += 1;
    if (verificationCalls > 1) throw new Error("packed rollback injection");
    return { ok: true };
  },
});
await assert.rejects(
  () => packedUpgradeHarness.apply(rollbackPlan),
  /packed rollback injection/,
);
assert.equal(await readable(rollbackTarget), false, "rollback must restore the pre-upgrade missing-file state");

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
const adoptedSourceBeforeUpgrade = await readFile(path.join(existing, "src", "index.js"), "utf8");
const adoptedProductHash = await treeDigest(path.join(existing, "src"));
const adoptedMemoryHash = await treeDigest(path.join(existing, "docs", "agent"));
const adoptedPackageBefore = await readFile(path.join(existing, "package.json"));
const adoptedUpgradePlanPath = path.join(sandbox, "adopted-upgrade.json");
invokeJson(["upgrade", existing, "--plan-out", adoptedUpgradePlanPath, "--allow-network", "--json"]);
const adoptedConfigPath = path.join(existing, ".agentic", "config.json");
const adoptedConfigBefore = await readFile(adoptedConfigPath, "utf8");
await writeFile(adoptedConfigPath, `${adoptedConfigBefore}\n`, "utf8");
assert.throws(
  () => invoke(["upgrade", existing, "--apply-plan", adoptedUpgradePlanPath, "--json"]),
  /failed/,
);
await writeFile(adoptedConfigPath, adoptedConfigBefore, "utf8");
const adoptedUpgrade = invokeJson(["upgrade", existing, "--apply-plan", adoptedUpgradePlanPath, "--json"]);
assert.equal(adoptedUpgrade.ok, true);
assert.equal(await readFile(path.join(existing, "src", "index.js"), "utf8"), adoptedSourceBeforeUpgrade);
assert.equal(invokeJson(["upgrade", existing, "--allow-network", "--json"]).status, "current");
assert.equal(await treeDigest(path.join(existing, "src")), adoptedProductHash);
assert.equal(await treeDigest(path.join(existing, "docs", "agent")), adoptedMemoryHash);
assert.deepEqual(await readFile(path.join(existing, "package.json")), adoptedPackageBefore);
assert.equal(await readFile(path.join(existing, "AGENTS.md"), "utf8"), agentsBefore);
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
const workspaceAdoptionPlan = path.join(sandbox, "workspace-adoption.json");
invokeJson(["adopt", workspace, "--dry-run", "--json", "--no-tickets", "--plan-out", workspaceAdoptionPlan]);
assert.equal(invokeJson(["adopt", workspace, "--apply-plan", workspaceAdoptionPlan, "--json"]).ok, true);
const workspacePackageBefore = await readFile(path.join(workspace, "package.json"));
const workspaceAppPackagePath = path.join(workspace, "packages", "app", "package.json");
const dependencyFreeWorkspaceApp = JSON.parse(await readFile(workspaceAppPackagePath, "utf8"));
delete dependencyFreeWorkspaceApp.dependencies;
await writeJson(workspaceAppPackagePath, dependencyFreeWorkspaceApp);
const workspaceProductHash = await treeDigest(path.join(workspace, "packages"));
assert.equal(invokeJson(["upgrade", workspace, "--allow-network", "--json"]).ok, true);
assert.equal(invokeJson(["doctor", workspace, "--json"]).ok, true);
assert.equal(invokeJson(["upgrade", workspace, "--dry-run", "--allow-network", "--json"]).metadata.upgrade.status, "current");
assert.equal(await treeDigest(path.join(workspace, "packages")), workspaceProductHash);
assert.deepEqual(await readFile(path.join(workspace, "package.json")), workspacePackageBefore);

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
    "generated-upgrade-preview-auto-plan-tamper-apply-noop",
    "packed-upgrade-injected-rollback",
    "persisted-adoption-round-trip",
    "adopted-upgrade-stale-apply-direct-noop",
    "source-durable-memory-package-and-custom-instruction-preservation",
    "project-owned-skill-update-check",
    "workspace-discovery-and-verification",
    "adopted-monorepo-upgrade-doctor-protected-hash-noop",
    "offline-native-tooling-transaction",
    "mechanical-restructure-transaction",
    "manual-alignment-plan-and-stop-gate",
  ],
}, null, 2));
} finally {
  if (sandbox) await rm(sandbox, { recursive: true, force: true });
}
