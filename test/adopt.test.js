import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { adoptProject, applyAdoptionPlan } from "../src/adopt.js";
import { parseArgs } from "../src/args.js";
import { doctorProject } from "../src/doctor.js";
import { assetsRoot } from "../src/workspace-artifacts.js";
import { createPlanEnvelope } from "../src/plans/schema.js";
import { exists, hashBuffer, hashFile, readJson } from "../src/fs-utils.js";

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

const leaseKeepPath = ".agent/leases/.gitkeep";

async function planWithLeasePatch(root, patch) {
  const planned = await adoptProject({ ...adoptOptions(root), dryRun: true });
  const operations = planned.plan.operations.map((operation) => {
    if (operation.path !== leaseKeepPath) return operation;
    return patch(operation);
  });
  assert.equal(
    operations.some((operation) => operation.path === leaseKeepPath),
    true,
    `Expected lease operation ${leaseKeepPath} in plan`,
  );
  return createPlanEnvelope({
    command: "adopt",
    root,
    operations,
    approvals: planned.plan.approvals,
    preconditions: planned.plan.preconditions,
    commands: planned.plan.commands,
    verification: planned.plan.verification,
    warnings: planned.plan.warnings,
    conflicts: [],
  });
}

function emptyBase64Hash() {
  return hashBuffer(Buffer.from("", "base64"));
}

