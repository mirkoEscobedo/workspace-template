import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { exists } from "../src/fs-utils.js";
import { parseDartReferences, planDartRewrites } from "../src/restructure/adapters/dart.js";
import { parseJavaScriptReferences } from "../src/restructure/adapters/javascript.js";
import { planRustRewrites } from "../src/restructure/adapters/rust.js";
import { applyRestructurePlan } from "../src/restructure/apply.js";
import { planRestructure } from "../src/restructure/plan.js";
import { temporaryDirectory, writeJsonFile } from "./helpers.js";

async function typescriptFixture() {
  const root = await temporaryDirectory("caw-restructure-");
  await mkdir(path.join(root, "src", "old"), { recursive: true });
  await writeJsonFile(path.join(root, "package.json"), {
    name: "restructure-app",
    private: true,
    type: "module",
    scripts: { check: "node --test" },
    devDependencies: { typescript: "5.0.0" },
  });
  await writeJsonFile(path.join(root, "package-lock.json"), { name: "restructure-app", lockfileVersion: 3 });
  await writeJsonFile(path.join(root, "tsconfig.json"), { compilerOptions: { strict: true } });
  await writeFile(path.join(root, "src", "old", "util.ts"), "export const value = 1;\n");
  await writeFile(path.join(root, "src", "index.ts"), 'import { value } from "./old/util";\nexport { value };\n');
  return root;
}

const passingRunner = async () => ({ status: 0, signal: null, stdout: "", stderr: "" });

describe("language-aware source restructuring", () => {
  it("moves a TypeScript file, rewrites parsed imports, and verifies in a checkpoint", async () => {
    const root = await typescriptFixture();
    const plan = await planRestructure(root, {
      moves: ["src/old/util.ts=src/new/util.ts"],
      checkpoint: "copy",
    });
    assert.equal(plan.canApply, true, plan.conflicts.join("\n"));
    assert.deepEqual(plan.restructure.moves, [{ from: "src/old/util.ts", to: "src/new/util.ts", reason: "explicit move" }]);
    assert.equal(plan.operations.some((operation) => operation.kind === "rewrite-reference" && operation.path === "src/index.ts"), true);

    const report = await applyRestructurePlan(plan, { runner: passingRunner });
    assert.equal(report.ok, true);
    assert.equal(await exists(path.join(root, "src", "old", "util.ts")), false);
    assert.equal(await exists(path.join(root, "src", "new", "util.ts")), true);
    assert.match(await readFile(path.join(root, "src", "index.ts"), "utf8"), /\.\/new\/util/);
  });

  it("blocks destination collisions before any move", async () => {
    const root = await typescriptFixture();
    await mkdir(path.join(root, "src", "new"), { recursive: true });
    await writeFile(path.join(root, "src", "new", "util.ts"), "export const other = 2;\n");
    const plan = await planRestructure(root, { moves: ["src/old/util.ts:src/new/util.ts"] });
    assert.equal(plan.canApply, false);
    assert.match(plan.conflicts.join("\n"), /destination already exists/);
    assert.equal(await exists(path.join(root, "src", "old", "util.ts")), true);
  });

  it("restores the target tree when post-apply verification fails", async () => {
    const root = await typescriptFixture();
    const before = await readFile(path.join(root, "src", "index.ts"), "utf8");
    const plan = await planRestructure(root, { moves: ["src/old/util.ts:src/new/util.ts"], checkpoint: "copy" });
    let invocation = 0;
    const runner = async () => ({ status: ++invocation === 1 ? 0 : 1, signal: null, stdout: "", stderr: "failed" });
    await assert.rejects(applyRestructurePlan(plan, { runner }), /verification failed/i);
    assert.equal(await exists(path.join(root, "src", "old", "util.ts")), true);
    assert.equal(await exists(path.join(root, "src", "new", "util.ts")), false);
    assert.equal(await readFile(path.join(root, "src", "index.ts"), "utf8"), before);
  });

  it("reports computed JavaScript module references as unsupported instead of rewriting by regex", () => {
    const parsed = parseJavaScriptReferences('const target = "./x";\nawait import(target);\n');
    assert.equal(parsed.references.length, 0);
    assert.equal(parsed.unsupported.some((item) => item.kind === "computed-module-reference"), true);
  });

  it("rewrites Rust crate use paths and Dart package references through parsed locations", async () => {
    const root = await temporaryDirectory("caw-restructure-adapters-");
    const rustMap = new Map([["src/old/policy.rs", "src/domain/policy.rs"]]);
    const rust = await planRustRewrites({
      root,
      file: "src/lib.rs",
      newFile: "src/lib.rs",
      text: "use crate::old::policy::calculate;\n",
      moveMap: rustMap,
      moduleRoot: ".",
    });
    assert.equal(rust.content, "use crate::domain::policy::calculate;\n");

    await mkdir(path.join(root, "lib", "old"), { recursive: true });
    await writeFile(path.join(root, "lib", "old", "value.dart"), "const value = 1;\n");
    const dartText = "import 'package:demo/old/value.dart';\n";
    assert.equal(parseDartReferences(dartText).references.length, 1);
    const dart = await planDartRewrites({
      root,
      file: "lib/main.dart",
      newFile: "lib/main.dart",
      text: dartText,
      moveMap: new Map([["lib/old/value.dart", "lib/domain/value.dart"]]),
      packageName: "demo",
      moduleRoot: ".",
    });
    assert.equal(dart.content, "import 'package:demo/domain/value.dart';\n");
  });

  it("blocks a mechanical move when a computed module reference cannot be resolved safely", async () => {
    const root = await typescriptFixture();
    await writeFile(path.join(root, "src", "dynamic.ts"), 'const target = "./old/util";\nexport const load = () => import(target);\n');
    const plan = await planRestructure(root, { moves: ["src/old/util.ts=>src/new/util.ts"] });
    assert.equal(plan.canApply, false);
    assert.match(plan.conflicts.join("\n"), /computed-module-reference/);
    assert.equal(await exists(path.join(root, "src", "old", "util.ts")), true);
  });

  it("rejects and restores unplanned files created during final verification", async () => {
    const root = await typescriptFixture();
    const beforeIndex = await readFile(path.join(root, "src", "index.ts"), "utf8");
    await writeFile(path.join(root, "README.md"), "# Original\n");
    const plan = await planRestructure(root, { moves: ["src/old/util.ts=>src/new/util.ts"], checkpoint: "copy" });
    let invocation = 0;
    const runner = async () => {
      invocation += 1;
      if (invocation === 2) await writeFile(path.join(root, "README.md"), "# Leaked\n");
      return { status: 0, signal: null, stdout: "", stderr: "" };
    };
    await assert.rejects(applyRestructurePlan(plan, { runner }), /unplanned paths/);
    assert.equal(await exists(path.join(root, "src", "old", "util.ts")), true);
    assert.equal(await exists(path.join(root, "src", "new", "util.ts")), false);
    assert.equal(await readFile(path.join(root, "src", "index.ts"), "utf8"), beforeIndex);
    assert.equal(await readFile(path.join(root, "README.md"), "utf8"), "# Original\n");
  });

});
