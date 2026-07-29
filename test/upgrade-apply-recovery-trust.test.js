import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createFileBackup } from "../src/checkpoints/index.js";
import { createProject, readJournal } from "../src/index.js";
import { ensureDirectory, hashBuffer, hashDirectory, writeJson } from "../src/fs-utils.js";
import { appendJournal } from "../src/plans/journal.js";
import { refreshPlanId } from "../src/plans/schema.js";
import { applyWithVerifier, buildSupportedUpgradePlan } from "./upgrade-internal-harness.js";

const MARKERS = [
  ".agents/skills/.managed-by-workspace-template.json",
  ".opencode/skills/.managed-by-workspace-template.json",
];

async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "workspace-template-upgrade-recovery-trust-"));
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
async function modernizeProjectionMetadata(root) {
  const lockPath = path.join(root, ".agentic", "skills.lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  lock.source.version = "0.0.0-test";
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
  await applyWithVerifier(plan, async () => ({ ok: true }));
}
async function convergedRepairPlan() {
  const root = await fixture();
  await modernizeProjectionMetadata(root);
  const staleHash = "0".repeat(64);
  const lockPath = path.join(root, ".agentic", "skills.lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  lock.skills.verify.baselineHash = staleHash;
  lock.skills.verify.installedHash = staleHash;
  for (const hashes of Object.values(lock.skills.verify.files)) {
    hashes.baselineHash = staleHash;
    hashes.installedHash = staleHash;
  }
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  for (const relative of MARKERS) {
    const markerPath = path.join(root, ...relative.split("/"));
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    marker.skillHashes.verify = staleHash;
    await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
  }
  const manifestPath = path.join(root, ".agentic", "managed-projections.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.skillHashes.verify = staleHash;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
  assert.equal(plan.canApply, true, plan.conflicts.join("\n"));
  return { root, plan };
}
function orderedOperations(plan) {
  const priority = (item) => item.path === ".agentic/managed-files.json" ? 40
    : [".agentic/config.json", ".agentic/profile.json"].includes(item.path) ? 30
      : [".agentic/skills.lock.json", ".agentic/managed-projections.json"].includes(item.path) ? 20
        : 10;
  return plan.operations
    .filter((item) => item.kind !== "noop" && (item.content || item.kind === "delete-upgrade-managed"))
    .sort((left, right) => priority(left) - priority(right) || left.path.localeCompare(right.path));
}
async function rewriteJournal(root, planId, mutate) {
  const journal = path.join(root, ".agentic", "transactions", planId, "journal.jsonl");
  const events = (await readFile(journal, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
  mutate(events);
  await writeFile(journal, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}
async function seedTransaction(root, plan) {
  const operations = orderedOperations(plan);
  const paths = [...new Set(operations.map((item) => item.path))];
  const transaction = path.join(root, ".agentic", "transactions", plan.planId);
  await ensureDirectory(transaction);
  await writeJson(path.join(transaction, "plan.json"), plan);
  const backup = await createFileBackup(root, paths, { baseDirectory: transaction });
  backup.digest = await hashDirectory(backup.directory);
  await appendJournal(root, plan.planId, {
    event: "backup",
    status: "ready",
    directory: backup.directory,
    digest: backup.digest,
  });
  await appendJournal(root, plan.planId, {
    event: "start",
    status: "running",
    operationCount: operations.length,
  });
  return { backup, operations, transaction };
}

async function appendIntent(root, planId, operation) {
  const binding = {
    kind: operation.kind,
    path: operation.path,
    currentHash: operation.currentHash ?? null,
    proposedHash: operation.proposedHash ?? null,
  };
  await appendJournal(root, planId, { event: "operation-intent", status: "pending", ...binding });
}

async function appendApplied(root, planId, operation) {
  await appendJournal(root, planId, {
    event: "operation",
    status: "applied",
    kind: operation.kind,
    path: operation.path,
    currentHash: operation.currentHash ?? null,
    proposedHash: operation.proposedHash ?? null,
  });
}

async function writeProposal(root, operation) {
  assert.ok(operation.content);
  await writeFile(
    path.join(root, ...operation.path.split("/")),
    Buffer.from(operation.content, operation.contentEncoding ?? "base64"),
  );
}

async function raceLock(root) {
  const target = path.join(root, ".agentic", "skills.lock.json");
  const content = Buffer.from(`${await readFile(target, "utf8")}\n`);
  await writeFile(target, content);
  return { content, target };
}

async function expectRecoveryThenRace(root, plan) {
  const raced = await raceLock(root);
  await assert.rejects(
    applyWithVerifier(plan, async () => ({ ok: true })),
    /Plan preconditions no longer hold/i,
  );
  assert.deepEqual(await readFile(raced.target), raced.content);
  return (await readJournal(root, plan.planId))
    .find((event) => event.event === "recovered" && event.status === "restored");
}

describe("upgrade interrupted recovery trust", () => {
  it("restores intent-only proposal state and treats intent-only prestate as already restored", async () => {
    for (const state of ["proposal", "prestate"]) {
      const { root, plan } = await convergedRepairPlan();
      const seeded = await seedTransaction(root, plan);
      const operation = seeded.operations.find((item) => item.path === MARKERS[0]);
      const original = await readFile(path.join(root, ...operation.path.split("/")));
      await appendIntent(root, plan.planId, operation);
      if (state === "proposal") await writeProposal(root, operation);

      const recovered = await expectRecoveryThenRace(root, plan);
      assert.deepEqual(await readFile(path.join(root, ...operation.path.split("/"))), original);
      assert.deepEqual(recovered.paths, state === "proposal" ? [operation.path] : []);
    }
  });

  it("is idempotent after fully or partially restored operations without a restore event", async () => {
    for (const state of ["fully-restored", "partially-restored"]) {
      const { root, plan } = await convergedRepairPlan();
      const seeded = await seedTransaction(root, plan);
      const operations = MARKERS.map((relative) => seeded.operations.find((item) => item.path === relative));
      const originals = new Map();
      for (const operation of operations) {
        const target = path.join(root, ...operation.path.split("/"));
        originals.set(operation.path, await readFile(target));
        await appendIntent(root, plan.planId, operation);
        await writeProposal(root, operation);
        await appendApplied(root, plan.planId, operation);
      }
      await writeFile(
        path.join(root, ...operations[0].path.split("/")),
        originals.get(operations[0].path),
      );
      if (state === "fully-restored") {
        await writeFile(
          path.join(root, ...operations[1].path.split("/")),
          originals.get(operations[1].path),
        );
      }

      const recovered = await expectRecoveryThenRace(root, plan);
      for (const operation of operations) {
        assert.deepEqual(
          await readFile(path.join(root, ...operation.path.split("/"))),
          originals.get(operation.path),
        );
      }
      assert.deepEqual(
        recovered.paths,
        state === "fully-restored" ? [] : [operations[1].path],
      );
    }
  });

  it("latches manual recovery when a journaled intent target matches neither sealed state", async () => {
    const { root, plan } = await convergedRepairPlan();
    const seeded = await seedTransaction(root, plan);
    const operation = seeded.operations.find((item) => item.path === MARKERS[0]);
    await appendIntent(root, plan.planId, operation);
    await writeProposal(root, operation);
    await appendApplied(root, plan.planId, operation);
    const target = path.join(root, ...operation.path.split("/"));
    const external = Buffer.from("{\"external-after-crash\":true}\n");
    await writeFile(target, external);
    await assert.rejects(
      applyWithVerifier(plan, async () => ({ ok: true })),
      /manual recovery required/i,
    );
    assert.deepEqual(await readFile(target), external);
    await assert.rejects(
      applyWithVerifier(plan, async () => ({ ok: true })),
      /manual recovery required.*automatic recovery refused/i,
    );
  });

  it("collects every ownership-lost path while restoring all remaining safe proposal paths", async () => {
    const { root, plan } = await convergedRepairPlan();
    const seeded = await seedTransaction(root, plan);
    const operations = seeded.operations.slice(0, 3);
    const originals = new Map();
    for (const operation of operations) {
      const target = path.join(root, ...operation.path.split("/"));
      originals.set(operation.path, await readFile(target));
      await appendIntent(root, plan.planId, operation);
      await writeProposal(root, operation);
      await appendApplied(root, plan.planId, operation);
    }
    const lost = operations.slice(0, 2);
    for (const [index, operation] of lost.entries()) {
      await writeFile(
        path.join(root, ...operation.path.split("/")),
        Buffer.from(`{"external":${index}}\n`),
      );
    }

    await assert.rejects(
      applyWithVerifier(plan, async () => ({ ok: true })),
      /manual recovery required/i,
    );
    const manual = (await readJournal(root, plan.planId))
      .find((event) => event.event === "manual-recovery-required");
    assert.deepEqual(manual.paths, lost.map((item) => item.path));
    const safe = operations[2];
    assert.deepEqual(
      await readFile(path.join(root, ...safe.path.split("/"))),
      originals.get(safe.path),
    );
  });

  it("preserves an external edit raced between recovery classification and restore", async () => {
    const { root, plan } = await convergedRepairPlan();
    const seeded = await seedTransaction(root, plan);
    const operation = seeded.operations.find((item) => item.path === MARKERS[0]);
    await appendIntent(root, plan.planId, operation);
    await writeProposal(root, operation);
    await appendApplied(root, plan.planId, operation);
    const target = path.join(root, ...operation.path.split("/"));
    const external = Buffer.from("{\"external-during-recovery\":true}\n");
    let injected = false;

    await assert.rejects(
      applyWithVerifier(plan, async () => ({ ok: true }), {}, {
        hooks: {
          async afterRecoveryClassification({ operation: classified }) {
            if (!injected && classified.path === operation.path) {
              injected = true;
              await writeFile(target, external);
            }
          },
        },
      }),
      /manual recovery required/i,
    );
    assert.equal(injected, true);
    assert.deepEqual(await readFile(target), external);
  });

  it("restores update and delete operations without a remove/write gap", async () => {
    for (const mode of ["update", "delete"]) {
      const fixtureState = await convergedRepairPlan();
      const baseOperation = fixtureState.plan.operations.find((item) => item.path === MARKERS[0]);
      const plan = mode === "delete"
        ? refreshPlanId({
          ...fixtureState.plan,
          operations: fixtureState.plan.operations.map((item) => {
            if (item.path !== baseOperation.path) return item;
            const deleted = { ...item, kind: "delete-upgrade-managed", proposedHash: null };
            delete deleted.content;
            delete deleted.contentEncoding;
            return deleted;
          }),
        })
        : fixtureState.plan;
      const seeded = await seedTransaction(fixtureState.root, plan);
      const operation = seeded.operations.find((item) => item.path === MARKERS[0]);
      const target = path.join(fixtureState.root, ...operation.path.split("/"));
      const original = await readFile(target);
      await appendIntent(fixtureState.root, plan.planId, operation);
      if (mode === "delete") await rm(target);
      else await writeProposal(fixtureState.root, operation);
      await appendApplied(fixtureState.root, plan.planId, operation);
      let classifiedPresence;

      await assert.rejects(
        applyWithVerifier(plan, async () => ({ ok: true }), {}, {
          hooks: {
            async afterRecoveryClassification({ operation: classified, state }) {
              if (classified.path !== operation.path) return;
              classifiedPresence = state.state;
              await raceLock(fixtureState.root);
            },
          },
        }),
        /Plan preconditions no longer hold/i,
      );
      assert.equal(classifiedPresence, mode === "delete" ? "absent" : "file");
      assert.deepEqual(await readFile(target), original);
    }
  });

  it("treats an absent update target as ambiguous instead of overwriting it", async () => {
    const { root, plan } = await convergedRepairPlan();
    const seeded = await seedTransaction(root, plan);
    const operation = seeded.operations.find((item) => item.path === MARKERS[0]);
    const target = path.join(root, ...operation.path.split("/"));
    await appendIntent(root, plan.planId, operation);
    await writeProposal(root, operation);
    await appendApplied(root, plan.planId, operation);
    await rm(target);

    await assert.rejects(
      applyWithVerifier(plan, async () => ({ ok: true })),
      /manual recovery required/i,
    );
    await assert.rejects(lstat(target), { code: "ENOENT" });
  });

  it("removes empty original-absent ancestors when retry finds the created target already restored", async () => {
    const fixtureState = await convergedRepairPlan();
    const relative = "retry-created/nested/file.json";
    const content = Buffer.from("{\"created\":true}\n");
    const operation = {
      kind: "create-upgrade-managed",
      path: relative,
      contentEncoding: "base64",
      content: content.toString("base64"),
      currentHash: null,
      proposedHash: hashBuffer(content),
    };
    const plan = refreshPlanId({ ...fixtureState.plan, operations: [operation] });
    await seedTransaction(fixtureState.root, plan);
    await appendIntent(fixtureState.root, plan.planId, operation);
    await appendApplied(fixtureState.root, plan.planId, operation);
    const target = path.join(fixtureState.root, ...relative.split("/"));
    const createdAncestor = path.dirname(target);
    await ensureDirectory(createdAncestor);

    await assert.rejects(
      applyWithVerifier(plan, async () => ({ ok: true }), {}, {
        hooks: {
          async afterRecoveryClassification() {
            await raceLock(fixtureState.root);
          },
        },
      }),
      /Plan preconditions no longer hold/i,
    );
    await assert.rejects(lstat(target), { code: "ENOENT" });
    await assert.rejects(lstat(path.join(fixtureState.root, "retry-created")), { code: "ENOENT" });
  });

  it("rejects mismatched stored plans and invalid journal sequence or operation binding", async () => {
    for (const corruption of ["stored-plan", "sequence", "binding"]) {
      const { root, plan } = await convergedRepairPlan();
      const seeded = await seedTransaction(root, plan);
      const operation = seeded.operations.find((item) => item.path === MARKERS[0]);
      await appendIntent(root, plan.planId, operation);
      if (corruption === "stored-plan") {
        await writeJson(
          path.join(seeded.transaction, "plan.json"),
          refreshPlanId({ ...plan, warnings: [...plan.warnings, "different sealed plan"] }),
        );
      } else {
        await rewriteJournal(root, plan.planId, (events) => {
          const intent = events.find((event) => event.event === "operation-intent");
          if (corruption === "sequence") intent.sequence += 10;
          else intent.proposedHash = "f".repeat(64);
        });
      }
      await assert.rejects(
        applyWithVerifier(plan, async () => ({ ok: true })),
        corruption === "sequence" ? /journal/i : /manual recovery required/i,
      );
    }
  });

  it("rejects backup junctions, invalid records, and content hashes even with a matching digest", async (context) => {
    for (const corruption of ["junction", "record", "hash"]) {
      const { root, plan } = await convergedRepairPlan();
      const seeded = await seedTransaction(root, plan);
      const operation = seeded.operations.find((item) => item.path === MARKERS[0]);
      const target = path.join(root, ...operation.path.split("/"));
      const original = await readFile(target);
      await appendIntent(root, plan.planId, operation);
      let backupDirectory = seeded.backup.directory;
      if (corruption === "junction") {
        const linked = `${backupDirectory}-linked`;
        try {
          await symlink(backupDirectory, linked, process.platform === "win32" ? "junction" : "dir");
        } catch (error) {
          if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
            context.skip(`directory links unavailable: ${error.code}`);
            return;
          }
          throw error;
        }
        backupDirectory = linked;
      } else {
        const manifestPath = path.join(backupDirectory, "manifest.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        if (corruption === "record") {
          manifest.files[operation.path] = { state: "directory" };
          await writeJson(manifestPath, manifest);
        } else {
          await writeFile(
            path.join(backupDirectory, "files", ...operation.path.split("/")),
            "tampered backup bytes\n",
          );
        }
      }
      const digest = await hashDirectory(backupDirectory);
      await rewriteJournal(root, plan.planId, (events) => {
        const backup = events.find((event) => event.event === "backup");
        backup.directory = backupDirectory;
        backup.digest = digest;
      });
      await assert.rejects(
        applyWithVerifier(plan, async () => ({ ok: true })),
        /manual recovery required/i,
      );
      assert.deepEqual(await readFile(target), original);
      const marker = path.join(root, ".agentic", `manual-recovery-required-${plan.planId}.json`);
      assert.match(await readFile(marker, "utf8"), /manual recovery required/i);
      await assert.rejects(
        applyWithVerifier(plan, async () => ({ ok: true })),
        /manual recovery required.*automatic recovery refused/i,
      );
    }
  });

  it("latches manual recovery if exact backup validation fails after a product mutation", async () => {
    const { root, plan } = await convergedRepairPlan();
    let changedPath;
    await assert.rejects(
      applyWithVerifier(plan, async () => ({ ok: true }), {}, {
        hooks: {
          async afterOperationApplied({ backup, operation }) {
            changedPath = path.join(root, ...operation.path.split("/"));
            await writeFile(
              path.join(backup.directory, "manifest.json"),
              "{\"corrupt\":true}\n",
            );
            throw new Error("force rollback after backup corruption");
          },
        },
      }),
      /manual recovery required/i,
    );
    assert.ok(changedPath);
    assert.equal(
      (await readJournal(root, plan.planId)).some((event) => (
        event.event === "manual-recovery-required"
      )),
      true,
    );
  });
});
