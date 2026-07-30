import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, readdir, readlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { applyUpgradePlan, createProject, refreshPlanId } from "../src/index.js";
import { exists } from "../src/fs-utils.js";
import { applyWithVerifier, buildSupportedUpgradePlan } from "./upgrade-internal-harness.js";

async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "workspace-template-upgrade-rejection-"));
  const root = path.join(parent, "repo");
  await createProject({
    target: root, project: "javascript", style: "functional-core", tdd: "pragmatic",
    packageManager: "npm", agents: [], preset: "sol-codex",
    install: false, git: false, bootstrap: false, force: false, dryRun: false, yes: true,
  });
  const packagePath = path.join(root, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) delete packageJson[section];
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  return root;
}

async function workspaceSnapshot(root) {
  const snapshot = {};
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      const details = await lstat(absolute);
      if (details.isSymbolicLink()) snapshot[relative] = { type: "symlink", target: await readlink(absolute) };
      else if (details.isDirectory()) {
        snapshot[relative] = { type: "directory" };
        await walk(absolute);
      } else {
        snapshot[relative] = { type: "file", content: (await readFile(absolute)).toString("base64") };
      }
    }
  }
  await walk(root);
  return snapshot;
}

describe("upgrade apply rejection boundary", () => {
  it("rejects a stale plan without any persistent workspace write", async () => {
    const root = await fixture();
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    const configPath = path.join(root, ".agentic", "config.json");
    await writeFile(configPath, `${await readFile(configPath, "utf8")}\n`);
    const before = await workspaceSnapshot(root);
    await assert.rejects(() => applyUpgradePlan(plan), /preconditions no longer hold/i);
    assert.deepEqual(await workspaceSnapshot(root), before);
  });

  it("rejects a replayed plan without any persistent workspace write", async () => {
    const root = await fixture();
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    await applyWithVerifier(plan, async () => ({ ok: true }));
    const before = await workspaceSnapshot(root);
    await assert.rejects(() => applyUpgradePlan(plan), /already been applied/i);
    assert.deepEqual(await workspaceSnapshot(root), before);
  });

  it("rejects a tampered plan without any persistent workspace write", async () => {
    const root = await fixture();
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    const tampered = { ...plan, metadata: { ...plan.metadata, incomingVersion: "tampered" } };
    const before = await workspaceSnapshot(root);
    await assert.rejects(() => applyUpgradePlan(tampered), /integrity|plan ID/i);
    assert.deepEqual(await workspaceSnapshot(root), before);
  });

  it("rejects changed repository-local verification inputs before product writes", async () => {
    const root = await fixture();
    const configPath = path.join(root, ".agentic", "config.json");
    const original = await readFile(configPath, "utf8");
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    await writeFile(path.join(root, "verification-input.js"), "changed after review\n");

    await assert.rejects(
      () => applyWithVerifier(plan, async () => ({ ok: true })),
      /verification inputs changed after.*sealed/iu,
    );
    assert.equal(await readFile(configPath, "utf8"), original);
  });

  it("rejects a pre-verifier source mutation before product writes", async () => {
    const root = await fixture();
    const inputPath = path.join(root, "verification-input.js");
    await writeFile(inputPath, "reviewed\n");
    const configPath = path.join(root, ".agentic", "config.json");
    const original = await readFile(configPath, "utf8");
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });

    await assert.rejects(
      () => applyWithVerifier(plan, async () => {
        await writeFile(inputPath, "mutated by verifier\n");
        return { ok: true };
      }),
      /verification inputs changed after.*sealed/iu,
    );
    assert.equal(await readFile(configPath, "utf8"), original);
  });

  it("never copies or executes a file added after the pre-verification inventory", async () => {
    const root = await fixture();
    const lateInput = path.join(root, "late-verification-input.js");
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    let verifierRan = false;
    let injected = false;

    await assert.rejects(
      () => applyWithVerifier(
        plan,
        async (checkpointRoot) => {
          verifierRan = true;
          assert.equal(await exists(path.join(checkpointRoot, "late-verification-input.js")), false);
          return { ok: true };
        },
        {},
        {
          hooks: {
            async afterVerificationInputSeal() {
              if (injected) return;
              injected = true;
              await writeFile(lateInput, "late\n");
            },
          },
        },
      ),
      /verification inputs changed after.*sealed/iu,
    );
    assert.equal(verifierRan, true);
  });

  it("rejects an edited operation that touches a sealed verification manifest", async () => {
    const root = await fixture();
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    const manifest = await readFile(path.join(root, "package.json"));
    const edited = refreshPlanId({
      ...plan,
      operations: [...plan.operations, {
        kind: "update-upgrade-managed",
        path: "package.json",
        contentEncoding: "base64",
        content: manifest.toString("base64"),
      }],
    });

    await assert.rejects(
      () => applyWithVerifier(edited, async () => ({ ok: true })),
      /touches a sealed verification input/iu,
    );
  });
});
