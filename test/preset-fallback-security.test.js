import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
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
  PRESET_TRANSACTION_PATH,
} from "../src/presets/index.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoots = [];
after(async () => { const owned = [...temporaryRoots]; await Promise.all(owned.map((root) => rm(root, { recursive: true, force: true }))); await Promise.all(owned.map((root) => assert.rejects(() => stat(root), { code: "ENOENT" }))); });
async function temporary(prefix) { const root = await mkdtemp(path.join(os.tmpdir(), prefix)); temporaryRoots.push(root); return root; }
function projectOptions(target, preset = undefined) {
  return {
    target, preset, project: "javascript", style: "simple", tdd: "pragmatic",
    packageManager: "npm", agents: ["codex", "opencode"],
    install: false, git: false, bootstrap: false, force: false, dryRun: false,
    yes: true, docs: true, tickets: true,
  };
}

async function workspace(preset = undefined) {
  const root = await temporary("workspace-template-fallback-security-");
  await createProject(projectOptions(root, preset));
  return root;
}

async function interruptApplyProcess(plan, stage = "afterWrite") {
  const moduleUrl = pathToFileURL(path.join(repositoryRoot, "src", "presets", "index.js")).href;
  const planPath = path.join(plan.root, ".agentic", "crash-plan.json");
  const workerPidPath = path.join(plan.root, ".agentic", "crash-worker.pid");
  const hook = {
    afterWrite: "afterWrite({ index }) { if (index === 0) process.kill(process.pid, 'SIGTERM'); }",
    afterSnapshot: "afterSnapshot({ index }) { if (index === 0) process.kill(process.pid, 'SIGTERM'); }",
    beforeCreatedParentSeal: `beforeCreatedParentSeal({ operation, workerPid }) {
      if (operation.path.startsWith(".codex/agents/")) {
        writeFileSync(${JSON.stringify(workerPidPath)}, String(workerPid));
        process.kill(process.pid, "SIGTERM");
      }
    }`,
    afterStorageParentCreated: `afterStorageParentCreated({ workerPid }) {
      writeFileSync(${JSON.stringify(workerPidPath)}, String(workerPid));
      process.kill(process.pid, "SIGTERM");
    }`,
    afterJournalParentSeal: `afterJournalParentSeal({ workerPid }) {
      writeFileSync(${JSON.stringify(workerPidPath)}, String(workerPid)); process.kill(process.pid, "SIGTERM");
    }`,
    afterBootstrapJournal: `afterBootstrapJournal({ workerPid }) {
      writeFileSync(${JSON.stringify(workerPidPath)}, String(workerPid));
      process.kill(process.pid, "SIGTERM");
    }`,
    afterCreatedParentSeal: `afterCreatedParentSeal({ operation, workerPid }) {
      if (operation.path.startsWith(".codex/agents/")) {
        writeFileSync(${JSON.stringify(workerPidPath)}, String(workerPid));
        process.kill(process.pid, "SIGTERM");
      }
    }`,
    ...Object.fromEntries(["bootstrap", "ignore", "snapshot", "product"].map((partial) => [
      `${partial}Partial`,
      `workerFailurePoint({ stage, index }) { return stage === "${partial}" && (index ?? 0) === 0 ? "partial" : undefined; },
       onWorkerSpawn({ stage, pid }) { if (stage === "${partial}") writeFileSync(${JSON.stringify(workerPidPath)}, String(pid)); }`,
    ])),
  }[stage];
  if (!hook) throw new Error(`Unsupported interruption stage: ${stage}`);
  await writeFile(planPath, `${JSON.stringify(plan)}\n`);
  const script = `
    import { readFile } from "node:fs/promises";
    import { writeFileSync } from "node:fs";
    import { applyPresetPlan } from ${JSON.stringify(moduleUrl)};
    const plan = JSON.parse(await readFile(${JSON.stringify(planPath)}, "utf8"));
    await applyPresetPlan(plan, {
      hooks: { ${hook} }
    });
  `;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: repositoryRoot,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("interrupted preset apply child exceeded 15 seconds"));
    }, 15_000);
    child.once("error", reject);
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
  assert.ok(result.signal === "SIGTERM" || result.code !== 0, stderr);
  assert.throws(
    () => process.kill(child.pid, 0),
    (error) => error.code === "ESRCH",
    `interrupted helper PID ${child.pid} must be reaped`,
  );
  let workerPid = null;
  try {
    workerPid = Number.parseInt(await readFile(workerPidPath, "utf8"), 10);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return { planPath, pid: child.pid, workerPid, workerPidPath };
}

