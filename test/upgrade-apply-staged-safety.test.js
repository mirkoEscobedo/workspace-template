import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createProject, doctorProject, readJournal } from "../src/index.js";
import { hashBuffer, hashDirectory } from "../src/fs-utils.js";
import { refreshPlanId } from "../src/plans/schema.js";
import { applyWithVerifier, buildSupportedUpgradePlan } from "./upgrade-internal-harness.js";

async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "workspace-template-upgrade-staged-safety-"));
  const root = path.join(parent, "repo");
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
  const packagePath = path.join(root, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    delete packageJson[section];
  }
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  return root;
}

async function staleSkillHashes(root, name) {
  const staleHash = "0".repeat(64);
  const lockPath = path.join(root, ".agentic", "skills.lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  lock.skills[name].baselineHash = staleHash;
  lock.skills[name].installedHash = staleHash;
  for (const hashes of Object.values(lock.skills[name].files)) {
    hashes.baselineHash = staleHash;
    hashes.installedHash = staleHash;
  }
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  for (const destination of [".agents/skills", ".opencode/skills"]) {
    const markerPath = path.join(root, ...destination.split("/"), ".managed-by-workspace-template.json");
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    marker.skillHashes[name] = staleHash;
    await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
  }
  const manifestPath = path.join(root, ".agentic", "managed-projections.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.skillHashes[name] = staleHash;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function modernizeProjectionMetadata(root) {
  const lockPath = path.join(root, ".agentic", "skills.lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  lock.source.version = "0.0.0-test";
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
  assert.equal(plan.canApply, true, plan.conflicts.join("\n"));
  await applyWithVerifier(plan, async () => ({ ok: true }));
}

async function convergedRepairPlan() {
  const root = await fixture();
  await modernizeProjectionMetadata(root);
  await staleSkillHashes(root, "verify");
  const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
  assert.equal(plan.canApply, true, plan.conflicts.join("\n"));
  return { root, plan };
}

describe("upgrade staged transaction safety", () => {
  it("applies a converged stale-hash repair and becomes current", async () => {
    const { root, plan } = await convergedRepairPlan();
    let verifierCalls = 0;
    const report = await applyWithVerifier(plan, async () => {
      verifierCalls += 1;
      return { ok: true };
    });
    assert.equal(report.status, "upgraded");
    assert.equal(verifierCalls, 2);
    assert.equal((await doctorProject(root)).ok, true);

    const lock = JSON.parse(await readFile(path.join(root, ".agentic", "skills.lock.json"), "utf8"));
    const expected = lock.skills.verify.installedHash;
    assert.equal(
      lock.skills.verify.baselineHash,
      await hashDirectory(path.join(root, ".agentic", "skill-baselines", "verify")),
    );
    for (const destination of [".agents/skills", ".opencode/skills"]) {
      const marker = JSON.parse(await readFile(
        path.join(root, ...destination.split("/"), ".managed-by-workspace-template.json"),
        "utf8",
      ));
      assert.equal(marker.skillHashes.verify, expected);
    }
    const manifest = JSON.parse(await readFile(
      path.join(root, ".agentic", "managed-projections.json"),
      "utf8",
    ));
    assert.equal(manifest.skillHashes.verify, expected);
    const second = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(second.canApply, true, second.conflicts.join("\n"));
    assert.equal(second.metadata.upgrade.status, "current");
    assert.equal(second.operations.every((item) => item.kind === "noop"), true);
  });

  it("rejects a tampered stale lock in staged doctor before verifier or product writes", async () => {
    const { root, plan } = await convergedRepairPlan();
    const protectedPaths = [
      ".agentic/skills.lock.json",
      ".agentic/managed-projections.json",
      ".agents/skills/.managed-by-workspace-template.json",
      ".opencode/skills/.managed-by-workspace-template.json",
    ];
    const before = new Map(await Promise.all(protectedPaths.map(async (relative) => [
      relative,
      await readFile(path.join(root, ...relative.split("/"))),
    ])));
    const staleLock = before.get(".agentic/skills.lock.json");
    const tampered = structuredClone(plan);
    const lockOperation = tampered.operations.find((item) => item.path === ".agentic/skills.lock.json");
    lockOperation.content = staleLock.toString("base64");
    lockOperation.proposedHash = hashBuffer(staleLock);
    const resealed = refreshPlanId(tampered);

    let verifierCalls = 0;
    await assert.rejects(
      applyWithVerifier(resealed, async () => {
        verifierCalls += 1;
        return { ok: true };
      }),
      /Staged upgrade doctor failed/i,
    );
    assert.equal(verifierCalls, 0);
    for (const [relative, content] of before) {
      assert.deepEqual(await readFile(path.join(root, ...relative.split("/"))), content);
    }
  });

  it("stages every nonempty doctor-clean plan before invoking its verifier", async () => {
    const root = await fixture();
    await modernizeProjectionMetadata(root);
    const lockPath = path.join(root, ".agentic", "skills.lock.json");
    const currentLock = JSON.parse(await readFile(lockPath, "utf8"));
    currentLock.source.version = "0.0.0-stale-source";
    await writeFile(lockPath, `${JSON.stringify(currentLock, null, 2)}\n`);
    assert.equal((await doctorProject(root)).ok, true);
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    const tampered = structuredClone(plan);
    const lockOperation = tampered.operations.find((item) => item.path === ".agentic/skills.lock.json");
    const plannedLock = JSON.parse(Buffer.from(lockOperation.content, "base64").toString("utf8"));
    plannedLock.skills.verify.baselineHash = "0".repeat(64);
    const content = Buffer.from(`${JSON.stringify(plannedLock, null, 2)}\n`);
    lockOperation.content = content.toString("base64");
    lockOperation.proposedHash = hashBuffer(content);

    let verifierCalls = 0;
    await assert.rejects(
      applyWithVerifier(refreshPlanId(tampered), async () => {
        verifierCalls += 1;
        return { ok: true };
      }),
      /Staged upgrade doctor failed/i,
    );
    assert.equal(verifierCalls, 0);
  });

  it("preserves a concurrent pre-backup edit after final staging", async () => {
    const { root, plan } = await convergedRepairPlan();
    const lockPath = path.join(root, ".agentic", "skills.lock.json");
    const concurrent = Buffer.from(`${await readFile(lockPath, "utf8")}\n`);
    await assert.rejects(
      applyWithVerifier(plan, async () => ({ ok: true }), {}, {
        hooks: {
          async afterFinalStagedValidation() {
            await writeFile(lockPath, concurrent);
          },
        },
      }),
      /Plan preconditions no longer hold/i,
    );
    assert.deepEqual(await readFile(lockPath), concurrent);
    assert.equal((await readJournal(root, plan.planId)).some((event) => event.event === "backup"), false);
  });

  it("validates the exact backup after its digest and before journaling mutation authority", async () => {
    const { root, plan } = await convergedRepairPlan();
    const operation = plan.operations.find((item) => (
      item.kind !== "noop" && item.currentHash && item.content
    ));
    const target = path.join(root, ...operation.path.split("/"));
    const original = await readFile(target);
    await assert.rejects(
      applyWithVerifier(plan, async () => ({ ok: true }), {}, {
        hooks: {
          async afterBackupDigest({ backup }) {
            await writeFile(
              path.join(backup.directory, "files", ...operation.path.split("/")),
              "tampered after backup digest\n",
            );
          },
        },
      }),
      /backup integrity check failed/i,
    );
    assert.deepEqual(await readFile(target), original);
    assert.equal(
      (await readJournal(root, plan.planId)).some((event) => (
        event.event === "backup" || event.event === "start"
      )),
      false,
    );
  });

  it("rolls back updater-owned operations while preserving a raced later target", async () => {
    const { root, plan } = await convergedRepairPlan();
    const lockPath = path.join(root, ".agentic", "skills.lock.json");
    const concurrentLock = Buffer.from(`${await readFile(lockPath, "utf8")}\n`);
    const markerRelative = ".agents/skills/.managed-by-workspace-template.json";
    const markerPath = path.join(root, ...markerRelative.split("/"));
    const originalMarker = await readFile(markerPath);
    await assert.rejects(
      applyWithVerifier(plan, async () => ({ ok: true }), {}, {
        hooks: {
          async afterBackupReady() {
            await writeFile(lockPath, concurrentLock);
          },
        },
      }),
      /upgrade target changed after staged validation/i,
    );
    assert.deepEqual(await readFile(lockPath), concurrentLock);
    assert.deepEqual(await readFile(markerPath), originalMarker);
    const events = await readJournal(root, plan.planId);
    const intentIndex = events.findIndex((event) => (
      event.event === "operation-intent" && event.path === markerRelative
    ));
    const appliedIndex = events.findIndex((event) => (
      event.event === "operation" && event.status === "applied" && event.path === markerRelative
    ));
    assert.equal(intentIndex >= 0 && appliedIndex > intentIndex, true);
    const operation = plan.operations.find((item) => item.path === markerRelative);
    assert.deepEqual(
      {
        kind: events[intentIndex].kind,
        currentHash: events[intentIndex].currentHash,
        proposedHash: events[intentIndex].proposedHash,
      },
      {
        kind: operation.kind,
        currentHash: operation.currentHash,
        proposedHash: operation.proposedHash,
      },
    );
    assert.equal(events.some((event) => event.event === "rollback" && event.status === "restored"), true);
  });

  it("latches manual recovery when an applied path changes before rollback", async () => {
    const { root, plan } = await convergedRepairPlan();
    const external = Buffer.from("{\"external\":true}\n");
    let changedPath;
    await assert.rejects(
      applyWithVerifier(plan, async () => ({ ok: true }), {}, {
        hooks: {
          async afterOperationApplied({ operation }) {
            changedPath = path.join(root, ...operation.path.split("/"));
            await writeFile(changedPath, external);
            throw new Error("injected post-apply external edit");
          },
        },
      }),
      /manual recovery required/i,
    );
    assert.deepEqual(await readFile(changedPath), external);
    assert.equal(
      (await readJournal(root, plan.planId)).some((event) => event.event === "manual-recovery-required"),
      true,
    );
    await assert.rejects(
      applyWithVerifier(plan, async () => ({ ok: true })),
      /manual recovery required.*automatic recovery refused/i,
    );
    assert.deepEqual(await readFile(changedPath), external);
  });

  it("stages proposal bytes inside the trusted transaction before the final target check", async () => {
    const { root, plan } = await convergedRepairPlan();
    const external = Buffer.from("{\"external-after-stage\":true}\n");
    let stagedPath;
    let racedTarget;
    await assert.rejects(
      applyWithVerifier(plan, async () => ({ ok: true }), {}, {
        hooks: {
          async afterOperationStaged({ operation, stagingPath }) {
            if (stagedPath) return;
            stagedPath = stagingPath;
            racedTarget = path.join(root, ...operation.path.split("/"));
            assert.equal(
              path.relative(
                path.join(root, ".agentic", "transactions", plan.planId, "staging"),
                stagingPath,
              ).startsWith(".."),
              false,
            );
            assert.deepEqual(
              await readFile(stagingPath),
              Buffer.from(operation.content, operation.contentEncoding ?? "base64"),
            );
            await writeFile(racedTarget, external);
          },
        },
      }),
      /target changed after staged validation/i,
    );
    assert.ok(stagedPath);
    assert.deepEqual(await readFile(racedTarget), external);
    assert.equal(
      (await readJournal(root, plan.planId)).some((event) => event.event === "manual-recovery-required"),
      false,
    );
  });

  it("rejects staged proposal tampering before the final target check", async () => {
    const { root, plan } = await convergedRepairPlan();
    let target;
    let original;
    await assert.rejects(
      applyWithVerifier(plan, async () => ({ ok: true }), {}, {
        hooks: {
          async afterOperationStaged({ operation, stagingPath }) {
            if (!stagingPath || target) return;
            target = path.join(root, ...operation.path.split("/"));
            original = await readFile(target);
            await writeFile(stagingPath, "{\"tampered-stage\":true}\n");
          },
        },
      }),
      /staging integrity check failed/i,
    );
    assert.ok(target);
    assert.deepEqual(await readFile(target), original);
    assert.equal(
      (await readJournal(root, plan.planId)).some((event) => event.event === "manual-recovery-required"),
      false,
    );
  });

});
