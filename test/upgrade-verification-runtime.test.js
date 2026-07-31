import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createProject } from "../src/create.js";
import { buildUpgradeVerificationEnvironment } from "../src/upgrade/apply.js";
import { sanitizeVerificationEnvironment } from "../src/workspace/verify.js";
import { applyWithVerifier, buildSupportedUpgradePlan } from "./upgrade-internal-harness.js";

async function workspaceFixture(context) {
  const parent = await mkdtemp(path.join(os.tmpdir(), "workspace-template-verification-runtime-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, "repo");
  await createProject({
    target: root,
    project: "javascript",
    style: "functional-core",
    tdd: "pragmatic",
    packageManager: "npm",
    agents: [],
    preset: "sol-codex",
    install: false,
    git: false,
    bootstrap: false,
    force: false,
    dryRun: false,
    yes: true,
  });
  const manifestPath = path.join(root, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    delete manifest[section];
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return root;
}

describe("upgrade verification runtime", () => {
  it("preserves an explicitly authorized external Rustup toolchain under the scratch profile", () => {
    const checkpointRoot = path.join(os.tmpdir(), "workspace-template-rust-authority");
    const originalProfile = path.join(os.tmpdir(), "workspace-template-rust-profile");
    const environment = buildUpgradeVerificationEnvironment(
      checkpointRoot,
      "pre-mutation",
      { approvals: { network: true } },
      {
        HOME: originalProfile,
        USERPROFILE: originalProfile,
        PATH: process.env.PATH,
        RUSTUP_TOOLCHAIN: "stable-x86_64-pc-windows-msvc",
      },
    );
    const sanitized = sanitizeVerificationEnvironment(environment).env;

    assert.equal(environment.USERPROFILE, path.join(
      checkpointRoot,
      ".agentic",
      "verification-scratch",
      "pre-mutation",
      "home",
    ));
    assert.equal(sanitized.CARGO_HOME, path.join(originalProfile, ".cargo"));
    assert.equal(sanitized.RUSTUP_HOME, path.join(originalProfile, ".rustup"));
    assert.equal(sanitized.RUSTUP_TOOLCHAIN, "stable-x86_64-pc-windows-msvc");
  });

  it("removes external Rust toolchain authority when the plan did not seal it", () => {
    const environment = buildUpgradeVerificationEnvironment(
      path.join(os.tmpdir(), "workspace-template-rust-no-authority"),
      "pre-mutation",
      { approvals: { network: false } },
      {
        HOME: path.join(os.tmpdir(), "ambient-home"),
        USERPROFILE: path.join(os.tmpdir(), "ambient-profile"),
        CARGO_HOME: path.join(os.tmpdir(), "ambient-cargo"),
        RUSTUP_HOME: path.join(os.tmpdir(), "ambient-rustup"),
        RUSTUP_TOOLCHAIN: "nightly",
      },
    );
    const sanitized = sanitizeVerificationEnvironment(environment).env;

    assert.equal("CARGO_HOME" in sanitized, false);
    assert.equal("RUSTUP_HOME" in sanitized, false);
    assert.equal("RUSTUP_TOOLCHAIN" in sanitized, false);
  });

  it("persists actionable bounded evidence when pre-mutation verification fails", async (context) => {
    const root = await workspaceFixture(context);
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    const managedPath = path.join(root, ".agentic", "config.json");
    const managedBefore = await readFile(managedPath, "utf8");
    const stderr = "Failed to spawn: ruff\nprogram not found\n";
    const runner = async (command, args, options) => ({
      command,
      args,
      cwd: options.cwd,
      status: 1,
      signal: null,
      stdout: "",
      stderr,
      timedOut: false,
      aborted: false,
      durationMs: 5,
      lease: {
        final: {
          zeroDescendants: true,
        },
      },
    });

    await assert.rejects(
      () => applyWithVerifier(plan, undefined, {}, { runner }),
      (error) =>
        /first failing command:/iu.test(error.message)
        && /Failed to spawn: ruff/iu.test(error.message),
    );

    const report = JSON.parse(await readFile(
      path.join(root, ".agentic", "reports", "upgrade", `${plan.planId}.json`),
      "utf8",
    ));
    const failedModule = report.preVerification.results.find((item) => item.state === "failed");
    const failedStep = failedModule.results[0];
    assert.equal(report.ok, false);
    assert.equal(report.status, "verification-failed");
    assert.equal(report.phase, "pre-mutation");
    assert.deepEqual(report.applied, []);
    assert.equal(failedStep.command, "npm");
    assert.deepEqual(failedStep.args, ["run", "check"]);
    assert.notEqual(path.resolve(failedStep.cwd), path.resolve(root));
    assert.equal(failedStep.status, 1);
    assert.equal(failedStep.timedOut, false);
    assert.equal(failedStep.stderr, stderr);
    assert.equal(failedStep.lease.final.zeroDescendants, true);
    assert.equal(await readFile(managedPath, "utf8"), managedBefore);
    const leases = await readdir(path.join(root, ".agent", "leases"));
    assert.deepEqual(leases.filter((name) => name.endsWith(".json")), []);
  });

  it("blocks a Python verification tool absent from declared dependency groups", async (context) => {
    const root = await workspaceFixture(context);
    const addonRoot = path.join(root, "addon");
    await mkdir(addonRoot, { recursive: true });
    await mkdir(path.join(root, ".agentic", "modules", "addon"), { recursive: true });
    await writeFile(path.join(root, ".agentic", "workspace.json"), `${JSON.stringify({
      version: 1,
      root: ".",
      kind: "polyglot",
      modules: [{
        id: "addon",
        name: "addon",
        path: "addon",
        project: "python",
        packageManager: "uv",
        manifest: "addon/pyproject.toml",
        lockOwner: "addon",
        dependencies: [],
        commands: {
          fullSteps: [
            { command: "uv", args: ["run", "ruff", "check", "."] },
            { command: "uv", args: ["run", "pytest"] },
          ],
        },
      }],
    }, null, 2)}\n`);
    await writeFile(path.join(root, ".agentic", "modules", "addon", "commands.json"), `${JSON.stringify({
      fullSteps: [
        { command: "uv", args: ["run", "ruff", "check", "."] },
        { command: "uv", args: ["run", "pytest"] },
      ],
    }, null, 2)}\n`);
    await writeFile(path.join(addonRoot, "pyproject.toml"), [
      "[project]",
      'name = "addon"',
      'version = "0.1.0"',
      "dependencies = []",
      "",
      "[dependency-groups]",
      "dev = [",
      '  "pytest>=8.0",',
      "]",
      "",
    ].join("\n"));

    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });

    assert.equal(plan.canApply, false);
    assert.equal(
      plan.conflicts.some((conflict) =>
        /addon.*uv run ruff.*not declared.*dependency/iu.test(conflict)),
      true,
      plan.conflicts.join("\n"),
    );
  });
});
