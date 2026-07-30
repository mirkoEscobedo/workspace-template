import assert from "node:assert/strict";
import { constants as bufferConstants } from "node:buffer";
import { execFile } from "node:child_process";
import { link, mkdir, mkdtemp, open, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { createProject } from "../src/create.js";
import { exists, hashDirectory } from "../src/fs-utils.js";
import {
  applyUpgradePlan,
  defaultUpgradePlanPath,
  upgradeWorkspace,
} from "../src/index.js";
import { applyWithVerifier, buildSupportedUpgradePlan } from "./upgrade-internal-harness.js";
import * as upgradePlan from "../src/upgrade/plan.js";
import { hashVerificationInputs } from "../src/upgrade/verification-inputs.js";

const execFileAsync = promisify(execFile);

async function temporaryDirectory(context, prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function generatedWorkspace(context) {
  const parent = await temporaryDirectory(context, "workspace-template-upgrade-");
  const root = path.join(parent, "demo");
  await createProject({
    target: root,
    project: "javascript",
    style: "functional-core",
    tdd: "pragmatic",
    packageManager: "npm",
    agents: ["codex", "opencode"],
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

describe("workspace upgrade", () => {
  it("ignores new ancestors that contain only excluded planned files", async (context) => {
    const root = await generatedWorkspace(context);
    const relative = ".agentic/new-managed-area/nested/artifact.json";
    const before = await upgradePlan.sealVerificationInputs(root, [relative]);

    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), "{}\n");
    const after = await upgradePlan.sealVerificationInputs(root, [relative]);

    assert.deepEqual(after, before);
  });

  it("builds a deterministic zero-write plan and an automatic review path", async (context) => {
    const root = await generatedWorkspace(context);
    const before = await hashDirectory(root);
    const first = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    const second = await buildSupportedUpgradePlan(root, { allowNetwork: true });

    assert.equal(await hashDirectory(root), before);
    assert.equal(first.command, "upgrade");
    assert.equal(first.planId, second.planId);
    assert.equal(first.metadata.upgrade.mode, "generated");
    assert.equal(first.metadata.upgrade.fromVersion, "0.6.1");
    assert.equal(first.metadata.upgrade.toVersion, "0.6.1");
    assert.equal(first.metadata.upgrade.status, "current");
    assert.equal(first.metadata.upgrade.operationCount, 0);
    assert.match(defaultUpgradePlanPath(first), /^\.agentic\/plans\/upgrades\/upgrade-0\.6\.1-to-0\.6\.1-[a-f0-9]{12}\.json$/);
  });

  it("seals explicit unconfined verification approval in the reviewed plan", async (context) => {
    const root = await generatedWorkspace(context);
    const blocked = await buildSupportedUpgradePlan(root);
    assert.equal(blocked.canApply, false);
    assert.equal(blocked.approvals.network, false);
    assert.equal(blocked.conflicts.some((item) => /cannot be portably confined.*--allow-network/iu.test(item)), true);

    const approved = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(approved.canApply, true);
    assert.equal(approved.approvals.network, true);
    assert.match(approved.metadata.verificationInputs.hash, /^[a-f0-9]{64}$/u);
  });

  it("seals a network-approved npm install for dependency-backed checkpoint verification", async (context) => {
    const root = await generatedWorkspace(context);
    const sentinel = path.join(root, "dependency-verifier-started");
    const manifestPath = path.join(root, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.devDependencies = { biome: "1.0.0" };
    manifest.scripts.check = `node_modules/.bin/biome check . && node -e "require('node:fs').writeFileSync(${JSON.stringify(sentinel)},'ran')"`;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const blocked = await buildSupportedUpgradePlan(root);
    assert.equal(blocked.canApply, false);
    assert.equal(blocked.conflicts.some((item) => /pass --allow-network/iu.test(item)), true);

    const approved = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    const installs = [...approved.metadata.verificationCommands.modules, approved.metadata.verificationCommands.root]
      .filter(Boolean)
      .map((item) => item.dependencyInstall)
      .filter(Boolean);
    assert.equal(approved.canApply, true);
    assert.deepEqual(installs, [
      { command: "npm", args: ["install", "--ignore-scripts"], cwd: "." },
    ]);
    assert.equal(await exists(sentinel), false);

    const invocations = [];
    const report = await applyWithVerifier(
      approved,
      async () => ({ ok: true }),
      {},
      {
        runner: async (command, args, options) => {
          invocations.push({ command, args, cwd: options.cwd, stepId: options.stepId });
          return { command, args, cwd: options.cwd, status: 0 };
        },
      },
    );
    assert.equal(report.ok, true);
    assert.equal(invocations.length, 2);
    assert.equal(invocations.every((item) =>
      item.command === "npm"
      && item.args.join(" ") === "install --ignore-scripts"
      && path.resolve(item.cwd) !== path.resolve(root)), true);
    assert.deepEqual(report.preVerification.dependencyInstalls.map((item) => item.state), ["passed"]);
    assert.deepEqual(report.postVerification.dependencyInstalls.map((item) => item.state), ["passed"]);
    assert.equal(await exists(path.join(root, "node_modules")), false);
  });

  it("reports the fail-closed POSIX upgrade verification capability conflict", () => {
    assert.match(
      upgradePlan.upgradeVerificationPlatformConflict("linux"),
      /POSIX.*detached-session.*native process owner/iu,
    );
    assert.equal(upgradePlan.upgradeVerificationPlatformConflict("win32"), null);
  });

  it("uses the requested verification platform when sealing plan capability", async (context) => {
    const root = await generatedWorkspace(context);
    const posix = await upgradePlan.buildUpgradePlan(root, { allowNetwork: true, platform: "linux" });
    const windows = await upgradePlan.buildUpgradePlan(root, { allowNetwork: true, platform: "win32" });

    assert.equal(posix.canApply, false);
    assert.equal(posix.conflicts.some((item) =>
      /POSIX.*detached-session.*native process owner/iu.test(item)), true);
    assert.equal(windows.canApply, true);
  });

  it("persists a reviewed plan without applying it and prints an exact apply path", async (context) => {
    const root = await generatedWorkspace(context);
    const configPath = path.join(root, ".agentic", "config.json");
    const before = await readFile(configPath, "utf8");
    const result = await upgradeWorkspace(root, { planOut: true, allowNetwork: true });

    assert.equal(result.status, "planned");
    assert.equal(await exists(result.planPath), true);
    assert.equal(await readFile(configPath, "utf8"), before);
    assert.match(result.applyCommand, /upgrade \. --apply-plan /);
    await assert.rejects(
      () => upgradeWorkspace(root, { planOut: ".agentic/config.json", allowNetwork: true }),
      /collides|overwrite|saved under/i,
    );
  });

  it("applies the exact sealed plan once and retains its transaction copy", async (context) => {
    const root = await generatedWorkspace(context);
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    const report = await applyWithVerifier(plan, async () => ({ ok: true }));

    assert.equal(report.ok, true);
    assert.equal(await exists(path.join(root, ".agentic", "transactions", plan.planId, "plan.json")), true);
    await assert.rejects(() => applyWithVerifier(plan, async () => ({ ok: true })), /already been applied/);
  });

  it("keeps consecutive bare upgrades idempotent while re-verifying current state", async (context) => {
    const root = await generatedWorkspace(context);
    const firstPlan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    const first = await applyWithVerifier(firstPlan, async () => ({ ok: true }), { allowCurrentReplay: true });
    const secondPlan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    const second = await applyWithVerifier(secondPlan, async () => ({ ok: true }), { allowCurrentReplay: true });
    assert.equal(first.status, "current");
    assert.equal(second.status, "current");
  });
});

async function gitRepository(context) {
  const root = await temporaryDirectory(context, "workspace-template-seal-git-");
  await execFileAsync("git", ["init", "--quiet", root]);
  return root;
}

async function git(root, ...args) {
  return execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
}

describe("upgrade verification-input sealing", () => {
  it("excludes ignored Git target contents while sealing tracked and untracked source", async (context) => {
    const root = await gitRepository(context);
    await writeFile(path.join(root, ".gitignore"), "target/\ntracked.txt\nignored.txt\n");
    await writeFile(path.join(root, "tracked.txt"), "tracked one\n");
    await mkdir(path.join(root, "tracked-directory"));
    await writeFile(path.join(root, "tracked-directory", "tracked.txt"), "nested tracked\n");
    await writeFile(path.join(root, "untracked.txt"), "untracked one\n");
    await writeFile(path.join(root, "ignored.txt"), "ignored one\n");
    await git(root, "add", "-f", ".gitignore", "tracked.txt", "tracked-directory/tracked.txt");
    const initial = await upgradePlan.sealVerificationInputs(root);

    await mkdir(path.join(root, "target", "debug"), { recursive: true });
    await writeFile(path.join(root, "target", "debug", "artifact.bin"), Buffer.alloc(4 * 1024 * 1024, 0x61));
    await writeFile(path.join(root, "ignored.txt"), "ignored two\n");
    assert.deepEqual(await upgradePlan.sealVerificationInputs(root), initial);

    await writeFile(path.join(root, "tracked.txt"), "tracked two\n");
    const trackedChanged = await upgradePlan.sealVerificationInputs(root);
    assert.notEqual(trackedChanged.hash, initial.hash);
    await writeFile(path.join(root, "untracked.txt"), "untracked two\n");
    const untrackedChanged = await upgradePlan.sealVerificationInputs(root);
    assert.notEqual(untrackedChanged.hash, trackedChanged.hash);
    await rm(path.join(root, "tracked.txt"));
    const trackedMissing = await upgradePlan.sealVerificationInputs(root);
    assert.notEqual(trackedMissing.hash, untrackedChanged.hash);
    assert.deepEqual(await upgradePlan.sealVerificationInputs(root), trackedMissing);
    await rm(path.join(root, "tracked-directory"), { recursive: true });
    const ancestorMissing = await upgradePlan.sealVerificationInputs(root);
    assert.notEqual(ancestorMissing.hash, trackedMissing.hash);
    assert.deepEqual(await upgradePlan.sealVerificationInputs(root), ancestorMissing);
  });

  it("fails closed when a Git marker exists but Git inventory is unavailable", async (context) => {
    const root = await gitRepository(context);
    await mkdir(path.join(root, "target"), { recursive: true });
    await writeFile(path.join(root, "target", "tracked.txt"), "authoritative\n");
    await git(root, "add", "-f", "target/tracked.txt");
    const emptyPath = await temporaryDirectory(context, "workspace-template-empty-path-");
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => name.toLowerCase() !== "path"),
    );
    environment.PATH = emptyPath;
    const moduleUrl = pathToFileURL(path.resolve("src", "upgrade", "plan.js")).href;
    const invocation = `import { sealVerificationInputs } from ${JSON.stringify(moduleUrl)};
      await sealVerificationInputs(process.argv[1]);`;

    await assert.rejects(
      execFileAsync(process.execPath, ["--input-type=module", "--eval", invocation, root], {
        encoding: "utf8",
        env: environment,
      }),
      (error) => /Could not inventory Git verification inputs/iu.test(error.stderr ?? error.message),
    );
  });

  it("uses deterministic non-Git fallback ordering without excluding source by basename", async (context) => {
    async function fixture(order) {
      const root = await temporaryDirectory(context, "workspace-template-seal-fallback-");
      for (const [relative, content] of order) {
        const target = path.join(root, ...relative.split("/"));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content);
      }
      return root;
    }
    const files = [["crates/app/src/main.rs", "fn main() {}\n"], ["packages/ui/index.js", "export default 1;\n"]];
    const first = await fixture(files);
    const second = await fixture([...files].reverse());
    const expected = await upgradePlan.sealVerificationInputs(first);
    assert.deepEqual(await upgradePlan.sealVerificationInputs(second), expected);

    await mkdir(path.join(first, "src", "build"), { recursive: true });
    await writeFile(path.join(first, "src", "build", "authority.json"), "authoritative\n");
    assert.notEqual((await upgradePlan.sealVerificationInputs(first)).hash, expected.hash);
    await rm(path.join(first, "src"), { recursive: true });

    await writeFile(path.join(first, "crates", "app", "Cargo.toml"), "[package]\nname = \"app\"\nversion = \"0.1.0\"\n");
    await writeFile(path.join(first, "packages", "ui", "package.json"), "{}\n");
    const withManifests = await upgradePlan.sealVerificationInputs(first);
    await mkdir(path.join(first, "crates", "app", "target", "debug"), { recursive: true });
    await mkdir(path.join(first, "packages", "ui", "node_modules", "cache"), { recursive: true });
    await writeFile(path.join(first, "crates", "app", "target", "debug", "app.exe"), "generated\n");
    await writeFile(path.join(first, "packages", "ui", "node_modules", "cache", "index.js"), "generated\n");
    assert.deepEqual(await upgradePlan.sealVerificationInputs(first), withManifests);
  });

  it("matches the independent canonical aggregate framing oracle", async (context) => {
    const root = await temporaryDirectory(context, "workspace-template-seal-oracle-");
    await writeFile(path.join(root, "a.txt"), Buffer.from("abc"));

    const hash = await hashVerificationInputs(root, ["a.txt"]);

    assert.equal(hash, "8e683204f578b2e9671ab0ea8ef59f2f7571cb55c237e44d0c82cbfd6816d8a8");
  });

  it("normalizes Windows-style exclusions and preserves CRLF as raw bytes", async (context) => {
    const root = await temporaryDirectory(context, "workspace-template-seal-windows-");
    await mkdir(path.join(root, "nested"));
    await writeFile(path.join(root, "nested", "source.txt"), "alpha\r\nbeta\r\n");
    await writeFile(path.join(root, "nested", "excluded.txt"), "ignored one\r\n");
    const initial = await upgradePlan.sealVerificationInputs(root, ["nested\\excluded.txt"]);
    assert.deepEqual(initial, await upgradePlan.sealVerificationInputs(root, ["nested/excluded.txt"]));
    await writeFile(path.join(root, "nested", "excluded.txt"), "ignored two\r\n");
    assert.deepEqual(initial, await upgradePlan.sealVerificationInputs(root, ["nested\\excluded.txt"]));
    await writeFile(path.join(root, "nested", "source.txt"), "alpha\nbeta\n");
    assert.notEqual((await upgradePlan.sealVerificationInputs(root, ["nested\\excluded.txt"])).hash, initial.hash);
  });

  it("keeps literal backslashes distinct from Git path separators", {
    skip: process.platform === "win32",
  }, async (context) => {
    const root = await gitRepository(context);
    await mkdir(path.join(root, "a"), { recursive: true });
    await writeFile(path.join(root, "a", "b"), "slash\r\n");
    await writeFile(path.join(root, "a\\b"), "backslash\r\n");
    const initial = await upgradePlan.sealVerificationInputs(root);
    await writeFile(path.join(root, "a\\b"), "backslash changed\r\n");
    assert.notEqual((await upgradePlan.sealVerificationInputs(root)).hash, initial.hash);
    await writeFile(path.join(root, "a\\b"), "backslash\r\n");
    await writeFile(path.join(root, "a", "b"), "slash changed\r\n");
    assert.notEqual((await upgradePlan.sealVerificationInputs(root)).hash, initial.hash);
  });

  it("hashes the symlink target string without following target contents", async (context) => {
    const parent = await temporaryDirectory(context, "workspace-template-seal-symlink-");
    const root = path.join(parent, "repo");
    const first = path.join(parent, "first.txt");
    const second = path.join(parent, "second.txt");
    const externalDirectory = path.join(parent, "external-directory");
    const input = path.join(root, "input-link");
    await mkdir(root);
    await mkdir(externalDirectory);
    await writeFile(first, "external one\n");
    await writeFile(second, "external two\n");
    await writeFile(path.join(externalDirectory, "nested.txt"), "nested external one\n");
    try {
      await symlink(first, input, "file");
      await symlink(externalDirectory, path.join(root, "directory-link"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (error.code === "EPERM") return context.skip("symlinks unavailable");
      throw error;
    }
    const before = await upgradePlan.sealVerificationInputs(root);
    await writeFile(first, "changed external bytes\n");
    await writeFile(path.join(externalDirectory, "nested.txt"), "nested external two\n");
    assert.deepEqual(await upgradePlan.sealVerificationInputs(root), before);
    await rm(input);
    await symlink(second, input, "file");
    assert.notEqual((await upgradePlan.sealVerificationInputs(root)).hash, before.hash);
  });

  it("rejects files added after inventory instead of sealing an incomplete set", async (context) => {
    const root = await temporaryDirectory(context, "workspace-template-seal-inventory-race-");
    await writeFile(path.join(root, "reviewed.txt"), "reviewed\n");

    await assert.rejects(
      upgradePlan.sealVerificationInputs(root, [], {
        hooks: {
          async afterInventory() {
            await writeFile(path.join(root, "late-input.js"), "late\n");
          },
        },
      }),
      /verification-input inventory changed while sealing/iu,
    );
  });

  it("rejects terminal, ancestor, and root swaps before reading through them", async (context) => {
    const parent = await temporaryDirectory(context, "workspace-template-seal-race-");
    const root = path.join(parent, "repo");
    const external = path.join(parent, "external.txt");
    await mkdir(root);
    await writeFile(external, "outside\n");
    const terminal = path.join(root, "input.txt");
    await writeFile(terminal, "inside\n");
    await assert.rejects(
      hashVerificationInputs(root, ["input.txt"], [], {
        hooks: {
          async afterTerminalLstat() {
            await rm(terminal);
            await link(external, terminal);
          },
        },
      }),
      /changed between inspection and open/iu,
    );

    const safe = path.join(root, "safe");
    const original = path.join(root, "safe-original");
    const externalDirectory = path.join(parent, "external-directory");
    await mkdir(safe);
    await mkdir(externalDirectory);
    await writeFile(path.join(safe, "input.txt"), "inside\n");
    await writeFile(path.join(externalDirectory, "input.txt"), "outside\n");
    const probe = path.join(root, "link-probe");
    try {
      await symlink(externalDirectory, probe, process.platform === "win32" ? "junction" : "dir");
      await rm(probe);
    } catch (error) {
      if (error.code === "EPERM") return context.skip("directory links unavailable");
      throw error;
    }
    await assert.rejects(
      hashVerificationInputs(root, ["safe/input.txt"], [], {
        hooks: {
          async afterAncestorValidation() {
            await rename(safe, original);
            await symlink(externalDirectory, safe, process.platform === "win32" ? "junction" : "dir");
          },
        },
      }),
      /ancestor changed or became a link/iu,
    );

    const rootSwap = path.join(parent, "root-swap");
    const rootOriginal = path.join(parent, "root-original");
    await mkdir(rootSwap);
    await writeFile(path.join(rootSwap, "input.txt"), "inside\n");
    await assert.rejects(
      upgradePlan.sealVerificationInputs(rootSwap, [], {
        hooks: {
          async afterInventory() {
            await rename(rootSwap, rootOriginal);
            await symlink(externalDirectory, rootSwap, process.platform === "win32" ? "junction" : "dir");
          },
        },
      }),
      /root changed or became a link/iu,
    );
  });

  it("seals a repository larger than the Node string limit under a small heap", {
    timeout: 120_000,
  }, async (context) => {
    const root = await gitRepository(context);
    const handle = await open(path.join(root, "huge-sparse-input.bin"), "w");
    try {
      await handle.truncate(bufferConstants.MAX_STRING_LENGTH + 1);
    } finally {
      await handle.close();
    }
    const moduleUrl = pathToFileURL(path.resolve("src", "upgrade", "plan.js")).href;
    const invocation = `import { sealVerificationInputs } from ${JSON.stringify(moduleUrl)};
      process.stdout.write(JSON.stringify(await sealVerificationInputs(process.argv[1])));`;
    const result = await execFileAsync(process.execPath, [
      "--max-old-space-size=24", "--input-type=module", "--eval", invocation, root,
    ], { encoding: "utf8", timeout: 110_000, maxBuffer: 1024 * 1024 });
    assert.match(JSON.parse(result.stdout).hash, /^[a-f0-9]{64}$/u);
    assert.ok(result.stdout.length < 10_000);
  });

  it("prints a bounded Rust dry-run while substantial target output stays ignored", {
    timeout: 120_000,
  }, async (context) => {
    const parent = await temporaryDirectory(context, "workspace-template-seal-rust-");
    const root = path.join(parent, "rust-app");
    await createProject({
      target: root, project: "rust", style: "functional-core", tdd: "pragmatic",
      packageManager: "npm", agents: [], preset: "sol-codex", install: false,
      git: false, bootstrap: false, force: false, dryRun: false, yes: true,
    });
    await execFileAsync("git", ["init", "--quiet", root]);
    await git(root, "config", "user.name", "Workspace Template Test");
    await git(root, "config", "user.email", "workspace-template@example.invalid");
    await git(root, "add", "--all");
    await git(root, "commit", "--quiet", "-m", "fixture");
    await mkdir(path.join(root, "target", "debug"), { recursive: true });
    const artifact = await open(path.join(root, "target", "debug", "rust-app.pdb"), "w");
    try {
      await artifact.truncate(256 * 1024 * 1024);
    } finally {
      await artifact.close();
    }
    const result = await execFileAsync(process.execPath, [
      path.resolve("bin", "workspace-template.js"), "upgrade", root, "--dry-run", "--json", "--allow-network",
    ], { encoding: "utf8", timeout: 110_000, maxBuffer: 4 * 1024 * 1024 });
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.command, "upgrade");
    assert.equal(plan.canApply, true, plan.conflicts.join("\n"));
    assert.match(plan.metadata.verificationInputs.hash, /^[a-f0-9]{64}$/u);
    assert.ok(result.stdout.length < 4 * 1024 * 1024);
    assert.equal((await git(root, "status", "--short")).stdout, "");
  });
});
