import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { discoverWorkspace } from "../src/workspace/discover.js";
import { includeDependents, owningModules } from "../src/workspace/affected.js";
import { verifyWorkspace } from "../src/workspace/verify.js";
import { createNodeModule, temporaryDirectory, writeJsonFile } from "./helpers.js";

describe("workspace discovery and orchestration", () => {
  it("discovers a package workspace, stable internal edges, and lock ownership", async () => {
    const root = await temporaryDirectory("caw-workspace-");
    await writeJsonFile(path.join(root, "package.json"), { name: "root", private: true, workspaces: ["packages/*"] });
    await writeFile(path.join(root, "package-lock.json"), "{}\n");
    await createNodeModule(root, "packages/core", { name: "@demo/core" });
    await createNodeModule(root, "packages/app", { name: "@demo/app", dependencies: { "@demo/core": "workspace:*" } });

    const first = await discoverWorkspace(root, { workspace: "all" });
    const second = await discoverWorkspace(root, { workspace: "all" });
    assert.equal(first.canUse, true, first.conflicts.join("\n"));
    assert.equal(first.kind, "node");
    assert.equal(first.fingerprint, second.fingerprint);
    assert.deepEqual(first.modules.map((module) => module.id), ["demo-app", "demo-core"]);
    assert.deepEqual(first.modules.find((module) => module.id === "demo-app").dependencies, ["demo-core"]);
    assert.equal(first.modules.every((module) => module.lockOwner === "."), true);
  });

  it("retains unsupported workspace members as opaque evidence", async () => {
    const root = await temporaryDirectory("caw-workspace-opaque-");
    await writeJsonFile(path.join(root, "package.json"), { name: "root", private: true, workspaces: ["packages/*"] });
    await writeFile(path.join(root, "package-lock.json"), "{}\n");
    await createNodeModule(root, "packages/app", { name: "app" });
    await mkdir(path.join(root, "packages", "legacy"), { recursive: true });
    await writeFile(path.join(root, "packages", "legacy", "project.clj"), "(defproject legacy \"1\")\n");

    const workspace = await discoverWorkspace(root, { workspace: "all", includeOpaque: true });
    const opaque = workspace.modules.find((module) => module.path === "packages/legacy");
    assert.ok(opaque, JSON.stringify(workspace, null, 2));
    assert.equal(opaque.opaque, true);
    assert.equal(opaque.project, "unsupported");
  });

  it("selects changed owners and transitive dependents", async () => {
    const root = await temporaryDirectory("caw-workspace-affected-");
    await writeJsonFile(path.join(root, "package.json"), { name: "root", private: true, workspaces: ["packages/*"] });
    await writeFile(path.join(root, "package-lock.json"), "{}\n");
    await createNodeModule(root, "packages/core", { name: "core" });
    await createNodeModule(root, "packages/app", { name: "app", dependencies: { core: "workspace:*" } });
    const workspace = await discoverWorkspace(root, { workspace: "all" });
    const owners = owningModules(workspace, ["packages/core/src/index.ts"]);
    const affected = includeDependents(workspace, owners);
    assert.deepEqual([...owners], ["core"]);
    assert.deepEqual([...affected].sort(), ["app", "core"]);
  });

  it("verifies dependencies before dependents and preserves deterministic report order", async () => {
    const root = await temporaryDirectory("caw-workspace-verify-");
    await writeJsonFile(path.join(root, "package.json"), { name: "root", private: true, workspaces: ["packages/*"] });
    await writeFile(path.join(root, "package-lock.json"), "{}\n");
    await createNodeModule(root, "packages/core", { name: "core" });
    await createNodeModule(root, "packages/app", { name: "app", dependencies: { core: "workspace:*" } });
    const workspace = await discoverWorkspace(root, { workspace: "all" });
    const calls = [];
    const runner = async (_command, _args, options) => {
      calls.push(path.relative(root, options.cwd).replaceAll("\\", "/"));
      return { status: 0, signal: null, stdout: "", stderr: "" };
    };
    const report = await verifyWorkspace(root, workspace, { concurrency: 2, runner });
    assert.equal(report.ok, true);
    assert.deepEqual(calls, ["packages/core", "packages/app"]);
    assert.deepEqual(report.results.map((item) => item.path), ["packages/app", "packages/core"]);
  });

  it("marks dependents blocked after a dependency failure", async () => {
    const root = await temporaryDirectory("caw-workspace-blocked-");
    await writeJsonFile(path.join(root, "package.json"), { name: "root", private: true, workspaces: ["packages/*"] });
    await writeFile(path.join(root, "package-lock.json"), "{}\n");
    await createNodeModule(root, "packages/core", { name: "core" });
    await createNodeModule(root, "packages/app", { name: "app", dependencies: { core: "workspace:*" } });
    const workspace = await discoverWorkspace(root, { workspace: "all" });
    const runner = async (_command, _args, options) => ({
      status: options.cwd.endsWith(path.join("packages", "core")) ? 1 : 0,
      signal: null,
      stdout: "",
      stderr: "failed",
    });
    const report = await verifyWorkspace(root, workspace, { runner });
    assert.equal(report.ok, false);
    assert.equal(report.results.find((item) => item.module === "core").state, "failed");
    assert.equal(report.results.find((item) => item.module === "app").state, "blocked");
  });

  it("keeps the workspace root as a distinct aggregate verification scope", async () => {
    const root = await temporaryDirectory("caw-workspace-root-scope-");
    await writeJsonFile(path.join(root, "package.json"), {
      name: "root",
      private: true,
      workspaces: ["packages/*"],
      scripts: { check: "node --test" },
    });
    await writeFile(path.join(root, "package-lock.json"), "{}\n");
    await createNodeModule(root, "packages/app", { name: "app" });
    const workspace = await discoverWorkspace(root, { workspace: "all", includeRootModule: true });
    assert.equal(workspace.modules.some((module) => module.path === "."), false);
    assert.equal(workspace.rootModule.id, "workspace-root");
    const calls = [];
    const report = await verifyWorkspace(root, workspace, {
      scope: "root",
      runner: async (_command, _args, options) => {
        calls.push(path.relative(root, options.cwd) || ".");
        return { status: 0, signal: null, stdout: "", stderr: "" };
      },
    });
    assert.equal(report.ok, true);
    assert.deepEqual(calls, ["."]);
    assert.deepEqual(report.selected, ["workspace-root"]);
  });

  it("blocks ambiguous lockfile ownership instead of selecting the first manager", async () => {
    const root = await temporaryDirectory("caw-workspace-lock-conflict-");
    await writeJsonFile(path.join(root, "package.json"), { name: "root", private: true, workspaces: ["packages/*"] });
    await writeFile(path.join(root, "package-lock.json"), "{}\n");
    await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9'\n");
    await createNodeModule(root, "packages/app", { name: "app" });
    const workspace = await discoverWorkspace(root, { workspace: "all" });
    assert.equal(workspace.canUse, false);
    assert.match(workspace.conflicts.join("\n"), /multiple package-manager lockfiles/);
  });

  it("rejects unknown module selectors before running verification", async () => {
    const root = await temporaryDirectory("caw-workspace-selector-");
    await writeJsonFile(path.join(root, "package.json"), { name: "root", private: true, workspaces: ["packages/*"] });
    await writeFile(path.join(root, "package-lock.json"), "{}\n");
    await createNodeModule(root, "packages/app", { name: "app" });
    const workspace = await discoverWorkspace(root, { workspace: "all" });
    await assert.rejects(
      verifyWorkspace(root, workspace, { scope: "module", modules: ["missing"] }),
      /Unknown module selector/,
    );
  });


  it("discovers Cargo members and path-dependency ordering", async () => {
    const root = await temporaryDirectory("caw-cargo-workspace-");
    await writeFile(path.join(root, "Cargo.toml"), '[workspace]\nmembers = ["crates/*"]\nresolver = "2"\n');
    await writeFile(path.join(root, "Cargo.lock"), "# lock\n");
    await mkdir(path.join(root, "crates", "core", "src"), { recursive: true });
    await mkdir(path.join(root, "crates", "app", "src"), { recursive: true });
    await writeFile(path.join(root, "crates", "core", "Cargo.toml"), '[package]\nname = "core"\nversion = "0.1.0"\n');
    await writeFile(path.join(root, "crates", "app", "Cargo.toml"), '[package]\nname = "app"\nversion = "0.1.0"\n\n[dependencies]\ncore = { path = "../core" }\n');
    const workspace = await discoverWorkspace(root, { workspace: "all" });
    assert.equal(workspace.canUse, true, workspace.conflicts.join("\n"));
    assert.equal(workspace.kind, "rust");
    assert.deepEqual(workspace.modules.map((module) => module.id), ["app", "core"]);
    assert.deepEqual(workspace.modules.find((module) => module.id === "app").dependencies, ["core"]);
    assert.equal(workspace.modules.every((module) => module.lockOwner === "."), true);
  });

  it("builds one polyglot graph instead of selecting the first ecosystem", async () => {
    const root = await temporaryDirectory("caw-polyglot-workspace-");
    await writeJsonFile(path.join(root, "package.json"), { name: "root", private: true, workspaces: ["packages/*"] });
    await writeFile(path.join(root, "package-lock.json"), "{}\n");
    await writeFile(path.join(root, "Cargo.toml"), '[workspace]\nmembers = ["crates/*"]\n');
    await mkdir(path.join(root, "packages", "web"), { recursive: true });
    await createNodeModule(root, "packages/web", { name: "web", dependencies: { react: "18.0.0" } });
    await mkdir(path.join(root, "crates", "core", "src"), { recursive: true });
    await writeFile(path.join(root, "crates", "core", "Cargo.toml"), '[package]\nname = "core"\nversion = "0.1.0"\n');
    const workspace = await discoverWorkspace(root, { workspace: "all" });
    assert.equal(workspace.canUse, true, workspace.conflicts.join("\n"));
    assert.equal(workspace.kind, "polyglot");
    assert.deepEqual(workspace.modules.map((module) => module.project).sort(), ["react", "rust"]);
  });

  it("blocks overlapping module roots and conflicting lockfile ownership", async () => {
    const root = await temporaryDirectory("caw-overlap-workspace-");
    await writeJsonFile(path.join(root, "package.json"), {
      name: "root",
      private: true,
      workspaces: ["packages/*", "packages/app/plugins/*"],
    });
    await writeFile(path.join(root, "package-lock.json"), "{}\n");
    await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await createNodeModule(root, "packages/app", { name: "app" });
    await createNodeModule(root, "packages/app/plugins/demo", { name: "demo" });
    const workspace = await discoverWorkspace(root, { workspace: "all" });
    assert.equal(workspace.canUse, false);
    assert.match(workspace.conflicts.join("\n"), /overlapping module roots/);
    assert.match(workspace.conflicts.join("\n"), /multiple package-manager lockfiles/);
  });

});
