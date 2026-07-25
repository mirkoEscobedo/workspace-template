import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { applyToolingPlan } from "../src/tooling/apply.js";
import { buildToolingPlan } from "../src/tooling/plan.js";
import { exists, readJson } from "../src/fs-utils.js";
import { mergeStructuredConfig } from "../src/tooling/structured-edit.js";
import { temporaryDirectory, writeJsonFile } from "./helpers.js";

async function toolingFixture() {
  const root = await temporaryDirectory("caw-tooling-");
  await writeJsonFile(path.join(root, "package.json"), {
    name: "tooling-app",
    private: true,
    type: "module",
    scripts: { check: "node --test" },
    devDependencies: { typescript: "5.0.0" },
  });
  await writeJsonFile(path.join(root, "package-lock.json"), { name: "tooling-app", lockfileVersion: 3 });
  await writeJsonFile(path.join(root, "tsconfig.json"), { compilerOptions: { strict: true } });
  const catalog = path.join(root, "catalog.json");
  await writeJsonFile(catalog, {
    version: 1,
    packs: {
      local: {
        projects: {
          typescript: {
            dependencies: [{ name: "local-tool", version: "file:../vendor/local-tool", kind: "development" }],
            scripts: { lint: "local-tool check ." },
            configs: [{
              path: "tooling.json",
              format: "json",
              patches: [
                { path: "/checks/enabled", value: true },
                { path: "/checks/mode", value: "strict" },
              ],
            }],
          },
        },
      },
    },
  });
  return { root, catalog };
}

function successfulInstaller(root) {
  return async (_command, args, options) => {
    if (args[0] === "install" || args[0] === "add") {
      const packageFile = path.join(options.cwd, "package.json");
      const document = JSON.parse(await readFile(packageFile, "utf8"));
      document.devDependencies ??= {};
      document.devDependencies["local-tool"] = "file:../vendor/local-tool";
      await writeFile(packageFile, `${JSON.stringify(document, null, 2)}\n`);
      await writeFile(path.join(root, "package-lock.json"), '{"name":"tooling-app","lockfileVersion":3,"changed":true}\n');
    }
    return { status: 0, signal: null, stdout: "ok", stderr: "" };
  };
}

