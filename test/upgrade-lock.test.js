import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import * as upgradeApply from "../src/upgrade/apply.js";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-template-upgrade-lock-"));
  return path.join(root, "upgrade.lock");
}

async function writeOwner(lockPath, owner) {
  const ownerPath = path.join(lockPath, "owner");
  await mkdir(ownerPath, { recursive: true });
  await writeFile(path.join(ownerPath, "owner.json"), `${JSON.stringify(owner)}\n`);
}

describe("upgrade mutex v2", () => {
  it("uses a canonical directory owner claim so release cannot remove a replacement", async () => {
    const lockPath = await fixture();
    const identities = new Map([
      [61, "start-owner"],
      [62, "start-replacement"],
      [63, "start-third"],
    ]);
    const resolveIdentity = async (pid) => ({ state: "alive", identity: identities.get(pid) });
    let replacement;
    const owner = await upgradeApply.acquireUpgradeMutex(lockPath, {
      pid: 61,
      processStartIdentity: "start-owner",
      planId: "plan-owner",
      token: "token-owner",
      resolveIdentity,
      hooks: {
        async afterReleaseClaim() {
          replacement = await upgradeApply.acquireUpgradeMutex(lockPath, {
            pid: 62,
            processStartIdentity: "start-replacement",
            planId: "plan-replacement",
            token: "token-replacement",
            resolveIdentity,
          });
        },
      },
    });

    assert.equal((await lstat(lockPath)).isDirectory(), true);
    assert.equal(await owner.release(), true);
    const canonical = JSON.parse(await readFile(path.join(lockPath, "owner", "owner.json"), "utf8"));
    assert.equal(canonical.token, "token-replacement");
    await assert.rejects(
      () => upgradeApply.acquireUpgradeMutex(lockPath, {
        pid: 63,
        processStartIdentity: "start-third",
        planId: "plan-third",
        token: "token-third",
        resolveIdentity,
      }),
      /active.*PID 62/i,
    );
    assert.equal(await replacement.release(), true);
  });

  it("never moves a replacement acquired during an atomic stale-reclaim claim", async () => {
    const lockPath = await fixture();
    await writeOwner(lockPath, {
      version: 2,
      pid: 71,
      processStartIdentity: "start-stale",
      token: "token-stale",
      planId: "plan-stale",
    });
    const identities = new Map([
      [71, "start-reused"],
      [72, "start-reclaimer"],
      [73, "start-replacement"],
      [74, "start-third"],
    ]);
    const resolveIdentity = async (pid) => ({ state: "alive", identity: identities.get(pid) });
    let replacement;

    await assert.rejects(
      () => upgradeApply.acquireUpgradeMutex(lockPath, {
        pid: 72,
        processStartIdentity: "start-reclaimer",
        planId: "plan-reclaimer",
        token: "token-reclaimer",
        resolveIdentity,
        hooks: {
          async afterReclaimClaim() {
            replacement = await upgradeApply.acquireUpgradeMutex(lockPath, {
              pid: 73,
              processStartIdentity: "start-replacement",
              planId: "plan-replacement",
              token: "token-replacement",
              resolveIdentity,
            });
          },
        },
      }),
      /active.*PID 73/i,
    );
    const canonical = JSON.parse(await readFile(path.join(lockPath, "owner", "owner.json"), "utf8"));
    assert.equal(canonical.token, "token-replacement");
    await assert.rejects(
      () => upgradeApply.acquireUpgradeMutex(lockPath, {
        pid: 74,
        processStartIdentity: "start-third",
        planId: "plan-third",
        token: "token-third",
        resolveIdentity,
      }),
      /active.*PID 73/i,
    );
    assert.equal(await replacement.release(), true);
  });

  it("blocks a matching live identity and atomically reclaims a mismatched one", async () => {
    const lockPath = await fixture();
    const resolveIdentity = async (pid) => ({
      state: "alive",
      identity: pid === 41 ? "start-current" : "start-reused",
    });
    const owner = await upgradeApply.acquireUpgradeMutex(lockPath, {
      pid: 41,
      processStartIdentity: "start-current",
      planId: "plan-a",
      token: "token-owner",
      resolveIdentity,
    });

    await assert.rejects(
      () => upgradeApply.acquireUpgradeMutex(lockPath, {
        pid: 42,
        processStartIdentity: "start-new",
        planId: "plan-b",
        token: "token-blocked",
        resolveIdentity,
      }),
      /active.*PID 41/i,
    );
    assert.equal(await owner.release(), true);

    await writeOwner(lockPath, {
      version: 2,
      pid: 42,
      processStartIdentity: "start-old",
      token: "token-stale",
      planId: "plan-old",
    });
    const replacement = await upgradeApply.acquireUpgradeMutex(lockPath, {
      pid: 43,
      processStartIdentity: "start-replacement",
      planId: "plan-new",
      token: "token-replacement",
      resolveIdentity,
    });
    const persisted = JSON.parse(await readFile(path.join(lockPath, "owner", "owner.json"), "utf8"));
    assert.equal(persisted.token, "token-replacement");
    assert.equal(await replacement.release(), true);
  });

  it("never releases a replacement owner and fails closed on unresolved live identity", async () => {
    const lockPath = await fixture();
    const owner = await upgradeApply.acquireUpgradeMutex(lockPath, {
      pid: 51,
      processStartIdentity: "start-owner",
      planId: "plan-owner",
      token: "token-owner",
      resolveIdentity: async () => ({ state: "alive", identity: "start-owner" }),
    });
    const replacement = {
      version: 2,
      pid: 52,
      processStartIdentity: "start-replacement",
      token: "token-replacement",
      planId: "plan-replacement",
    };
    await writeFile(path.join(lockPath, "owner", "owner.json"), `${JSON.stringify(replacement)}\n`);
    assert.equal(await owner.release(), false);
    assert.deepEqual(JSON.parse(await readFile(path.join(lockPath, "owner", "owner.json"), "utf8")), replacement);
    await assert.rejects(
      () => upgradeApply.acquireUpgradeMutex(lockPath, {
        pid: 53,
        processStartIdentity: "start-waiter",
        planId: "plan-waiter",
        token: "token-waiter",
        resolveIdentity: async (pid) => pid === 53
          ? { state: "alive", identity: "start-waiter" }
          : { state: "unknown", reason: "access denied" },
      }),
      /identity is unresolved/i,
    );
    assert.deepEqual(JSON.parse(await readFile(path.join(lockPath, "owner", "owner.json"), "utf8")), replacement);
  });
});