async function assertProcessExited(pid) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`owned worker PID ${pid} survived its parent`);
}

describe("preset fallback transaction security", () => {
  it("predeclares every recovery snapshot in the first durable journal", async () => {
    const root = await workspace();
    const plan = await buildPresetPlan(root, { preset: "sol-codex" });
    let inspected = false;

    await assert.rejects(
      () => applyPresetPlan(plan, {
        hooks: {
          async afterJournal({ journal, transactionDirectory }) {
            inspected = true;
            assert.equal(PRESET_TRANSACTION_PATH, ".agentic/.preset-transaction.json");
            assert.equal(
              path.relative(root, transactionDirectory).split(path.sep).join("/"),
              ".agentic/.preset-transactions",
            );
            assert.equal(journal.journalStagingPath, ".agentic/.preset-transaction.stage");
            assert.equal(
              journal.storage.ignoreStagePath,
              ".agentic/.preset-transactions/.gitignore.stage",
            );
            for (const entry of journal.entries) {
              assert.equal(
                entry.stagingPath,
                entry.desiredHash === null
                  ? null
                  : `.agentic/.preset-transactions/${plan.planId}/stages/desired/${entry.index}.bin`,
              );
              if (entry.original.hash === null) {
                assert.equal(entry.original.snapshotPath, null);
                assert.equal(entry.restoreStagePath, null);
                continue;
              }
              assert.equal(
                entry.original.snapshotPath,
                `.agentic/.preset-transactions/${plan.planId}/snapshots/${entry.index}.bin`,
              );
              assert.equal(
                entry.restoreStagePath,
                `.agentic/.preset-transactions/${plan.planId}/stages/restore/${entry.index}.bin`,
              );
              await assert.rejects(
                () => readFile(path.join(root, ...entry.original.snapshotPath.split("/"))),
                { code: "ENOENT" },
              );
            }
            assert.equal(
              JSON.parse(
                await readFile(path.join(root, ...PRESET_TRANSACTION_PATH.split("/")), "utf8"),
              ).entries.every(
                (entry) => entry.stagingPath
                  && (entry.original.hash === null || typeof entry.original.snapshotPath === "string"),
              ),
              true,
            );
            throw new Error("abort before snapshot write");
          },
        },
      }),
      /abort before snapshot write/,
    );
    assert.equal(inspected, true);
    await assert.rejects(
      () => readFile(path.join(root, ...PRESET_TRANSACTION_PATH.split("/"))),
      { code: "ENOENT" },
    );
  });

  it("cleans created parents and synchronously reaps a worker rejected during readiness", async () => {
    const root = await workspace();
    const relative = ".agentic/worker-ready-gap/nested/file.json";
    const expected = await capturePresetParentIdentity(root, relative, { allowMissing: true });
    expected.at(-1).path = ".agentic/worker-ready-gap/substituted";
    let workerPid = null;

    await assert.rejects(
      () => openPresetMutation(root, relative, expected, {
        allowCreate: true,
        onWorkerSpawn(pid) {
          workerPid = pid;
        },
      }),
      /parent chain changed/,
    );
    assert.equal(Number.isInteger(workerPid), true);
    assert.throws(
      () => process.kill(workerPid, 0),
      (error) => error.code === "ESRCH",
      `rejected worker PID ${workerPid} must be reaped before openPresetMutation rejects`,
    );
    await assert.rejects(
      () => stat(path.join(root, ".agentic", "worker-ready-gap")),
      { code: "ENOENT" },
    );

    const acceptedRelative = ".agentic/worker-accept-gap/file.json";
    const acceptedParents = await capturePresetParentIdentity(
      root,
      acceptedRelative,
      { allowMissing: true },
    );
    const session = await openPresetMutation(root, acceptedRelative, acceptedParents, {
      allowCreate: true,
    });
    const acknowledgement = await session.acceptCreatedParents(async () => {});
    assert.deepEqual(acknowledgement, { type: "accepted", pid: session.pid });
    await session.close();
    assert.equal((await stat(path.join(root, ".agentic", "worker-accept-gap"))).isDirectory(), true);
    await rm(path.join(root, ".agentic", "worker-accept-gap"), { recursive: true });
  });

  it("recovers every bootstrap, staging, and post-accept crash without orphans", async () => {
    const stages = ["afterStorageParentCreated", "afterJournalParentSeal",
      "afterBootstrapJournal", "ignorePartial", "snapshotPartial", "productPartial",
      "afterCreatedParentSeal"];
    for (const stage of stages) {
      const root = await workspace();
      if (stage === "afterCreatedParentSeal") {
        await rm(path.join(root, ".codex", "agents"), { recursive: true });
      }
      const plan = await buildPresetPlan(root, { preset: "sol-codex" });
      const interrupted = await interruptApplyProcess(plan, stage);
      assert.equal(Number.isInteger(interrupted.workerPid), true, stage);
      await assertProcessExited(interrupted.workerPid);
      if (["afterStorageParentCreated", "bootstrapPartial", "afterJournalParentSeal"].includes(stage)) {
        await assert.rejects(() => stat(path.join(root, ".agentic", ".preset-transactions")), { code: "ENOENT" });
      }
      if (stage === "afterBootstrapJournal") {
        assert.deepEqual(await readdir(path.join(root, ".agentic", ".preset-transactions")), []);
      }
      if (stage === "afterCreatedParentSeal") {
        assert.deepEqual(await readdir(path.join(root, ".codex", "agents")), []);
      }
      if (["afterJournalParentSeal", "afterBootstrapJournal", "ignorePartial", "afterCreatedParentSeal"].includes(stage)) {
        const journalDetails = await stat(path.join(root, ...PRESET_TRANSACTION_PATH.split("/")));
        assert.equal(journalDetails.isFile(), true);
      }
      await applyPresetPlan(plan);
      await assert.rejects(() => readFile(path.join(root, ...PRESET_TRANSACTION_PATH.split("/"))), { code: "ENOENT" });
      const remaining = await readdir(root, { recursive: true });
      assert.equal(remaining.some((item) => item.endsWith(".stage") || item.includes(plan.planId)), false, stage);
      await unlink(interrupted.planPath);
      await unlink(interrupted.workerPidPath);
    }
  });

  it("marks manifest-last success committed before cleanup and only resumes cleanup on error", async () => {
    const root = await workspace();
    const plan = await buildPresetPlan(root, { preset: "sol-codex" });
    let cleanupCount = 0;

    await assert.rejects(
      () => applyPresetPlan(plan, {
        hooks: {
          async afterTransactionCleanup({ kind }) {
            if (kind !== "snapshot") return;
            cleanupCount += 1;
            if (cleanupCount === 1) {
              assert.equal(
                JSON.parse(
                  await readFile(
                    path.join(root, ...PRESET_TRANSACTION_PATH.split("/")),
                    "utf8",
                  ),
                ).phase,
                "committed",
              );
              throw new Error("cleanup interrupted after first deletion");
            }
          },
        },
      }),
      /cleanup interrupted after first deletion/,
    );
    assert.equal(cleanupCount, 1);
    assert.equal(
      JSON.parse(await readFile(path.join(root, ".agentic", "config.json"), "utf8")).execution.preset.id,
      "sol-codex",
    );
    await assert.rejects(
      () => readFile(path.join(root, ...PRESET_TRANSACTION_PATH.split("/"))),
      { code: "ENOENT" },
    );
    await assert.rejects(
      () => stat(path.join(root, ".agentic", ".preset-transactions", plan.planId)),
      { code: "ENOENT" },
    );
  });

  it("reallocates an unsafe persisted broker role ID inside the direct agents directory", async () => {
    const root = await workspace("sol-codex");
    const configPath = path.join(root, ".agentic", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.execution.preset.fallbacks.codexChildModelRefusal.brokerRoleId = "../outside";
    config.execution.preset.roleIds.broker.codexChildModelRefusal = "../outside";
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const plan = await buildPresetPlan(root, { preset: "sol-codex", allowDirty: true });
    const brokerRoleId = plan.metadata.preset.fallbacks.codexChildModelRefusal.brokerRoleId;
    assert.match(brokerRoleId, /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
    assert.notEqual(brokerRoleId, "../outside");
    const brokerOperations = plan.operations.filter((operation) => (
      operation.path.includes("spark-broker") || operation.path.includes("spark_broker")
    ));
    assert.ok(brokerOperations.length > 0);
    for (const operation of brokerOperations) {
      assert.equal(path.posix.dirname(operation.path), ".codex/agents");
      assert.equal(operation.path.includes(".."), false);
    }
  });

  it("recreates missing managed parents and removes only its empty parents on rollback", async () => {
    const root = await workspace();
    const agents = path.join(root, ".codex", "agents");
    await rm(agents, { recursive: true });
    const plan = await buildPresetPlan(root, { preset: "sol-codex" });
    let injected = false;

    await assert.rejects(
      () => applyPresetPlan(plan, {
        hooks: {
          afterWrite({ operation }) {
            if (!injected && operation.path.startsWith(".codex/agents/")) {
              injected = true;
              throw new Error("missing-parent rollback");
            }
          },
        },
      }),
      /missing-parent rollback/,
    );
    await assert.rejects(() => stat(agents), { code: "ENOENT" });

    await applyPresetPlan(plan);
    assert.equal((await stat(agents)).isDirectory(), true);
    assert.equal(
      JSON.parse(await readFile(path.join(root, ".agentic", "config.json"), "utf8")).execution.preset.id,
      "sol-codex",
    );
  });

  it("keeps recovery bytes restricted and self-ignored outside reports and journal metadata", async () => {
    const root = await workspace();
    const marker = "PRIVATE-PRESET-SNAPSHOT-CANARY";
    const configPath = path.join(root, ".agentic", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.privateSnapshotMarker = marker;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    assert.equal(spawnSync("git", ["init", "--quiet"], { cwd: root }).status, 0);
    const plan = await buildPresetPlan(root, { preset: "sol-codex", allowDirty: true });
    let inspected = false;

    const report = await applyPresetPlan(plan, {
      hooks: {
        async afterPrivateStage({ operation, entry, journal }) {
          if (inspected || operation.path !== ".agentic/config.json") return;
          inspected = true;
          const transactionDirectory = path.join(root, ".agentic", ".preset-transactions");
          const journalText = JSON.stringify(journal);
          assert.equal(journalText.includes(marker), false);
          assert.equal(journalText.includes(Buffer.from(marker).toString("base64")), false);
          assert.ok(entry.original.snapshotPath);
          assert.match(
            await readFile(path.join(root, ...entry.original.snapshotPath.split("/")), "utf8"),
            new RegExp(marker),
          );
          const privateStage = path.join(root, ...entry.stagingPath.split("/"));
          assert.match(await readFile(privateStage, "utf8"), new RegExp(marker));
          assert.equal((await stat(privateStage)).dev, (await stat(path.dirname(configPath))).dev);
          assert.equal(await readFile(path.join(transactionDirectory, ".gitignore"), "utf8"), "*\n");
          const status = spawnSync(
            "git",
            ["status", "--porcelain", "--untracked-files=all"],
            { cwd: root, encoding: "utf8" },
          );
          assert.equal(status.status, 0, status.stderr);
          assert.doesNotMatch(status.stdout, /\.preset-transactions/);
          assert.doesNotMatch(spawnSync("git", ["diff", "--cached"], { cwd: root, encoding: "utf8" }).stdout, new RegExp(marker));
          if (process.platform === "win32") {
            const acl = spawnSync("icacls.exe", [transactionDirectory], { encoding: "utf8" });
            assert.equal(acl.status, 0, acl.stderr);
            assert.doesNotMatch(acl.stdout, /Everyone|BUILTIN\\Users|Authenticated Users/i);
          } else {
            assert.equal((await stat(transactionDirectory)).mode & 0o077, 0);
          }
        },
      },
    });
    assert.equal(inspected, true);
    assert.equal(JSON.stringify(report).includes(marker), false);
    await assert.rejects(
      () => stat(path.join(root, ".agentic", ".preset-transactions", plan.planId)),
      { code: "ENOENT" },
    );
  });

  it("fails closed and preserves same-parent drift introduced before mutation", async () => {
    const root = await workspace();
    const plan = await buildPresetPlan(root, { preset: "sol-codex" });
    const configPath = path.join(root, ".agentic", "config.json");
    const original = await readFile(configPath);
    const drift = Buffer.from('{"thirdParty":"before-mutation"}\n');
    let substituted = false;

    await assert.rejects(
      () => applyPresetPlan(plan, {
        hooks: {
          async beforeMutation({ operation }) {
            if (!substituted && operation.path === ".agentic/config.json") {
              substituted = true;
              await writeFile(configPath, drift);
            }
          },
        },
      }),
      /rollback was incomplete|third-party drift|Pinned mutation target changed/,
    );
    assert.deepEqual(await readFile(configPath), drift);
    const journalPath = path.join(root, ...PRESET_TRANSACTION_PATH.split("/"));
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    assert.equal(
      journal.entries.find((entry) => entry.path === ".agentic/config.json").state,
      "authoring",
    );

    await writeFile(configPath, original);
    await applyPresetPlan(plan);
    await assert.rejects(() => readFile(journalPath), { code: "ENOENT" });
  });

  it("does not overwrite third-party drift after an authored transaction write", async () => {
    const root = await workspace();
    const plan = await buildPresetPlan(root, { preset: "sol-codex" });
    const configPath = path.join(root, ".agentic", "config.json");
    const original = await readFile(configPath);
    const drift = Buffer.from('{"thirdParty":"after-tool-write"}\n');
    let substituted = false;

    await assert.rejects(
      () => applyPresetPlan(plan, {
        hooks: {
          async afterWrite({ operation }) {
            if (!substituted && operation.path === ".agentic/config.json") {
              substituted = true;
              await writeFile(configPath, drift);
              throw new Error("third-party substitution after write");
            }
          },
        },
      }),
      /rollback was incomplete|third-party drift/,
    );
    assert.deepEqual(await readFile(configPath), drift);
    const journalPath = path.join(root, ...PRESET_TRANSACTION_PATH.split("/"));
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    assert.equal(
      journal.entries.find((entry) => entry.path === ".agentic/config.json").state,
      "authored",
    );

    await writeFile(configPath, original);
    await applyPresetPlan(plan);
    await assert.rejects(() => readFile(journalPath), { code: "ENOENT" });
  });

  it("rolls back every preset artifact exactly and commits the managed manifest last", async () => {
    const root = await workspace();
    const plan = await buildPresetPlan(root, { preset: "sol-codex" });
    assert.equal(plan.operations.at(-1).path, ".agentic/managed-files.json");
    assert.equal(
      plan.operations.some((operation) => operation.path === ".agentic/preset-report.json"),
      true,
    );

    const writeOperations = plan.operations.filter((operation) => operation.kind !== "noop");
    const prior = new Map();
    for (const operation of writeOperations) {
      try {
        prior.set(operation.path, await readFile(path.join(root, ...operation.path.split("/"))));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        prior.set(operation.path, null);
      }
    }

    for (let failAfter = 0; failAfter < writeOperations.length; failAfter += 1) {
      await assert.rejects(
        () => applyPresetPlan(plan, {
          hooks: {
            afterWrite({ index }) {
              if (index === failAfter) throw new Error(`injected write failure ${failAfter}`);
            },
          },
        }),
        new RegExp(`injected write failure ${failAfter}`),
      );
      for (const [relative, expected] of prior) {
        const target = path.join(root, ...relative.split("/"));
        if (expected === null) {
          await assert.rejects(() => readFile(target), { code: "ENOENT" });
        } else {
          assert.deepEqual(await readFile(target), expected, `rollback mismatch for ${relative}`);
        }
      }
    }

    const writeOrder = [];
    const report = await applyPresetPlan(plan, {
      hooks: {
        afterWrite({ operation }) {
          writeOrder.push(operation.path);
        },
      },
    });
    assert.equal(writeOrder.at(-1), ".agentic/managed-files.json");
    assert.equal(report.planId, plan.planId);
    assert.equal(report.preset.id, "sol-codex");
    assert.equal(
      JSON.parse(await readFile(path.join(root, ".agentic", "preset-report.json"), "utf8")).planId,
      plan.planId,
    );
  });

  it("leaves caught cancellation fully rolled back with no pending journal", async () => {
    const root = await workspace();
    const plan = await buildPresetPlan(root, { preset: "sol-codex" });
    const priorConfig = await readFile(path.join(root, ".agentic", "config.json"));
    const cancellation = new Error("cancelled preset apply");
    cancellation.name = "AbortError";

    await assert.rejects(
      () => applyPresetPlan(plan, {
        hooks: {
          afterWrite({ index }) {
            if (index === 1) throw cancellation;
          },
        },
      }),
      (error) => error === cancellation,
    );
    assert.deepEqual(await readFile(path.join(root, ".agentic", "config.json")), priorConfig);
    await assert.rejects(
      () => readFile(path.join(root, ...PRESET_TRANSACTION_PATH.split("/"))),
      { code: "ENOENT" },
    );
  });

  it("fails planning closed and recovers predeclared snapshots after a snapshot-only interruption", async () => {
    const root = await workspace();
    const plan = await buildPresetPlan(root, { preset: "sol-codex" });
    const writeOperations = plan.operations.filter((operation) => operation.kind !== "noop");
    const prior = new Map();
    for (const operation of writeOperations) {
      try {
        prior.set(operation.path, await readFile(path.join(root, ...operation.path.split("/"))));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        prior.set(operation.path, null);
      }
    }

    const interrupted = await interruptApplyProcess(plan, "afterSnapshot");
    const journalPath = path.join(root, ...PRESET_TRANSACTION_PATH.split("/"));
    assert.equal(
      JSON.parse(await readFile(journalPath, "utf8")).planId,
      plan.planId,
    );
    await assert.rejects(
      () => buildPresetPlan(root, { preset: "sol-codex", allowDirty: true }),
      /recovery is pending/,
    );

    await applyPresetPlan(plan, {
      hooks: {
        async afterJournal() {
          for (const [relative, expected] of prior) {
            const target = path.join(root, ...relative.split("/"));
            if (expected === null) await assert.rejects(() => readFile(target), { code: "ENOENT" });
            else assert.deepEqual(await readFile(target), expected, `recovery mismatch for ${relative}`);
          }
        },
      },
    });
    assert.equal(
      JSON.parse(await readFile(path.join(root, ".agentic", "config.json"), "utf8")).execution.preset.id,
      "sol-codex",
    );
    await assert.rejects(
      () => readFile(journalPath),
      { code: "ENOENT" },
    );
    await unlink(interrupted.planPath);
  });

  it("rejects junction ancestors during preflight without writing outside the root", async () => {
    const root = await workspace();
    const agents = path.join(root, ".codex", "agents");
    const backup = path.join(root, ".codex", "agents-original");
    const outside = await temporary("workspace-template-outside-");
    await rename(agents, backup);
    await symlink(outside, agents, "junction");
    try {
      await assert.rejects(
        () => buildPresetPlan(root, { preset: "sol-codex", allowDirty: true }),
        /ancestor must be a real directory/,
      );
      assert.deepEqual(await readdir(outside), []);
    } finally {
      await unlink(agents);
      await rename(backup, agents);
    }
  });

  it("fails closed on parent substitution and recovers after the safe parent is restored", async () => {
    const root = await workspace();
    const plan = await buildPresetPlan(root, { preset: "sol-codex" });
    const agents = path.join(root, ".codex", "agents");
    const backup = path.join(root, ".codex", "agents-original");
    const outside = await temporary("workspace-template-outside-");
    let substituted = false;
    let replacementInstalled = false;

    await assert.rejects(
      () => applyPresetPlan(plan, {
        hooks: {
          async beforeMutation({ operation }) {
            if (!substituted && operation.path.startsWith(".codex/agents/")) {
              substituted = true;
              await rename(agents, backup);
              await symlink(outside, agents, "junction");
              replacementInstalled = true;
            }
          },
        },
      }),
      /rollback was incomplete|parent identity changed|EBUSY|resource busy or locked/,
    );
    assert.deepEqual(await readdir(outside), []);
    if (process.platform === "win32") {
      assert.equal(
        replacementInstalled,
        false,
        "Windows must hold the pinned cwd so replacing the parent fails before mutation",
      );
    }
    const journalPath = path.join(root, ...PRESET_TRANSACTION_PATH.split("/"));
    if (replacementInstalled) {
      assert.equal(JSON.parse(await readFile(journalPath, "utf8")).planId, plan.planId);
      await unlink(agents);
      await rename(backup, agents);
    } else {
      await assert.rejects(() => readFile(journalPath), { code: "ENOENT" });
      assert.equal((await stat(agents)).isDirectory(), true);
    }
    await applyPresetPlan(plan);
    assert.deepEqual(await readdir(outside), []);
    await assert.rejects(() => readFile(journalPath), { code: "ENOENT" });
  });
});
