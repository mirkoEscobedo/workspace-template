import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, it } from "node:test";
import { createProject } from "../src/create.js";
import { applyWithVerifier, buildSupportedUpgradePlan } from "./upgrade-internal-harness.js";

const execFileAsync = promisify(execFile);

async function git(root, ...args) {
  return execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
}

async function repository(context) {
  const parent = await mkdtemp(path.join(os.tmpdir(), "workspace-template-verification-boundary-"));
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
  await git(root, "init", "--quiet");
  await git(root, "config", "user.name", "Workspace Template Test");
  await git(root, "config", "user.email", "workspace-template@example.invalid");
  return { parent, root };
}

async function commitAll(root, message) {
  await git(root, "add", "--all");
  await git(root, "commit", "--quiet", "-m", message);
}

describe("upgrade verification-input boundaries", () => {
  it("applies with distinct POSIX files whose names use slash and literal backslash", {
    skip: process.platform === "win32",
  }, async (context) => {
    const { root } = await repository(context);
    await mkdir(path.join(root, "a"), { recursive: true });
    await writeFile(path.join(root, "a", "b"), "slash\n");
    await writeFile(path.join(root, "a\\b"), "backslash\n");
    await commitAll(root, "fixture");

    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(plan.canApply, true, plan.conflicts.join("\n"));
    let verificationRuns = 0;
    const report = await applyWithVerifier(plan, async (checkpointRoot) => {
      verificationRuns += 1;
      assert.equal(await readFile(path.join(checkpointRoot, "a", "b"), "utf8"), "slash\n");
      assert.equal(await readFile(path.join(checkpointRoot, "a\\b"), "utf8"), "backslash\n");
      return { ok: true };
    });

    assert.equal(report.ok, true);
    assert.equal(verificationRuns, 2);
  });

  it("blocks a tracked Git submodule during planning", async (context) => {
    const { parent, root } = await repository(context);
    const submodule = path.join(parent, "local-submodule");
    await mkdir(submodule);
    await git(submodule, "init", "--quiet");
    await git(submodule, "config", "user.name", "Workspace Template Test");
    await git(submodule, "config", "user.email", "workspace-template@example.invalid");
    await writeFile(path.join(submodule, "README.md"), "local submodule\n");
    await commitAll(submodule, "submodule fixture");
    await commitAll(root, "workspace fixture");
    await git(
      root,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "--quiet",
      submodule,
      "vendor/local-submodule",
    );
    await commitAll(root, "track local submodule");

    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });

    assert.equal(plan.canApply, false);
    assert.equal(
      plan.conflicts.some((conflict) =>
        /Git submodule.*vendor\/local-submodule.*cannot be sealed/iu.test(conflict)),
      true,
      plan.conflicts.join("\n"),
    );
  });

  it("blocks an untracked embedded Git repository during planning", async (context) => {
    const { root } = await repository(context);
    await commitAll(root, "workspace fixture");
    const nested = path.join(root, "vendor", "nested");
    await mkdir(nested, { recursive: true });
    await git(nested, "init", "--quiet");
    await writeFile(path.join(nested, "README.md"), "embedded repository\n");

    const plan = await buildSupportedUpgradePlan(root, {
      allowDirty: true,
      allowNetwork: true,
    });

    assert.equal(plan.canApply, false);
    assert.equal(
      plan.conflicts.some((conflict) =>
        /Embedded Git repository.*vendor\/nested.*cannot be sealed/iu.test(conflict)),
      true,
      plan.conflicts.join("\n"),
    );
  });
});
