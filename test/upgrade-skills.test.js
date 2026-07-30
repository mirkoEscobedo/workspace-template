import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createProject, readJournal } from "../src/index.js";
import { exists, hashBuffer, hashDirectory } from "../src/fs-utils.js";
import { assetsSkills } from "../src/workspace-artifacts.js";
import { inspectUpgradeWorkspace } from "../src/upgrade/inspect.js";
import { planSkillUpgrade } from "../src/upgrade/skills.js";
import { applyWithVerifier, buildSupportedUpgradePlan } from "./upgrade-internal-harness.js";

async function fixture(options = {}) {
  const parent = await mkdtemp(path.join(os.tmpdir(), "workspace-template-upgrade-skills-"));
  const root = path.join(parent, "repo");
  await createProject({
    target: root, project: "javascript", style: "functional-core", tdd: "pragmatic",
    packageManager: "npm", agents: options.agents ?? ["codex"], preset: "sol-codex",
    install: false, git: false, bootstrap: false, force: false, dryRun: false, yes: true,
  });
  const packagePath = path.join(root, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) delete packageJson[section];
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

async function staleSkillBaselineHashes(root, name) {
  const staleHash = "0".repeat(64);
  const lockPath = path.join(root, ".agentic", "skills.lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  lock.skills[name].baselineHash = staleHash;
  for (const hashes of Object.values(lock.skills[name].files)) hashes.baselineHash = staleHash;
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

async function malformSkillBaselineHashes(root, name) {
  const lockPath = path.join(root, ".agentic", "skills.lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  delete lock.skills[name].baselineHash;
  lock.skills[name].files["SKILL.md"].baselineHash = 42;
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
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

describe("upgrade skill reconciliation", () => {
  it("preserves non-overlapping canonical skill edits through upgrade and projection", async () => {
    const root = await fixture();
    const canonical = path.join(root, ".agentic", "skills", "verify", "SKILL.md");
    await writeFile(canonical, `${await readFile(canonical, "utf8")}\n<!-- repository extension -->\n`);
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(plan.canApply, true, plan.conflicts.join("\n"));
    await applyWithVerifier(plan, async () => ({ ok: true }));
    assert.match(await readFile(canonical, "utf8"), /repository extension/);
    assert.match(await readFile(path.join(root, ".agents", "skills", "verify", "SKILL.md"), "utf8"), /repository extension/);
    const applied = (await readJournal(root, plan.planId))
      .filter((event) => event.event === "operation")
      .map((event) => event.path);
    const payloadIndex = applied.indexOf(".agents/skills/verify/SKILL.md");
    assert.notEqual(payloadIndex, -1);
    assert.equal(applied.indexOf(".agentic/managed-projections.json") > payloadIndex, true);
    assert.equal(applied.indexOf(".agentic/skills.lock.json") > payloadIndex, true);
  });

  it("canonicalizes incoming CRLF skill bytes before writing and hashing them", async () => {
    const root = await fixture();
    const incoming = await mkdtemp(path.join(os.tmpdir(), "workspace-template-incoming-crlf-"));
    await cp(assetsSkills, incoming, { recursive: true });
    const incomingFile = path.join(incoming, "verify", "SKILL.md");
    const incomingText = (await readFile(incomingFile, "utf8"))
      .replaceAll("\r\n", "\n")
      .replaceAll("\n", "\r\n");
    await writeFile(incomingFile, `${incomingText}\r\n<!-- incoming CRLF change -->\r\n`);

    const result = await planSkillUpgrade(await inspectUpgradeWorkspace(root), {
      incomingSkillsRoot: incoming,
    });
    assert.equal(result.conflicts.length, 0, result.conflicts.join("\n"));
    const baselineOperation = result.operations.find(
      (item) => item.path === ".agentic/skill-baselines/verify/SKILL.md",
    );
    assert.ok(baselineOperation?.content);
    const content = Buffer.from(baselineOperation.content, "base64");
    assert.equal(content.toString("utf8").includes("\r\n"), false);
    assert.equal(
      result.lock.skills.verify.files["SKILL.md"].baselineHash,
      hashBuffer(content),
    );
  });

  it("does not plan or lock generated Python cache artifacts from an incoming catalog", async () => {
    const root = await fixture();
    const incoming = await mkdtemp(path.join(os.tmpdir(), "workspace-template-incoming-cache-"));
    await cp(assetsSkills, incoming, { recursive: true });
    const cacheRoot = path.join(incoming, "verify", "scripts", "__pycache__");
    await mkdir(cacheRoot, { recursive: true });
    await mkdir(path.join(incoming, "__pycache__"), { recursive: true });
    await writeFile(path.join(cacheRoot, "probe.cpython-314.pyc"), "bytecode\n");
    await writeFile(path.join(incoming, "verify", "scripts", "probe.pyo"), "optimized bytecode\n");
    await writeFile(path.join(incoming, "__pycache__", "catalog.cpython-314.pyc"), "bytecode\n");

    const result = await planSkillUpgrade(await inspectUpgradeWorkspace(root), {
      incomingSkillsRoot: incoming,
    });
    const plannedPaths = result.operations.map((operation) => operation.path);
    const lockedPaths = Object.keys(result.lock.skills.verify.files);

    assert.equal(plannedPaths.some((relative) => /__pycache__|\.py[co]$/iu.test(relative)), false);
    assert.equal(lockedPaths.some((relative) => /__pycache__|\.py[co]$/iu.test(relative)), false);
    assert.equal(Object.hasOwn(result.lock.skills, "__pycache__"), false);
  });

  it("reports an overlapping three-way merge conflict without writing", async () => {
    const root = await fixture();
    const baseline = path.join(root, ".agentic", "skill-baselines", "verify", "SKILL.md");
    const canonical = path.join(root, ".agentic", "skills", "verify", "SKILL.md");
    const incoming = await readFile(baseline, "utf8");
    const line = incoming.split("\n").find((item) => item.trim() && !item.startsWith("---"));
    await writeFile(baseline, incoming.replace(line, `${line} baseline-old`));
    await writeFile(canonical, incoming.replace(line, `${line} local-change`));
    const before = await readFile(canonical, "utf8");
    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(plan.canApply, false);
    assert.match(plan.conflicts.join("\n"), /skill merge conflict/i);
    assert.equal(await readFile(canonical, "utf8"), before);
  });

  it("heals stale skill hashes when the entire canonical, baseline, and projection catalog converges", async () => {
    const root = await fixture({ agents: ["codex", "opencode"] });
    await modernizeProjectionMetadata(root);
    await staleSkillHashes(root, "ticket-review");

    const plan = await buildSupportedUpgradePlan(root, {
      allowNetwork: true,
      allowRiskyToolChanges: true,
    });
    assert.equal(plan.canApply, true, plan.conflicts.join("\n"));

    const plannedJson = (relative) => JSON.parse(Buffer.from(
      plan.operations.find((item) => item.path === relative).content,
      "base64",
    ).toString("utf8"));
    const lock = plannedJson(".agentic/skills.lock.json");
    const canonicalHash = await hashDirectory(path.join(root, ".agentic", "skills", "ticket-review"));
    const baselineHash = await hashDirectory(path.join(root, ".agentic", "skill-baselines", "ticket-review"));
    assert.equal(lock.skills["ticket-review"].installedHash, canonicalHash);
    assert.equal(lock.skills["ticket-review"].baselineHash, baselineHash);
    for (const destination of [".agents/skills", ".opencode/skills"]) {
      const marker = plannedJson(`${destination}/.managed-by-workspace-template.json`);
      assert.equal(marker.skillHashes["ticket-review"], canonicalHash);
    }
    const manifest = plannedJson(".agentic/managed-projections.json");
    assert.equal(manifest.skillHashes["ticket-review"], canonicalHash);
  });

  it("heals stale converged non-risky skill hashes without risky-tool approval", async () => {
    const root = await fixture({ agents: ["codex", "opencode"] });
    await modernizeProjectionMetadata(root);
    await staleSkillHashes(root, "verify");

    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(plan.canApply, true, plan.conflicts.join("\n"));
    const lockOperation = plan.operations.find((item) => item.path === ".agentic/skills.lock.json");
    const lock = JSON.parse(Buffer.from(lockOperation.content, "base64").toString("utf8"));
    assert.equal(
      lock.skills.verify.installedHash,
      await hashDirectory(path.join(root, ".agentic", "skills", "verify")),
    );
  });

  it("does not heal stale skill hashes when canonical bytes differ from the incoming catalog", async () => {
    const root = await fixture({ agents: ["codex", "opencode"] });
    await modernizeProjectionMetadata(root);
    await staleSkillHashes(root, "ticket-review");
    const canonical = path.join(root, ".agentic", "skills", "ticket-review", "SKILL.md");
    await writeFile(canonical, `${await readFile(canonical, "utf8")}\n<!-- canonical drift -->\n`);

    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(plan.canApply, false);
    assert.match(plan.conflicts.join("\n"), /projection drift.*ticket-review/i);
  });

  it("does not heal stale skill hashes when one managed projection differs", async () => {
    const root = await fixture({ agents: ["codex", "opencode"] });
    await modernizeProjectionMetadata(root);
    await staleSkillHashes(root, "ticket-review");
    const projected = path.join(root, ".agents", "skills", "ticket-review", "SKILL.md");
    await writeFile(projected, `${await readFile(projected, "utf8")}\n<!-- one-target drift -->\n`);

    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(plan.canApply, false);
    assert.match(plan.conflicts.join("\n"), /projection drift.*ticket-review/i);
  });

  it("does not heal stale skill hashes when a projection root has an extra file", async () => {
    const root = await fixture({ agents: ["codex", "opencode"] });
    await modernizeProjectionMetadata(root);
    await staleSkillHashes(root, "ticket-review");
    await writeFile(path.join(root, ".agents", "skills", "unmanaged.txt"), "unmanaged\n");

    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(plan.canApply, false);
    assert.match(plan.conflicts.join("\n"), /projection drift/i);
  });

  it("does not heal stale skill hashes through a projection-tree symlink", async (context) => {
    const root = await fixture({ agents: ["codex", "opencode"] });
    await modernizeProjectionMetadata(root);
    await staleSkillHashes(root, "ticket-review");
    const projected = path.join(root, ".agents", "skills", "ticket-review");
    try {
      await symlink(
        path.join(projected, "agents"),
        path.join(projected, "linked-agents"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
        context.skip(`symlinks unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    const plan = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(plan.canApply, false);
    assert.match(plan.conflicts.join("\n"), /projection drift/i);
  });

  it("requires risky-tool approval for every stale converged risky skill", async () => {
    const root = await fixture({ agents: ["codex", "opencode"] });
    await modernizeProjectionMetadata(root);
    await staleSkillHashes(root, "process-lifecycle");

    const blocked = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(blocked.canApply, false);
    assert.match(blocked.conflicts.join("\n"), /process-lifecycle.*risky.*allow-risky-tool-changes/i);

    const reviewed = await buildSupportedUpgradePlan(root, {
      allowNetwork: true,
      allowRiskyToolChanges: true,
    });
    assert.equal(reviewed.canApply, true, reviewed.conflicts.join("\n"));
  });

  it("keeps stale risky lock healing gated when host projections are preserved", async () => {
    const root = await fixture({ agents: ["codex", "opencode"] });
    await modernizeProjectionMetadata(root);
    await staleSkillHashes(root, "process-lifecycle");
    const configPath = path.join(root, ".agentic", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.hostBundles = "preserve";
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const blocked = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(blocked.canApply, false);
    assert.match(blocked.conflicts.join("\n"), /process-lifecycle.*risky.*allow-risky-tool-changes/i);

    const reviewed = await buildSupportedUpgradePlan(root, {
      allowNetwork: true,
      allowRiskyToolChanges: true,
    });
    assert.equal(reviewed.canApply, true, reviewed.conflicts.join("\n"));
    assert.equal(
      reviewed.operations.some((item) => (
        item.path.startsWith(".agents/")
        || item.path.startsWith(".codex/")
        || item.path.startsWith(".opencode/")
      )),
      false,
    );
  });

  it("gates each stale risky skill independently when another preserved skill has local edits", async () => {
    const root = await fixture({ agents: ["codex", "opencode"] });
    await modernizeProjectionMetadata(root);
    const editedSkill = path.join(root, ".agentic", "skills", "verify", "SKILL.md");
    await writeFile(editedSkill, `${await readFile(editedSkill, "utf8")}\n<!-- preserved local edit -->\n`);
    await staleSkillHashes(root, "process-lifecycle");
    const configPath = path.join(root, ".agentic", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.hostBundles = "preserve";
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const blocked = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(blocked.canApply, false);
    assert.match(blocked.conflicts.join("\n"), /process-lifecycle.*risky.*allow-risky-tool-changes/i);

    const reviewed = await buildSupportedUpgradePlan(root, {
      allowNetwork: true,
      allowRiskyToolChanges: true,
    });
    assert.equal(reviewed.canApply, true, reviewed.conflicts.join("\n"));
    const lockOperation = reviewed.operations.find((item) => item.path === ".agentic/skills.lock.json");
    const lock = JSON.parse(Buffer.from(lockOperation.content, "base64").toString("utf8"));
    assert.equal(lock.skills.verify.installedHash, await hashDirectory(path.dirname(editedSkill)));
    assert.equal(
      reviewed.operations.some((item) => (
        item.path.startsWith(".agents/")
        || item.path.startsWith(".codex/")
        || item.path.startsWith(".opencode/")
      )),
      false,
    );
  });

  it("gates stale risky baselines while preserving a local edit in that same skill", async () => {
    const root = await fixture({ agents: ["codex", "opencode"] });
    await modernizeProjectionMetadata(root);
    const editedSkill = path.join(root, ".agentic", "skills", "process-lifecycle", "SKILL.md");
    await writeFile(editedSkill, `${await readFile(editedSkill, "utf8")}\n<!-- approved local extension -->\n`);
    await staleSkillBaselineHashes(root, "process-lifecycle");
    const configPath = path.join(root, ".agentic", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.hostBundles = "preserve";
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const blocked = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(blocked.canApply, false);
    assert.match(blocked.conflicts.join("\n"), /process-lifecycle.*risky.*allow-risky-tool-changes/i);

    const reviewed = await buildSupportedUpgradePlan(root, {
      allowNetwork: true,
      allowRiskyToolChanges: true,
    });
    assert.equal(reviewed.canApply, true, reviewed.conflicts.join("\n"));
    const lockOperation = reviewed.operations.find((item) => item.path === ".agentic/skills.lock.json");
    const lock = JSON.parse(Buffer.from(lockOperation.content, "base64").toString("utf8"));
    assert.equal(
      lock.skills["process-lifecycle"].installedHash,
      await hashDirectory(path.dirname(editedSkill)),
    );
    assert.equal(
      reviewed.operations.some((item) => (
        item.path.startsWith(".agents/")
        || item.path.startsWith(".codex/")
        || item.path.startsWith(".opencode/")
      )),
      false,
    );
  });

  it("gates stale risky baselines independently from managed projection convergence", async () => {
    const root = await fixture({ agents: ["codex", "opencode"] });
    await modernizeProjectionMetadata(root);
    const editedSkill = path.join(root, ".agentic", "skills", "process-lifecycle", "SKILL.md");
    const extension = "<!-- managed projection local extension -->";
    await writeFile(editedSkill, `${await readFile(editedSkill, "utf8")}\n${extension}\n`);
    await staleSkillBaselineHashes(root, "process-lifecycle");

    const blocked = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(blocked.canApply, false);
    assert.match(blocked.conflicts.join("\n"), /process-lifecycle.*risky.*allow-risky-tool-changes/i);

    const reviewed = await buildSupportedUpgradePlan(root, {
      allowNetwork: true,
      allowRiskyToolChanges: true,
    });
    assert.equal(reviewed.canApply, true, reviewed.conflicts.join("\n"));
    for (const destination of [".agents/skills", ".opencode/skills"]) {
      const projected = reviewed.operations.find(
        (item) => item.path === `${destination}/process-lifecycle/SKILL.md`,
      );
      assert.match(Buffer.from(projected.content, "base64").toString("utf8"), /managed projection local extension/);
    }
    const lockOperation = reviewed.operations.find((item) => item.path === ".agentic/skills.lock.json");
    const lock = JSON.parse(Buffer.from(lockOperation.content, "base64").toString("utf8"));
    assert.equal(
      lock.skills["process-lifecycle"].installedHash,
      await hashDirectory(path.dirname(editedSkill)),
    );
  });

  it("treats missing and malformed risky baseline hashes as requiring authority", async () => {
    const root = await fixture({ agents: ["codex", "opencode"] });
    await modernizeProjectionMetadata(root);
    await malformSkillBaselineHashes(root, "process-lifecycle");
    const configPath = path.join(root, ".agentic", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.hostBundles = "preserve";
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const blocked = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(blocked.canApply, false);
    assert.match(blocked.conflicts.join("\n"), /process-lifecycle.*risky.*allow-risky-tool-changes/i);

    const reviewed = await buildSupportedUpgradePlan(root, {
      allowNetwork: true,
      allowRiskyToolChanges: true,
    });
    assert.equal(reviewed.canApply, true, reviewed.conflicts.join("\n"));
  });

  it("requires risky-tool authority when baseline text no longer matches its recorded hashes", async () => {
    const root = await fixture({ agents: ["codex", "opencode"] });
    await modernizeProjectionMetadata(root);
    const baseline = path.join(root, ".agentic", "skill-baselines", "process-lifecycle", "SKILL.md");
    await writeFile(baseline, `${await readFile(baseline, "utf8")}\n<!-- altered baseline -->\n`);

    const blocked = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(blocked.canApply, false);
    assert.match(blocked.conflicts.join("\n"), /process-lifecycle.*risky.*allow-risky-tool-changes/i);
  });

  it("requires risky-tool authority when the baseline contains an unrecorded file", async () => {
    const root = await fixture({ agents: ["codex", "opencode"] });
    await modernizeProjectionMetadata(root);
    await writeFile(
      path.join(root, ".agentic", "skill-baselines", "process-lifecycle", "unrecorded.md"),
      "# Unrecorded baseline file\n",
    );

    const blocked = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(blocked.canApply, false);
    assert.match(blocked.conflicts.join("\n"), /process-lifecycle.*risky.*allow-risky-tool-changes/i);
  });

  it("requires risky-tool authority when the baseline tree contains a symlink", async (context) => {
    const root = await fixture({ agents: ["codex", "opencode"] });
    await modernizeProjectionMetadata(root);
    const baseline = path.join(root, ".agentic", "skill-baselines", "process-lifecycle");
    try {
      await symlink(
        path.join(baseline, "scripts"),
        path.join(baseline, "linked-scripts"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
        context.skip(`symlinks unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    const blocked = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(blocked.canApply, false);
    assert.match(blocked.conflicts.join("\n"), /process-lifecycle.*risky.*allow-risky-tool-changes/i);
  });

  it("removes an upstream-deleted skill file from canonical, baseline, and projections", async () => {
    const root = await fixture();
    const relative = path.join("verify", "legacy.md");
    const canonical = path.join(root, ".agentic", "skills", relative);
    const baseline = path.join(root, ".agentic", "skill-baselines", relative);
    const projected = path.join(root, ".agents", "skills", relative);
    const content = "legacy package file\n";
    await writeFile(canonical, content);
    await writeFile(baseline, content);
    await writeFile(projected, content);

    const lockPath = path.join(root, ".agentic", "skills.lock.json");
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    lock.skills.verify.baselineHash = await hashDirectory(path.dirname(baseline));
    lock.skills.verify.installedHash = await hashDirectory(path.dirname(canonical));
    lock.skills.verify.files["legacy.md"] = {
      baselineHash: hashBuffer(Buffer.from(content)),
      installedHash: hashBuffer(Buffer.from(content)),
    };
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const projectionsPath = path.join(root, ".agentic", "managed-projections.json");
    const projections = JSON.parse(await readFile(projectionsPath, "utf8"));
    projections.projections.codex.hash = await hashDirectory(path.join(root, ".agents", "skills"));
    await writeFile(projectionsPath, `${JSON.stringify(projections, null, 2)}\n`);

    const plan = await buildSupportedUpgradePlan(root, { allowSkillRemoval: true, allowNetwork: true });
    assert.equal(plan.canApply, true, plan.conflicts.join("\n"));
    assert.equal(plan.operations.some((item) =>
      item.kind === "delete-upgrade-managed" && item.path === ".agents/skills/verify/legacy.md"), true);
    await applyWithVerifier(plan, async () => ({ ok: true }));
    assert.equal(await exists(canonical), false);
    assert.equal(await exists(baseline), false);
    assert.equal(await exists(projected), false);
  });

  it("rejects incomplete marker keys and unrecorded projection directories", async () => {
    const root = await fixture();
    const canonical = path.join(root, ".agentic", "skills", "verify", "SKILL.md");
    await writeFile(canonical, `${await readFile(canonical, "utf8")}\n<!-- local extension -->\n`);
    await applyWithVerifier(await buildSupportedUpgradePlan(root, { allowNetwork: true }), async () => ({ ok: true }));
    const markerPath = path.join(root, ".agents", "skills", ".managed-by-workspace-template.json");
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    delete marker.skillHashes.verify;
    await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
    const missingKey = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(missingKey.canApply, false);
    assert.match(missingKey.conflicts.join("\n"), /projection (drift|catalog mismatch)/i);

    marker.skillHashes.verify = (JSON.parse(await readFile(
      path.join(root, ".agentic", "skills.lock.json"),
      "utf8",
    ))).skills.verify.installedHash;
    await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
    const manifestPath = path.join(root, ".agentic", "managed-projections.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const originalManifest = structuredClone(manifest);
    manifest.projections.codex.skills = manifest.projections.codex.skills.filter((name) => name !== "verify");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const manifestMismatch = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(manifestMismatch.canApply, false);
    assert.match(manifestMismatch.conflicts.join("\n"), /projection (drift|catalog mismatch)/i);
    delete originalManifest.skillHashes;
    await writeFile(manifestPath, `${JSON.stringify(originalManifest, null, 2)}\n`);
    const missingGlobalHashes = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(missingGlobalHashes.canApply, false);
    assert.match(missingGlobalHashes.conflicts.join("\n"), /projection (drift|catalog mismatch)/i);
    originalManifest.skillHashes = Object.fromEntries(
      Object.entries(JSON.parse(await readFile(
        path.join(root, ".agentic", "skills.lock.json"),
        "utf8",
      )).skills).map(([name, record]) => [name, record.installedHash]),
    );
    await writeFile(manifestPath, `${JSON.stringify(originalManifest, null, 2)}\n`);
    await mkdir(path.join(root, ".agents", "skills", "unrecorded"), { recursive: true });
    await writeFile(path.join(root, ".agents", "skills", "unrecorded", "SKILL.md"), "# unmanaged\n");
    const extraDirectory = await buildSupportedUpgradePlan(root, { allowNetwork: true });
    assert.equal(extraDirectory.canApply, false);
    assert.match(extraDirectory.conflicts.join("\n"), /projection (drift|catalog mismatch)/i);
  });

  it("advances a valid hash-keyed projection when the incoming catalog adds a skill", async () => {
    const root = await fixture();
    const canonical = path.join(root, ".agentic", "skills", "verify", "SKILL.md");
    await writeFile(canonical, `${await readFile(canonical, "utf8")}\n<!-- modernize projection marker -->\n`);
    await applyWithVerifier(await buildSupportedUpgradePlan(root, { allowNetwork: true }), async () => ({ ok: true }));

    const incoming = await mkdtemp(path.join(os.tmpdir(), "workspace-template-incoming-skills-"));
    await cp(assetsSkills, incoming, { recursive: true });
    await mkdir(path.join(incoming, "future-skill"), { recursive: true });
    await writeFile(path.join(incoming, "future-skill", "SKILL.md"), `---
name: future-skill
description: Test-only incoming skill.
---

# Future skill
`);
    const result = await planSkillUpgrade(await inspectUpgradeWorkspace(root), {
      incomingSkillsRoot: incoming,
    });
    assert.equal(result.conflicts.some((item) => /projection (drift|catalog mismatch)/i.test(item)), false, result.conflicts.join("\n"));
    assert.equal(result.operations.some((item) =>
      item.path === ".agents/skills/future-skill/SKILL.md" && item.kind === "create-upgrade-managed"), true);
  });

  it("blocks whole-skill removal when the old projected skill has drifted", async () => {
    const root = await fixture();
    const canonical = path.join(root, ".agentic", "skills", "wayfinder", "SKILL.md");
    await writeFile(canonical, `${await readFile(canonical, "utf8")}\n<!-- modernize projection marker -->\n`);
    await applyWithVerifier(await buildSupportedUpgradePlan(root, { allowNetwork: true }), async () => ({ ok: true }));
    const projected = path.join(root, ".agents", "skills", "verify", "SKILL.md");
    await writeFile(projected, `${await readFile(projected, "utf8")}\n<!-- projection drift -->\n`);

    const incoming = await mkdtemp(path.join(os.tmpdir(), "workspace-template-incoming-skills-"));
    await cp(assetsSkills, incoming, { recursive: true });
    await rm(path.join(incoming, "verify"), { recursive: true, force: true });
    const result = await planSkillUpgrade(await inspectUpgradeWorkspace(root), {
      incomingSkillsRoot: incoming,
      allowSkillRemoval: true,
    });
    assert.match(result.conflicts.join("\n"), /projection drift.*verify/i);
  });
});
