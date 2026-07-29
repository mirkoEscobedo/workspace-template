import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { adoptProject, applyAdoptionPlan } from "../src/adopt.js";
import { parseArgs } from "../src/args.js";
import { doctorProject } from "../src/doctor.js";
import { refreshPlanId } from "../src/plans/schema.js";
import { exists, hashFile, readJson } from "../src/fs-utils.js";

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

async function existingTypeScriptRepo({ customAgents = false, tickets = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-template-adopt-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "existing-app",
    private: true,
    scripts: {
      test: "node --test",
      typecheck: "tsc --noEmit",
      lint: "biome check .",
      check: "npm run typecheck && npm run lint && npm test",
    },
    devDependencies: { typescript: "7.0.2" },
  }, null, 2) + "\n");
  await writeFile(path.join(root, "package-lock.json"), JSON.stringify({ name: "existing-app", lockfileVersion: 3 }, null, 2) + "\n");
  await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }, null, 2) + "\n");
  await writeFile(path.join(root, "src", "index.ts"), "export const answer = 42;\n");
  await writeFile(path.join(root, "README.md"), "# Existing application\n\nKeep me byte-identical.\n");
  if (customAgents) {
    await writeFile(path.join(root, "AGENTS.md"), "# Existing policy\n\nKeep the product-specific policy.\n");
  }
  if (tickets) {
    const track = path.join(root, "docs", "tickets", "current-push");
    await mkdir(path.join(track, "001-first-behavior"), { recursive: true });
    await mkdir(path.join(track, "002-second-behavior"), { recursive: true });
    await writeFile(path.join(track, "master-prompt.md"), "# Current push\n\nDeliver the two observable behaviors.\n");
    await writeFile(path.join(track, "001-first-behavior", "ticket.md"), "# Ticket 001 - First behavior\n\n## Required Behavior\n\n- Preserve the public result.\n");
    await writeFile(path.join(track, "001-first-behavior", "validation.md"), "# Validation\n\nStatus: passed\n");
    await writeFile(path.join(track, "002-second-behavior", "ticket.md"), "# Ticket 002 - Second behavior\n\n## Required Behavior\n\n- Add the next public result.\n");
    await writeFile(path.join(track, "002-second-behavior", "validation.md"), "# Validation\n\nPending.\n");
  }
  git(root, ["init"]);
  git(root, ["add", "."]);
  git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "fixture"]);
  return root;
}

function adoptOptions(root, extra = []) {
  return parseArgs(["adopt", root, "--yes", ...extra]).options;
}