describe("tooling plans and controlled installation", () => {
  it("plans exact native package-manager argv without hidden network use", async () => {
    const { root, catalog } = await toolingFixture();
    const plan = await buildToolingPlan(root, { packs: ["local"], catalog, scripts: "managed-block" });
    assert.equal(plan.canApply, true, plan.conflicts.join("\n"));
    assert.equal(plan.commands.length, 1);
    assert.equal(plan.commands[0].executable, "npm");
    assert.deepEqual(plan.commands[0].args, ["install", "--save-dev", "--ignore-scripts", "local-tool@file:../vendor/local-tool"]);
    assert.equal(plan.commands[0].network, false);
    assert.equal(plan.commands[0].lifecycleScripts, false);
    assert.equal(plan.operations.some((operation) => operation.kind === "merge-package-scripts"), true);
    assert.equal(plan.operations.some((operation) => operation.kind === "merge-structured-config"), true);
  });

  it("applies an approved local dependency plan, integrates scripts, and journals completion", async () => {
    const { root, catalog } = await toolingFixture();
    const plan = await buildToolingPlan(root, { packs: ["local"], catalog, scripts: "managed-block" });
    const report = await applyToolingPlan(plan, { runner: successfulInstaller(root), skipVerification: true });
    assert.equal(report.ok, true);
    const packageJson = await readJson(path.join(root, "package.json"));
    assert.equal(packageJson.devDependencies["local-tool"], "file:../vendor/local-tool");
    assert.equal(packageJson.scripts.lint, "local-tool check .");
    assert.deepEqual(await readJson(path.join(root, "tooling.json")), { checks: { enabled: true, mode: "strict" } });
    await assert.rejects(applyToolingPlan(plan, { runner: successfulInstaller(root), skipVerification: true }), /already been applied/);
  });

  it("rejects and restores package-manager writes outside the reviewed path set", async () => {
    const { root, catalog } = await toolingFixture();
    await writeFile(path.join(root, "README.md"), "original\n");
    const plan = await buildToolingPlan(root, { packs: ["local"], catalog, scripts: "managed-block" });
    const runner = async (_command, args, options) => {
      if (args[0] === "install") {
        const packageFile = path.join(options.cwd, "package.json");
        const document = JSON.parse(await readFile(packageFile, "utf8"));
        document.devDependencies["local-tool"] = "file:../vendor/local-tool";
        await writeFile(packageFile, `${JSON.stringify(document, null, 2)}\n`);
        await writeFile(path.join(root, "package-lock.json"), '{"changed":true}\n');
        await writeFile(path.join(root, "README.md"), "unplanned mutation\n");
      }
      return { status: 0, signal: null, stdout: "ok", stderr: "" };
    };
    await assert.rejects(
      applyToolingPlan(plan, { runner, skipVerification: true }),
      /unplanned paths[\s\S]*README\.md/,
    );
    assert.equal(await readFile(path.join(root, "README.md"), "utf8"), "original\n");
    const packageJson = await readJson(path.join(root, "package.json"));
    assert.equal(packageJson.devDependencies["local-tool"], undefined);
  });

  it("rolls back tracked manifest and lockfile changes after a failed command", async () => {
    const { root, catalog } = await toolingFixture();
    const plan = await buildToolingPlan(root, { packs: ["local"], catalog, scripts: "managed-block" });
    const beforePackage = await readFile(path.join(root, "package.json"), "utf8");
    const beforeLock = await readFile(path.join(root, "package-lock.json"), "utf8");
    const runner = async (_command, args, options) => {
      if (args[0] === "install") {
        await writeFile(path.join(options.cwd, "package.json"), '{"broken":true}\n');
        await writeFile(path.join(root, "package-lock.json"), '{"broken":true}\n');
      }
      return { status: 1, signal: null, stdout: "", stderr: "simulated failure" };
    };
    await assert.rejects(applyToolingPlan(plan, { runner, skipVerification: true }), /Tooling command failed/);
    assert.equal(await readFile(path.join(root, "package.json"), "utf8"), beforePackage);
    assert.equal(await readFile(path.join(root, "package-lock.json"), "utf8"), beforeLock);
  });

  it("requires explicit authority for network, runtime, and lifecycle-script changes", async () => {
    const { root } = await toolingFixture();
    const network = await buildToolingPlan(root, { dependencies: ["remote-package@1.0.0"] });
    assert.equal(network.canApply, false);
    assert.match(network.conflicts.join("\n"), /network access/);

    const runtime = await buildToolingPlan(root, {
      dependencies: ["local-runtime@file:../local-runtime"],
      dependencyKind: "runtime",
    });
    assert.equal(runtime.canApply, false);
    assert.match(runtime.conflicts.join("\n"), /runtime dependencies require/);

    const lifecycle = await buildToolingPlan(root, {
      dependencies: ["local-tool@file:../local-tool"],
      lifecycleScripts: "allow",
    });
    assert.equal(lifecycle.canApply, true);
    await assert.rejects(
      applyToolingPlan(lifecycle, { runner: successfulInstaller(root), skipVerification: true }),
      /lifecycle scripts/,
    );
  });

  it("rejects and restores package-manager changes outside the reviewed mutation boundary", async () => {
    const { root, catalog } = await toolingFixture();
    const plan = await buildToolingPlan(root, { packs: ["local"], catalog, scripts: "managed-block" });
    const beforePackage = await readFile(path.join(root, "package.json"), "utf8");
    const beforeLock = await readFile(path.join(root, "package-lock.json"), "utf8");
    const runner = async (command, args, options) => {
      const result = await successfulInstaller(root)(command, args, options);
      if (args[0] === "install" || args[0] === "add") {
        await writeFile(path.join(root, "unplanned-source.js"), "export const leaked = true;\n");
      }
      return result;
    };
    await assert.rejects(
      applyToolingPlan(plan, { runner, skipVerification: true }),
      /unplanned paths changed|unplanned paths/,
    );
    assert.equal(await exists(path.join(root, "unplanned-source.js")), false);
    assert.equal(await readFile(path.join(root, "package.json"), "utf8"), beforePackage);
    assert.equal(await readFile(path.join(root, "package-lock.json"), "utf8"), beforeLock);
  });

  it("merges JSON, YAML, and TOML configuration conservatively without external parsers", () => {
    const json = mergeStructuredConfig('{"keep":1,"checks":{"enabled":false}}\n', "json", [
      { path: "/checks/enabled", value: true },
      { path: "/checks/mode", value: "strict" },
    ], "managed-block");
    assert.deepEqual(JSON.parse(json.content), { keep: 1, checks: { enabled: true, mode: "strict" } });
    assert.equal(json.conflicts.length, 1);

    const yaml = mergeStructuredConfig("include: old.yaml\nanalyzer:\n  strong-mode: true\n", "yaml", [
      { path: "/include", value: "package:flutter_lints/flutter.yaml" },
      { path: "/analyzer/exclude", value: ["build/**"] },
    ], "managed-block");
    assert.match(yaml.content, /include: package:flutter_lints\/flutter\.yaml/);
    assert.match(yaml.content, /exclude: \["?build\/\*\*"?\]/);
    assert.match(yaml.content, /strong-mode: true/);

    const toml = mergeStructuredConfig('[tool]\nkeep = true\n', "toml", [
      { path: "/tool/keep", value: false },
      { path: "/tool/mode", value: "strict" },
    ], "managed-block");
    assert.match(toml.content, /keep = false/);
    assert.match(toml.content, /mode = "strict"/);
  });

  it("preserves a conflicting structured config and writes a reviewable proposal", async () => {
    const { root, catalog } = await toolingFixture();
    await writeJsonFile(path.join(root, "tooling.json"), { custom: true, checks: { enabled: false } });
    const plan = await buildToolingPlan(root, { packs: ["local"], catalog, scripts: "propose" });
    assert.equal(plan.canApply, true, plan.conflicts.join("\n"));
    const operation = plan.operations.find((item) => item.kind === "merge-structured-config");
    assert.equal(operation.conflicts.length, 1);
    const report = await applyToolingPlan(plan, { runner: successfulInstaller(root), skipVerification: true });
    assert.equal(report.ok, true);
    assert.deepEqual(await readJson(path.join(root, "tooling.json")), { custom: true, checks: { enabled: false } });
    const proposal = path.join(root, operation.proposalPath);
    assert.equal(await exists(proposal), true);
    assert.deepEqual(await readJson(proposal), { custom: true, checks: { enabled: true, mode: "strict" } });
  });

});
