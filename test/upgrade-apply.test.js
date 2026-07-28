import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { applyUpgradePlan, createProject, readJournal, refreshPlanId } from "../src/index.js";
import { exists } from "../src/fs-utils.js";
import { runCommandAsync } from "../src/process-utils.js";
import { applyWithVerifier, buildSupportedUpgradePlan } from "./upgrade-internal-harness.js";

async function fixture(options = {}) {
  const parent = await mkdtemp(path.join(os.tmpdir(), "workspace-template-upgrade-apply-"));
  const root = path.join(parent, "repo");
  await createProject({
    target: root, project: "javascript", style: "functional-core", tdd: "pragmatic",
    packageManager: "npm", agents: options.agents ?? [], preset: "sol-codex",
    install: false, git: false, bootstrap: false, force: false, dryRun: false, yes: true,
  });
  const packagePath = path.join(root, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) delete packageJson[section];
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  return root;
}

describe("upgrade apply transaction", () => {
  it("rejects a stale reviewed plan before writing", async () => {
    const root = await fixture();
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    const configPath = path.join(root, ".agentic", "config.json");
    const changed = `${await readFile(configPath, "utf8")}\n`;
    await writeFile(configPath, changed);
    await assert.rejects(() => applyUpgradePlan(plan), /preconditions no longer hold/i);
    assert.equal(await readFile(configPath, "utf8"), changed);
  });

  it("rolls back every write when post-upgrade doctor fails", async () => {
    const root = await fixture();
    const original = await readFile(path.join(root, ".agentic", "config.json"), "utf8");
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    const operations = plan.operations.map((item) => item.path === ".agentic/config.json"
      ? {
          ...item,
          kind: "update-upgrade-managed",
          contentEncoding: "base64",
          content: Buffer.from('{"version":3,"generator":"broken"}\n').toString("base64"),
        }
      : item);
    const broken = refreshPlanId({ ...plan, operations });
    await assert.rejects(() => applyWithVerifier(broken, async () => ({ ok: true })), /doctor failed/i);
    assert.equal(await readFile(path.join(root, ".agentic", "config.json"), "utf8"), original);
  });

  it("repairs a missing owned artifact after staged validation", async () => {
    const root = await fixture();
    const schemaPath = path.join(root, ".agentic", "profile.schema.json");
    await rm(schemaPath);
    const managedPath = path.join(root, ".agentic", "managed-files.json");
    const managed = JSON.parse(await readFile(managedPath, "utf8"));
    delete managed.files[".agentic/profile.schema.json"];
    await writeFile(managedPath, `${JSON.stringify(managed, null, 2)}\n`);
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(plan.operations.find((item) => item.path === ".agentic/profile.schema.json")?.kind, "create-upgrade-managed");
    const report = await applyWithVerifier(plan, async () => ({ ok: true }));
    assert.equal(report.ok, true);
    assert.match(await readFile(schemaPath, "utf8"), /workspace-template:profile/);
    const applied = (await readJournal(root, plan.planId)).filter((event) => event.event === "operation").map((event) => event.path);
    assert.equal(applied.at(-1), ".agentic/managed-files.json");
  });

  it("writes every ownership and identity record after all payloads", async () => {
    const root = await fixture({ agents: ["codex"] });
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    const ownershipPaths = [
      ".agentic/skills.lock.json",
      ".agentic/managed-projections.json",
      ".agentic/config.json",
      ".agentic/profile.json",
      ".agentic/managed-files.json",
    ];
    const payload = plan.operations.find((item) => !ownershipPaths.includes(item.path)
      && item.path.startsWith(".agentic/skills/")
      && item.path.endsWith("/SKILL.md"));
    assert.ok(payload, "fixture must expose a managed skill payload operation");
    const applicableOwnershipPaths = ownershipPaths.filter((relative) =>
      plan.operations.some((item) => item.path === relative));
    for (const relative of ownershipPaths.filter((relative) => relative !== ".agentic/managed-projections.json")) {
      assert.ok(applicableOwnershipPaths.includes(relative), `missing ${relative}`);
    }
    const selected = new Set([payload.path, ...applicableOwnershipPaths]);
    const operations = await Promise.all(plan.operations.map(async (item) => selected.has(item.path)
      ? {
          ...item,
          kind: "update-upgrade-managed",
          contentEncoding: "base64",
          content: (await readFile(path.join(root, ...item.path.split("/")))).toString("base64"),
        }
      : item));
    const ordered = refreshPlanId({
      ...plan,
      operations,
    });

    await applyWithVerifier(ordered, async () => ({ ok: true }));

    const applied = (await readJournal(root, ordered.planId))
      .filter((event) => event.event === "operation")
      .map((event) => event.path);
    const payloadIndex = applied.indexOf(payload.path);
    assert.notEqual(payloadIndex, -1);
    for (const relative of applicableOwnershipPaths) {
      assert.equal(applied.indexOf(relative) > payloadIndex, true, `${relative} must follow payload ${payload.path}`);
    }
  });

  it("rechecks process leases at apply time and reports interrupted recovery in dry-run", async () => {
    const root = await fixture();
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    const leaseDirectory = path.join(root, ".agent", "leases");
    await mkdir(leaseDirectory, { recursive: true });
    await writeFile(path.join(leaseDirectory, "open.json"), "{}\n");
    await assert.rejects(() => applyWithVerifier(plan, async () => ({ ok: true })), /lease blocks upgrade/i);
    await rm(path.join(leaseDirectory, "open.json"));

    const interrupted = path.join(root, ".agentic", "transactions", "interrupted", "journal.jsonl");
    await mkdir(path.dirname(interrupted), { recursive: true });
    await writeFile(interrupted, `${JSON.stringify({ sequence: 1, event: "start", status: "running" })}\n`);
    const preview = await buildSupportedUpgradePlan(root, { dryRun: true });
    assert.equal(preview.metadata.upgrade.status, "recovery-required");
    assert.equal(preview.canApply, false);
  });

  it("runs full verification only in disposable copies isolated from repository-local state", async () => {
    const root = await fixture();
    const sourceSentinels = [
      path.join(root, ".git", "source-sentinel"),
      path.join(root, "node_modules", "source-sentinel"),
      path.join(root, ".agentic", "reports", "source-sentinel"),
      path.join(root, ".agentic", "transactions", "source-sentinel"),
    ];
    for (const sentinel of sourceSentinels) {
      await mkdir(path.dirname(sentinel), { recursive: true });
      await writeFile(sentinel, "source-state\n");
    }
    const external = await mkdtemp(path.join(os.tmpdir(), "workspace-template-verifier-external-"));
    const externalSentinel = path.join(external, "sentinel");
    await writeFile(externalSentinel, "external-state\n");
    await symlink(external, path.join(root, "external-link"), process.platform === "win32" ? "junction" : "dir");
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    const verificationRoots = [];

    const report = await applyWithVerifier(plan, async (verificationRoot) => {
      verificationRoots.push(verificationRoot);
      assert.notEqual(path.resolve(verificationRoot), path.resolve(root));
      for (const relative of [
        ".git/verifier-output",
        "node_modules/verifier-output",
        ".agentic/reports/verifier-output",
        ".agentic/transactions/verifier-output",
      ]) {
        const target = path.join(verificationRoot, ...relative.split("/"));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, "checkpoint-only\n");
      }
      await rm(verificationRoot, { recursive: true, force: true });
      return { ok: true };
    });

    assert.equal(report.ok, true);
    assert.equal(verificationRoots.length, 2);
    for (const sentinel of sourceSentinels) {
      assert.equal(await readFile(sentinel, "utf8"), "source-state\n");
    }
    assert.equal(await readFile(externalSentinel, "utf8"), "external-state\n");
    assert.equal(await exists(path.join(root, "external-link")), true);
  });

  it("refuses default verification that requests remote or publish authority", async () => {
    const root = await fixture();
    const packagePath = path.join(root, "package.json");
    const manifest = JSON.parse(await readFile(packagePath, "utf8"));
    manifest.scripts.check = "npm publish";
    await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);

    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });

    assert.equal(plan.canApply, false);
    assert.equal(plan.conflicts.some((conflict) => /unauthorized.*publish.*deploy effect/iu.test(conflict)), true);
  });

  it("never persists verifier credential output and keeps structured byte-bounded evidence", async () => {
    const root = await fixture();
    const packagePath = path.join(root, "package.json");
    const manifest = JSON.parse(await readFile(packagePath, "utf8"));
    const canary = "persisted-verifier-canary";
    manifest.scripts.check = `node -e "process.stdout.write('token=${canary}')"`;
    await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });

    const report = await applyUpgradePlan(plan, { maxOutputBytes: 64 });
    const persisted = await readFile(
      path.join(root, ".agentic", "reports", "upgrade", `${plan.planId}.json`),
      "utf8",
    );

    assert.equal(report.ok, true);
    assert.doesNotMatch(persisted, new RegExp(canary, "u"));
    assert.match(persisted, /\[REDACTED\]/u);
    for (const phase of [report.preVerification, report.postVerification]) {
      for (const module of phase.results) {
        for (const result of module.results) {
          assert.equal(Buffer.byteLength(result.stdout, "utf8") <= 64, true);
          assert.equal(Buffer.byteLength(result.stderr, "utf8") <= 64, true);
          assert.equal(result.lease.final.zeroDescendants, true);
        }
      }
    }
  });

  it("closes a Windows daemon after its intermediate parent exits", {
    skip: process.platform !== "win32",
  }, async () => {
    const daemon = "setInterval(() => {}, 1000)";
    const helper = `
      const { spawn } = require("node:child_process");
      const child = spawn(process.execPath, ["-e", ${JSON.stringify(daemon)}], { detached: true, stdio: "ignore" });
      process.stdout.write(String(child.pid));
      child.unref();
    `;
    const rootCommand = `
      const { spawn } = require("node:child_process");
      const child = spawn(process.execPath, ["-e", ${JSON.stringify(helper)}], { stdio: "inherit" });
      child.on("close", (status) => { process.exitCode = status ?? 1; });
    `;
    const result = await runCommandAsync(process.execPath, ["-e", rootCommand], {
      ownDescendants: true,
      timeout: 20_000,
    });
    assert.equal(result.status, 0, result.stderr);
    const daemonPid = Number(result.stdout.trim());
    assert.equal(Number.isInteger(daemonPid), true);
    assert.throws(() => process.kill(daemonPid, 0));
  });
});