describe("adoptProject", () => {
  it("plans a safe Frontier retrofit without touching application files", async () => {
    const root = await existingTypeScriptRepo();
    const result = await adoptProject({ ...adoptOptions(root), dryRun: true });
    const { plan } = result;

    assert.equal(plan.canApply, true, plan.conflicts.join("\n"));
    const paths = new Set(plan.operations.map((operation) => operation.path));
    assert.equal(paths.has(".agentic/skills/wayfinder/SKILL.md"), true);
    assert.equal(paths.has(".agentic/skills/compile-master-plan/SKILL.md"), true);
    assert.equal(paths.has(".codex/config.toml"), true);
    assert.equal(paths.has("opencode.json"), true);
    assert.equal(paths.has("docs/agent/PROJECT_MAP.md"), true);
    assert.equal(paths.has("docs/tickets/current-push/002-second-behavior/contract.yaml"), true);
    assert.equal(paths.has("package.json"), false);
    assert.equal(paths.has("package-lock.json"), false);
    assert.equal(paths.has("README.md"), false);
    assert.equal([...paths].some((item) => item.startsWith("src/")), false);
  });

  it("applies additively, preserves custom instructions, and installs the complete preset catalog", async () => {
    const root = await existingTypeScriptRepo({ customAgents: true });
    const protectedPaths = ["package.json", "package-lock.json", "tsconfig.json", "README.md", "src/index.ts", "AGENTS.md"];
    const before = Object.fromEntries(await Promise.all(protectedPaths.map(async (relative) => [relative, await hashFile(path.join(root, relative))])));

    const execution = await adoptProject(adoptOptions(root, ["--current-ticket", "002", "--trust-current-dependencies"]));
    assert.equal(execution.result.ok, true, JSON.stringify(execution.result, null, 2));

    for (const relative of protectedPaths) {
      assert.equal(await hashFile(path.join(root, relative)), before[relative], `${relative} changed`);
    }
    assert.equal(await exists(path.join(root, ".agentic", "proposals", "AGENTS.md")), true);
    assert.equal(await exists(path.join(root, ".agentic", "skills", "execute-frontier", "SKILL.md")), true);
    assert.equal(await exists(path.join(root, ".agents", "skills", "wayfinder", "SKILL.md")), true);
    assert.equal(await exists(path.join(root, ".opencode", "skills", "wayfinder", "SKILL.md")), true);
    assert.equal(await exists(path.join(root, "docs", "tickets", "current-push", "frontier.json")), true);

    const config = await readJson(path.join(root, ".agentic", "config.json"));
    assert.deepEqual(config.execution.coordinator, { model: "gpt-5.6-sol", reasoningEffort: "high" });
    assert.deepEqual(config.execution.workers, { model: "gpt-5.6-sol", reasoningEffort: "high" });
    assert.equal(config.execution.preset.id, "sol-only");
    assert.equal(await exists(path.join(root, ".agentic", "presets", "builtin", "sol-codex.json")), true);
    assert.equal(await exists(path.join(root, ".agentic", "presets", "builtin", "sol-only.json")), true);
    assert.deepEqual(config.agentTargets, ["codex", "opencode"]);

    const codex = await readFile(path.join(root, ".codex", "config.toml"), "utf8");
    assert.match(codex, /model = "gpt-5\.6-sol"/);
    assert.match(codex, /default_subagent_model = "gpt-5\.6-sol"/);
    assert.match(codex, /default_subagent_reasoning_effort = "high"/);
    const opencode = await readJson(path.join(root, "opencode.json"));
    assert.equal(opencode.agent["frontier-orchestrator"].model, "openai/gpt-5.6-sol");
    assert.equal(opencode.agent["ticket-implementer"].model, "openai/gpt-5.6-sol");

    const frontier = await readJson(path.join(root, "docs", "tickets", "current-push", "frontier.json"));
    assert.deepEqual(frontier.active, ["002"]);
    assert.equal(frontier.tickets["001"].status, "complete");

    const doctor = await doctorProject(root);
    assert.equal(doctor.ok, true, doctor.errors.join("\n"));
  });

  it("infers sol-codex when adopting a legacy generator-owned routing configuration", async () => {
    const root = await existingTypeScriptRepo({ tickets: false });
    await mkdir(path.join(root, ".agentic"), { recursive: true });
    await writeFile(path.join(root, ".agentic", "config.json"), `${JSON.stringify({
      version: 2,
      generator: "workspace-template",
      mode: "adopted",
      project: "typescript",
      style: "domain",
      tdd: "mockist",
      agentTargets: ["codex", "opencode"],
      execution: {
        coordinator: { model: "gpt-5.6-sol", reasoningEffort: "high" },
        planner: { model: "gpt-5.6-sol", reasoningEffort: "high" },
        workers: { model: "gpt-5.3-codex", reasoningEffort: "high" },
      },
    }, null, 2)}\n`);
    git(root, ["add", ".agentic/config.json"]);
    git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "legacy routing"]);

    const execution = await adoptProject(adoptOptions(root, ["--no-tickets"]));
    assert.equal(execution.result.ok, true, execution.result.doctor.errors.join("\n"));
    const config = await readJson(path.join(root, ".agentic", "config.json"));
    assert.equal(config.execution.preset.id, "sol-codex");
    assert.equal(config.execution.workers.model, "gpt-5.3-codex-spark");
    assert.equal(await exists(path.join(root, ".agentic", "presets", "builtin", "sol-only.json")), true);
  });

  it("blocks a dirty Git worktree unless explicitly authorized", async () => {
    const root = await existingTypeScriptRepo();
    await writeFile(path.join(root, "src", "index.ts"), "export const answer = 43;\n");

    const planned = await adoptProject({ ...adoptOptions(root), dryRun: true });
    assert.equal(planned.plan.canApply, false);
    assert.match(planned.plan.conflicts.join("\n"), /working tree is dirty/i);

    const allowed = await adoptProject({ ...adoptOptions(root, ["--allow-dirty"]), dryRun: true });
    assert.equal(allowed.plan.canApply, true, allowed.plan.conflicts.join("\n"));
  });

  it("can append one managed block without replacing custom AGENTS content", async () => {
    const root = await existingTypeScriptRepo({ customAgents: true, tickets: false });
    const original = await readFile(path.join(root, "AGENTS.md"), "utf8");
    const applied = await adoptProject(adoptOptions(root, ["--conflict", "managed-block"]));
    assert.equal(applied.result.ok, true, applied.result.doctor.errors.join("\n"));
    const current = await readFile(path.join(root, "AGENTS.md"), "utf8");
    assert.match(current, new RegExp(original.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal((current.match(/workspace-template:begin workspace-template/g) ?? []).length, 1);
    assert.equal((current.match(/workspace-template:end workspace-template/g) ?? []).length, 1);
  });

  it("blocks an unmanaged divergent projected skill before writing any adoption artifact", async () => {
    const root = await existingTypeScriptRepo({ tickets: false });
    const collision = path.join(root, ".agents", "skills", "wayfinder");
    await mkdir(collision, { recursive: true });
    await writeFile(path.join(collision, "SKILL.md"), "---\nname: wayfinder\ndescription: custom\n---\n# Custom\n");
    git(root, ["add", "."]);
    git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "custom projected skill"]);

    const planned = await adoptProject({ ...adoptOptions(root), dryRun: true });
    assert.equal(planned.plan.canApply, false);
    assert.match(planned.plan.conflicts.join("\n"), /unmanaged divergent projected skill collision/);
    assert.equal(await exists(path.join(root, ".agentic")), false);
  });

  it("round-trips a persisted adoption plan and rejects stale repository state", async () => {
    const root = await existingTypeScriptRepo({ tickets: false });
    const planPath = path.join(root, "adoption-plan.json");
    const planned = await adoptProject({ ...adoptOptions(root), dryRun: true, planOut: planPath });
    assert.equal(await exists(planPath), true);
    const applied = await adoptProject({ ...adoptOptions(root), target: undefined, applyPlan: planPath });
    assert.equal(applied.result.ok, true, JSON.stringify(applied.result, null, 2));
    assert.equal(applied.plan.planId, planned.plan.planId);

    const staleRoot = await existingTypeScriptRepo({ tickets: false });
    const stalePlan = path.join(path.dirname(staleRoot), `${path.basename(staleRoot)}-adoption-plan.json`);
    await adoptProject({ ...adoptOptions(staleRoot), dryRun: true, planOut: stalePlan });
    await writeFile(path.join(staleRoot, "src", "index.ts"), "export const answer = 99;\n");
    await assert.rejects(
      adoptProject({ ...adoptOptions(staleRoot), target: undefined, applyPlan: stalePlan }),
      /preconditions no longer hold|working tree changed|fingerprinted path changed/i,
    );
    assert.equal(await exists(path.join(staleRoot, ".agentic")), false);
  });


  it("adopts a supported monorepo as one Frontier workspace with scoped module instructions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workspace-template-adopt-workspace-"));
    await mkdir(path.join(root, "packages", "shared", "src"), { recursive: true });
    await mkdir(path.join(root, "apps", "web", "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      name: "workspace-root",
      private: true,
      workspaces: ["packages/*", "apps/*"],
      scripts: { check: "node --test" },
    }, null, 2) + "\n");
    await writeFile(path.join(root, "package-lock.json"), JSON.stringify({ name: "workspace-root", lockfileVersion: 3 }, null, 2) + "\n");
    await writeFile(path.join(root, "packages", "shared", "package.json"), JSON.stringify({
      name: "@acme/shared",
      private: true,
      type: "module",
      scripts: { check: "node --test" },
      devDependencies: { typescript: "7.0.2" },
    }, null, 2) + "\n");
    await writeFile(path.join(root, "packages", "shared", "tsconfig.json"), "{}\n");
    await writeFile(path.join(root, "packages", "shared", "src", "index.ts"), "export const shared = 1;\n");
    await writeFile(path.join(root, "apps", "web", "package.json"), JSON.stringify({
      name: "@acme/web",
      private: true,
      type: "module",
      scripts: { check: "node --test" },
      dependencies: { "@acme/shared": "workspace:*", react: "19.0.0" },
      devDependencies: { typescript: "7.0.2" },
    }, null, 2) + "\n");
    await writeFile(path.join(root, "apps", "web", "tsconfig.json"), "{}\n");
    await writeFile(path.join(root, "apps", "web", "src", "index.tsx"), "export const App = () => null;\n");
    git(root, ["init"]);
    git(root, ["add", "."]);
    git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "workspace fixture"]);

    const protectedPaths = [
      "package.json",
      "package-lock.json",
      "packages/shared/package.json",
      "packages/shared/src/index.ts",
      "apps/web/package.json",
      "apps/web/src/index.tsx",
    ];
    const before = Object.fromEntries(await Promise.all(protectedPaths.map(async (relative) => [relative, await hashFile(path.join(root, relative))])));
    const execution = await adoptProject(adoptOptions(root, ["--workspace", "all", "--nested-instructions", "auto", "--no-tickets"]));
    assert.equal(execution.result.ok, true, JSON.stringify(execution.result, null, 2));

    for (const relative of protectedPaths) assert.equal(await hashFile(path.join(root, relative)), before[relative], `${relative} changed`);
    const workspace = await readJson(path.join(root, ".agentic", "workspace.json"));
    assert.equal(workspace.kind, "node");
    assert.deepEqual(workspace.modules.map((module) => module.id), ["acme-web", "acme-shared"]);
    assert.deepEqual(workspace.modules.find((module) => module.id === "acme-web").dependencies, ["acme-shared"]);
    assert.equal(workspace.rootModule.aggregate, true);
    assert.equal(await exists(path.join(root, "apps", "web", "AGENTS.md")), true);
    assert.equal(await exists(path.join(root, "packages", "shared", "AGENTS.md")), true);
    const nested = await readFile(path.join(root, "apps", "web", "AGENTS.md"), "utf8");
    assert.match(nested, /Inherit repository-wide policy from the root/);
    assert.doesNotMatch(nested, /## Security boundaries/);
    const doctor = await doctorProject(root);
    assert.equal(doctor.ok, true, doctor.errors.join("\n"));
  });

  it("adopts a zero-byte file from sourceAsset", async () => {
    const root = await existingTypeScriptRepo({ customAgents: true, tickets: false });
    const sourceAsset = `.adopt-empty-${randomUUID()}.txt`;
    const sourcePath = path.join(assetsRoot, sourceAsset);
    await writeFile(sourcePath, "");

    try {
      const plan = await planWithLeasePatch(root, (operation) => {
        const { content, contentEncoding, ...base } = operation;
        return { ...base, sourceAsset, proposedHash: emptyBase64Hash() };
      });
      const execution = await applyAdoptionPlan(plan);
      assert.equal(execution.ok, true, JSON.stringify(execution, null, 2));

      const leaseKeep = await readFile(path.join(root, leaseKeepPath));
      assert.equal(leaseKeep.length, 0);
    } finally {
      await rm(sourcePath, { force: true });
    }
  });

  it("adopts an empty UTF-8 content operation", async () => {
    const root = await existingTypeScriptRepo({ customAgents: true, tickets: false });
    const plan = await planWithLeasePatch(root, (operation) => {
      const { content, sourceAsset, contentEncoding, ...base } = operation;
      return { ...base, content: "", proposedHash: emptyBase64Hash() };
    });
    const execution = await applyAdoptionPlan(plan);
    assert.equal(execution.ok, true, JSON.stringify(execution, null, 2));

    const leaseKeep = await readFile(path.join(root, leaseKeepPath));
    assert.equal(leaseKeep.length, 0);
  });

  it("adopts an empty base64 content operation", async () => {
    const root = await existingTypeScriptRepo({ customAgents: true, tickets: false });
    const plan = await planWithLeasePatch(root, (operation) => {
      const { sourceAsset, ...base } = operation;
      return {
        ...base,
        content: "",
        contentEncoding: "base64",
        proposedHash: emptyBase64Hash(),
      };
    });
    const execution = await applyAdoptionPlan(plan);
    assert.equal(execution.ok, true, JSON.stringify(execution, null, 2));

    const leaseKeep = await readFile(path.join(root, leaseKeepPath));
    assert.equal(leaseKeep.length, 0);
  });

  it("rejects operations with no content source", async () => {
    const root = await existingTypeScriptRepo({ customAgents: true, tickets: false });
    const plan = await planWithLeasePatch(root, (operation) => {
      const { sourceAsset, content, contentEncoding, ...base } = operation;
      return base;
    });
    await assert.rejects(() => applyAdoptionPlan(plan), /has no content source/i);
  });

  it("rejects unsupported content encodings", async () => {
    const root = await existingTypeScriptRepo({ customAgents: true, tickets: false });
    const plan = await planWithLeasePatch(root, (operation) => {
      const { sourceAsset, ...base } = operation;
      return {
        ...base,
        content: "",
        contentEncoding: "invalid-encoding",
        proposedHash: emptyBase64Hash(),
      };
    });
    await assert.rejects(
      () => applyAdoptionPlan(plan),
      /unsupported content encoding/i,
    );
  });

});
