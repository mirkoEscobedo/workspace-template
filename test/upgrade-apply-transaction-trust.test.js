import assert from "node:assert/strict";
import { link, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createProject } from "../src/index.js";
import { ensureDirectory } from "../src/fs-utils.js";
import { applyWithVerifier, buildSupportedUpgradePlan } from "./upgrade-internal-harness.js";

async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "workspace-template-upgrade-transaction-trust-"));
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
  const packagePath = path.join(root, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    delete packageJson[section];
  }
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  return { parent, root };
}

describe("upgrade transaction directory trust", () => {
  it("rejects fresh apply through a precreated plan-directory or transactions-ancestor junction", async (context) => {
    for (const corruption of ["plan-directory", "transactions-ancestor"]) {
      const { parent, root } = await fixture();
      const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
      const transactions = path.join(root, ".agentic", "transactions");
      const external = path.join(parent, `external-${corruption}`);
      await ensureDirectory(external);
      await writeFile(path.join(external, "sentinel.txt"), "outside\n");
      if (corruption === "plan-directory") {
        await ensureDirectory(transactions);
        await symlink(external, path.join(transactions, plan.planId), process.platform === "win32" ? "junction" : "dir");
      } else {
        await rm(transactions, { recursive: true, force: true });
        await symlink(external, transactions, process.platform === "win32" ? "junction" : "dir");
      }
      const before = await readdir(external);

      try {
        await assert.rejects(
          applyWithVerifier(plan, async () => ({ ok: true })),
          /transaction.*real non-symlink|transaction.*trusted root/i,
        );
      } catch (error) {
        if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
          context.skip(`directory links unavailable: ${error.code}`);
          return;
        }
        throw error;
      }
      assert.deepEqual(await readdir(external), before);
      assert.equal(await readFile(path.join(external, "sentinel.txt"), "utf8"), "outside\n");
    }
  });

  it("rejects a precreated journal symlink without appending outside the repository", async (context) => {
    const { parent, root } = await fixture();
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    const transaction = path.join(root, ".agentic", "transactions", plan.planId);
    const sentinel = path.join(parent, "outside-journal.txt");
    await ensureDirectory(transaction);
    await writeFile(sentinel, "");
    try {
      await symlink(sentinel, path.join(transaction, "journal.jsonl"), "file");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
        context.skip(`file links unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    await assert.rejects(
      applyWithVerifier(plan, async () => ({ ok: true })),
      /transaction journal\.jsonl.*safe (?:single-link )?regular file/i,
    );
    assert.equal(await readFile(sentinel, "utf8"), "");
  });

  it("rejects a same-volume hard-linked journal without appending to its outside peer", async (context) => {
    const { parent, root } = await fixture();
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    const transaction = path.join(root, ".agentic", "transactions", plan.planId);
    const sentinel = path.join(parent, "outside-hard-link-journal.txt");
    await ensureDirectory(transaction);
    await writeFile(sentinel, "");
    try {
      await link(sentinel, path.join(transaction, "journal.jsonl"));
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP", "EXDEV"].includes(error.code)) {
        context.skip(`hard links unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    await assert.rejects(
      applyWithVerifier(plan, async () => ({ ok: true })),
      /transaction journal\.jsonl.*single-link regular file/i,
    );
    assert.equal(await readFile(sentinel, "utf8"), "");
  });

  it("rejects a transaction directory swapped after final staging without writing outside", async (context) => {
    const { parent, root } = await fixture();
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    const transaction = path.join(root, ".agentic", "transactions", plan.planId);
    const external = path.join(parent, "outside-after-final-stage");
    await ensureDirectory(external);
    const sentinel = path.join(external, "sentinel.txt");
    await writeFile(sentinel, "outside\n");
    let swapped = false;

    try {
      await assert.rejects(
        applyWithVerifier(plan, async () => ({ ok: true }), {}, {
          hooks: {
            async afterFinalStagedValidation() {
              await rm(transaction, { recursive: true, force: true });
              await symlink(external, transaction, process.platform === "win32" ? "junction" : "dir");
              swapped = true;
            },
          },
        }),
        /transaction.*real non-symlink|transaction.*trusted root/i,
      );
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
        context.skip(`directory links unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    assert.equal(swapped, true);
    assert.deepEqual(await readdir(external), ["sentinel.txt"]);
    assert.equal(await readFile(sentinel, "utf8"), "outside\n");
  });

  it("durably latches manual recovery outside a transaction swapped after mutation", async (context) => {
    const { parent, root } = await fixture();
    const lockPath = path.join(root, ".agentic", "skills.lock.json");
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    lock.source.version = "0.0.0-stale";
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(plan.operations.some((item) => item.kind !== "noop"), true);
    const transaction = path.join(root, ".agentic", "transactions", plan.planId);
    const external = path.join(parent, "outside-after-mutation");
    await ensureDirectory(external);
    const sentinel = path.join(external, "sentinel.txt");
    await writeFile(sentinel, "outside\n");
    let swapped = false;
    let linkError;

    try {
      await assert.rejects(
        applyWithVerifier(plan, async () => ({ ok: true }), {}, {
          hooks: {
            async afterOperationApplied() {
              if (swapped) return;
              await rm(transaction, { recursive: true, force: true });
              try {
                await symlink(external, transaction, process.platform === "win32" ? "junction" : "dir");
              } catch (error) {
                linkError = error;
                throw error;
              }
              swapped = true;
              throw new Error("crash after transaction swap");
            },
          },
        }),
        /manual recovery required/i,
      );
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
        context.skip(`directory links unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    if (linkError && ["EPERM", "EACCES", "ENOTSUP"].includes(linkError.code)) {
      context.skip(`directory links unavailable: ${linkError.code}`);
      return;
    }
    assert.equal(swapped, true);
    assert.deepEqual(await readdir(external), ["sentinel.txt"]);
    assert.equal(await readFile(sentinel, "utf8"), "outside\n");
    const marker = path.join(root, ".agentic", `manual-recovery-required-${plan.planId}.json`);
    assert.match(await readFile(marker, "utf8"), /manual recovery required/i);
    await assert.rejects(
      applyWithVerifier(plan, async () => ({ ok: true })),
      /manual recovery required.*automatic recovery refused/i,
    );
  });
});
