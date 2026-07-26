import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createProject } from "../src/create.js";
import {
  applyPresetPlan,
  buildPresetPlan,
  capturePresetParentIdentity,
  openPresetMutation,
  PRESET_BOOTSTRAP_STAGE_PATH,
} from "../src/presets/index.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prefix = "workspace-template-fallback-process-";
const roots = new Set();

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.add(root);
  await createProject({
    target: root,
    project: "javascript",
    style: "simple",
    tdd: "pragmatic",
    packageManager: "npm",
    agents: ["codex", "opencode"],
    install: false,
    git: false,
    bootstrap: false,
    force: false,
    dryRun: false,
    yes: true,
    docs: true,
    tickets: true,
  });
  return root;
}

async function absent(target) {
  await assert.rejects(() => stat(target), { code: "ENOENT" });
}

async function exited(pid) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`owned process ${pid} survived its bounded cleanup`);
}

after(async () => {
  const owned = [...roots];
  await Promise.all(owned.map((root) => rm(root, { recursive: true, force: true })));
  await Promise.all(owned.map(absent));
});

describe("preset fallback process ownership", () => {
  it("durably leases and exactly reaps a cancelled worker with bounded ACL setup", async () => {
    const root = await workspace();
    const relative = ".agentic/.preset-transactions/.gitignore";
    const expected = await capturePresetParentIdentity(root, relative, { allowMissing: true });
    let nativeSpawn;
    let nativeFinal;
    let worker;
    const session = await openPresetMutation(root, relative, expected, {
      allowCreate: true,
      secureFinal: true,
      async onNativeSpawn(message) {
        nativeSpawn = message;
        assert.deepEqual(JSON.parse(await readFile(message.leasePath, "utf8")), message.lease);
      },
      onNativeFinal(message) {
        nativeFinal = message;
      },
      onWorkerLease(message) {
        worker = message;
      },
    });

    assert.equal(worker.lease.pid, session.pid);
    assert.equal(worker.lease.startIdentity.kind, "owner-nonce");
    assert.match(worker.lease.operationDigest, /^[a-f0-9]{64}$/);
    assert.ok(Date.parse(worker.lease.deadlineAt) > Date.parse(worker.lease.startedAt));
    assert.deepEqual(JSON.parse(await readFile(worker.leasePath, "utf8")), worker.lease);
    if (process.platform === "win32") {
      assert.equal(nativeSpawn.lease.role, "preset-acl-child");
      assert.equal(nativeFinal.lease.finalState.code, 0);
      assert.equal(nativeFinal.lease.state, "closed");
      await exited(nativeSpawn.lease.pid);
      await absent(nativeSpawn.leasePath);
    } else {
      assert.equal(nativeSpawn, undefined);
      assert.equal(nativeFinal, undefined);
    }

    await session.close();
    await exited(session.pid);
    await absent(worker.leasePath);
    await absent(path.join(root, ".agentic", ".preset-transactions"));
    assert.deepEqual(await readdir(path.join(root, ".agent", "leases")), [".gitkeep"]);
  });

  it("lets an unaccepted worker own lease and directory cleanup after parent death", async () => {
    const root = await workspace();
    const control = path.join(root, ".agent", "parent-death.json");
    const moduleUrl = pathToFileURL(
      path.join(repositoryRoot, "src", "presets", "index.js"),
    ).href;
    const script = `
      import { writeFileSync } from "node:fs";
      import { capturePresetParentIdentity, openPresetMutation } from ${JSON.stringify(moduleUrl)};
      const root = ${JSON.stringify(root)};
      const relative = ".agentic/parent-death/nested/file.json";
      const expected = await capturePresetParentIdentity(root, relative, { allowMissing: true });
      await openPresetMutation(root, relative, expected, {
        allowCreate: true,
        onWorkerLease(message) {
          writeFileSync(${JSON.stringify(control)}, JSON.stringify(message));
          process.kill(process.pid, "SIGTERM");
        },
      });
    `;
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: repositoryRoot,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    const worker = JSON.parse(await readFile(control, "utf8"));

    await exited(child.pid);
    await exited(worker.lease.pid);
    await absent(worker.leasePath);
    await absent(path.join(root, ".agentic", "parent-death"));
    await unlink(control);
    assert.deepEqual(await readdir(path.join(root, ".agent", "leases")), [".gitkeep"]);
  });

  it("reaps the exact bounded ACL child when its parent dies during native setup", {
    skip: process.platform !== "win32" ? "icacls is Windows-only" : false,
  }, async () => {
    const root = await workspace();
    const control = path.join(root, ".agent", "native-parent-death.json");
    const moduleUrl = pathToFileURL(
      path.join(repositoryRoot, "src", "presets", "index.js"),
    ).href;
    const script = `
      import { writeFileSync } from "node:fs";
      import { capturePresetParentIdentity, openPresetMutation } from ${JSON.stringify(moduleUrl)};
      const root = ${JSON.stringify(root)};
      const relative = ".agentic/native-parent-death/.gitignore";
      const expected = await capturePresetParentIdentity(root, relative, { allowMissing: true });
      await openPresetMutation(root, relative, expected, {
        allowCreate: true,
        secureFinal: true,
        onNativeSpawn(message) {
          writeFileSync(${JSON.stringify(control)}, JSON.stringify(message));
          process.kill(process.pid, "SIGTERM");
        },
      });
    `;
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: repositoryRoot,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    const native = JSON.parse(await readFile(control, "utf8"));

    await exited(child.pid);
    await exited(native.lease.pid);
    await exited(native.owner.pid);
    await absent(native.leasePath);
    await absent(native.owner.leasePath);
    await absent(path.join(root, ".agentic", "native-parent-death"));
    await unlink(control);
    assert.deepEqual(await readdir(path.join(root, ".agent", "leases")), [".gitkeep"]);
  });

  it("preserves an unowned partial bootstrap stage until exact manual recovery", async () => {
    const root = await workspace();
    const plan = await buildPresetPlan(root, { preset: "sol-codex" });
    const stage = path.join(root, ...PRESET_BOOTSTRAP_STAGE_PATH.split("/"));
    const original = await readFile(path.join(root, ".agentic", "config.json"));
    let workerPid;

    await assert.rejects(
      () => applyPresetPlan(plan, {
        hooks: {
          workerFailurePoint({ stage: operation }) {
            return operation === "bootstrap" ? "partial" : undefined;
          },
          onWorkerSpawn({ stage: operation, pid }) {
            if (operation === "bootstrap") workerPid = pid;
          },
        },
      }),
      /manual recovery.*\.agentic[\\/]\.preset-transaction\.stage/i,
    );

    const residue = await readFile(stage, "utf8");
    assert.match(residue, /"version": 5/);
    assert.doesNotMatch(residue, /content|PRIVATE-PRESET-SNAPSHOT-CANARY/);
    assert.deepEqual(await readFile(path.join(root, ".agentic", "config.json")), original);
    await absent(path.join(root, ".agentic", ".preset-transactions"));
    assert.throws(() => process.kill(workerPid, 0), (error) => error.code === "ESRCH");
    assert.deepEqual(await readdir(path.join(root, ".agent", "leases")), [".gitkeep"]);
    await assert.rejects(
      () => buildPresetPlan(root, { preset: "sol-codex" }),
      /manual recovery.*\.agentic[\\/]\.preset-transaction\.stage/i,
    );
    assert.equal(await readFile(stage, "utf8"), residue);

    await unlink(stage);
    await applyPresetPlan(plan);
    await absent(stage);
  });
});