describe("adoptProject host preservation", () => {
  it("preserves divergent host bundles without planning host operations or collisions", async () => {
    const root = await existingTypeScriptRepo({ customAgents: true, tickets: false });
    const hostFiles = {
      ".agents/skills/wayfinder/SKILL.md": "---\nname: wayfinder\ndescription: product owned\n---\n# Product skill\n",
      ".codex/config.toml": "model = \"product-model\"\n",
      ".opencode/skills/wayfinder/SKILL.md": "---\nname: wayfinder\ndescription: product owned\n---\n# Product skill\n",
      "opencode.json": `${JSON.stringify({ productOwned: true }, null, 2)}\n`,
    };
    for (const [relative, content] of Object.entries(hostFiles)) {
      const destination = path.join(root, ...relative.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, content);
    }
    git(root, ["add", "."]);
    git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "product host bundles"]);
    const before = Object.fromEntries(
      await Promise.all(Object.keys(hostFiles).map(async (relative) => [relative, await hashFile(path.join(root, ...relative.split("/")))])),
    );

    const options = adoptOptions(root, ["--host-bundles", "preserve", "--no-tickets"]);
    const planned = await adoptProject({ ...options, dryRun: true });
    assert.equal(planned.plan.canApply, true, planned.plan.conflicts.join("\n"));
    assert.equal(planned.plan.selected.hostBundles, "preserve");
    assert.equal(
      planned.plan.operations.some((operation) => /^(?:\.agents|\.codex|\.opencode)(?:\/|$)|^opencode\.json$/.test(operation.path)),
      false,
    );
    assert.equal(
      planned.plan.conflictDetails.some((conflict) => /^(?:\.agents|\.codex|\.opencode)(?:\/|$)|^opencode\.json$/.test(conflict.path ?? "")),
      false,
    );

    const applied = await adoptProject(options);
    assert.equal(applied.result.ok, true, JSON.stringify(applied.result, null, 2));
    for (const [relative, hash] of Object.entries(before)) {
      assert.equal(await hashFile(path.join(root, ...relative.split("/"))), hash, `${relative} changed`);
    }
  });

  it("keeps doctor green for preserved product host layouts without managed root projections", async () => {
    const root = await existingTypeScriptRepo({ customAgents: true, tickets: false });
    const productHostFiles = {
      ".agents/skills/tdd/SKILL.md": "---\nname: tdd\ndescription: product owned\n---\n# Product TDD\n",
      ".opencode/agents/reviewer.md": "# Product-owned OpenCode agent\n",
    };
    for (const [relative, content] of Object.entries(productHostFiles)) {
      const destination = path.join(root, ...relative.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, content);
    }
    git(root, ["add", "."]);
    git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "product host layout"]);

    const execution = await adoptProject(adoptOptions(root, ["--host-bundles", "preserve", "--no-tickets"]));
    assert.equal(execution.result.ok, true, JSON.stringify(execution.result, null, 2));
    const config = await readJson(path.join(root, ".agentic", "config.json"));
    assert.equal(config.hostBundles, "preserve");
    assert.deepEqual(config.projections, {
      mode: "disabled",
      reason: "product-owned host bundles are preserved",
      agentTargets: ["codex", "opencode"],
    });
    const projections = await readJson(path.join(root, ".agentic", "managed-projections.json"));
    assert.equal(projections.mode, "disabled");
    const doctor = await doctorProject(root);
    assert.equal(doctor.ok, true, doctor.errors.join("\n"));
    assert.doesNotMatch(doctor.warnings.join("\n"), /projection (?:missing|drift)/i);
    assert.match(doctor.warnings.join("\n"), /host bundle.*preserved|managed projection.*not required/i);
  });

  it("records an exact rejection of a stale AGENTS proposal", async () => {
    const root = await existingTypeScriptRepo({ customAgents: true, tickets: false });
    const proposal = path.join(root, ".agentic", "proposals", "AGENTS.md");
    await mkdir(path.dirname(proposal), { recursive: true });
    await writeFile(proposal, "# stale proposal\n");
    git(root, ["add", "."]);
    git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "stale proposal"]);

    const execution = await adoptProject(adoptOptions(root, [
      "--host-bundles", "preserve",
      "--agents-proposal", "reject",
      "--no-tickets",
    ]));
    assert.equal(execution.result.ok, true, JSON.stringify(execution.result, null, 2));
    const disposition = await readJson(path.join(root, ".agentic", "proposal-disposition.json"));
    assert.equal(disposition.status, "rejected");
    assert.equal(disposition.path, ".agentic/proposals/AGENTS.md");
    assert.equal(disposition.hash, await hashFile(proposal));
    const doctor = await doctorProject(root);
    assert.doesNotMatch(doctor.warnings.join("\n"), /proposal is awaiting/i);
  });

  it("preserves reviewed project memory and records its exact managed hash", async () => {
    const root = await existingTypeScriptRepo({ tickets: false });
    await mkdir(path.join(root, "docs", "agent"), { recursive: true });
    const projectMap = path.join(root, "docs", "agent", "PROJECT_MAP.md");
    await writeFile(projectMap, "# Project map\n\nReviewed repository facts.\n");
    git(root, ["add", "."]);
    git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "reviewed memory"]);

    const execution = await adoptProject(adoptOptions(root, ["--agent-docs", "preserve", "--no-tickets"]));
    assert.equal(execution.result.ok, true, JSON.stringify(execution.result, null, 2));
    assert.equal(await readFile(projectMap, "utf8"), "# Project map\n\nReviewed repository facts.\n");
    const managed = await readJson(path.join(root, ".agentic", "managed-files.json"));
    assert.equal(managed.files["docs/agent/PROJECT_MAP.md"].hash, await hashFile(projectMap));
  });

  it("round-trips and revalidates a sealed preserve-host-bundles plan", async () => {
    const root = await existingTypeScriptRepo({ tickets: false });
    await mkdir(path.join(root, ".codex"), { recursive: true });
    await writeFile(path.join(root, ".codex", "config.toml"), "model = \"product-model\"\n");
    await writeFile(path.join(root, "opencode.json"), `${JSON.stringify({ productOwned: true }, null, 2)}\n`);
    git(root, ["add", "."]);
    git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "product host configuration"]);
    const planPath = path.join(path.dirname(root), `${path.basename(root)}-preserve-plan.json`);
    const options = adoptOptions(root, ["--host-bundles", "preserve", "--no-tickets"]);
    const planned = await adoptProject({ ...options, dryRun: true, planOut: planPath });
    assert.equal(planned.plan.selected.hostBundles, "preserve");

    const tamperedPath = path.join(path.dirname(root), `${path.basename(root)}-tampered-preserve-plan.json`);
    const tampered = await readJson(planPath);
    tampered.selected.hostBundles = "managed";
    await writeFile(tamperedPath, `${JSON.stringify(tampered, null, 2)}\n`);
    await assert.rejects(
      adoptProject({ ...adoptOptions(root), target: undefined, applyPlan: tamperedPath }),
      /planId does not match|integrity metadata does not match/i,
    );

    const applied = await adoptProject({ ...adoptOptions(root), target: undefined, applyPlan: planPath });
    assert.equal(applied.result.ok, true, JSON.stringify(applied.result, null, 2));
    assert.equal(applied.plan.planId, planned.plan.planId);
    assert.equal(applied.result.selected.hostBundles, "preserve");

    const staleRoot = await existingTypeScriptRepo({ tickets: false });
    const stalePlanPath = path.join(path.dirname(staleRoot), `${path.basename(staleRoot)}-preserve-plan.json`);
    await adoptProject({
      ...adoptOptions(staleRoot, ["--host-bundles", "preserve", "--no-tickets"]),
      dryRun: true,
      planOut: stalePlanPath,
    });
    await writeFile(path.join(staleRoot, "src", "index.ts"), "export const answer = 99;\n");
    await assert.rejects(
      adoptProject({ ...adoptOptions(staleRoot), target: undefined, applyPlan: stalePlanPath }),
      /preconditions no longer hold|working tree changed|fingerprinted path changed/i,
    );
    assert.equal(await exists(path.join(staleRoot, ".agentic")), false);
  });

  it("rejects hash-valid preserve plans with non-canonical host-bundle paths", async () => {
    const variants = [
      ".codex/config.toml",
      "./.codex/config.toml",
      ".agentic/../.codex/config.toml",
      ".codex\\config.toml",
      ".CoDeX/config.toml",
    ];
    for (const variant of variants) {
      const root = await existingTypeScriptRepo({ tickets: false });
      const managed = await adoptProject({ ...adoptOptions(root), dryRun: true });
      const forbidden = managed.plan.operations.find((operation) => operation.path === ".codex/config.toml");
      assert.ok(forbidden, "default managed plan should include the Codex host bundle");
      const nonHostOperations = managed.plan.operations.filter(
        (operation) => !/^(?:\.agents|\.codex|\.opencode)(?:\/|$)|^opencode\.json$/i.test(operation.path),
      );
      const forged = refreshPlanId({
        ...managed.plan,
        selected: { ...managed.plan.selected, hostBundles: "preserve" },
        operations: [...nonHostOperations, { ...forbidden, path: variant }],
      });

      await assert.rejects(
        applyAdoptionPlan(forged),
        /non-canonical operation path|preserve-host-bundles plan contains forbidden host operation/i,
        variant,
      );
      assert.equal(await exists(path.join(root, ".agentic")), false, variant);
    }
  });
});
