import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { assessArchitecture } from "../src/align/assess.js";
import { executeAlignmentPlan, resumeAlignmentPlan } from "../src/align/orchestrate.js";
import { planAlignment } from "../src/align/plan.js";
import { exists, readJson } from "../src/fs-utils.js";
import { temporaryDirectory, writeJsonFile } from "./helpers.js";

async function alignmentFixture() {
  const root = await temporaryDirectory("caw-align-");
  await mkdir(path.join(root, "src", "orders"), { recursive: true });
  await mkdir(path.join(root, "test", "orders"), { recursive: true });
  await writeJsonFile(path.join(root, "package.json"), {
    name: "alignment-app",
    private: true,
    type: "module",
    scripts: { check: "node --test" },
    devDependencies: { typescript: "5.0.0" },
  });
  await writeJsonFile(path.join(root, "package-lock.json"), { name: "alignment-app", lockfileVersion: 3 });
  await writeJsonFile(path.join(root, "tsconfig.json"), { compilerOptions: { strict: true } });
  await writeFile(path.join(root, "src", "orders", "order-service.ts"), `
export async function priceOrder(db, amount) {
  const now = Date.now();
  const row = await db.query("select discount from discounts");
  return { total: amount - row.discount, at: now };
}
`.trimStart());
  await writeFile(path.join(root, "test", "orders", "order-service.test.ts"), "// public seam characterization\n");
  return root;
}

const pass = async () => ({ status: 0, signal: null, stdout: "", stderr: "" });

describe("bounded architecture alignment", () => {
  it("produces source-located effect evidence and a protected vertical-slice plan", async () => {
    const root = await alignmentFixture();
    const assessment = await assessArchitecture(root);
    const serviceFindings = assessment.findings.filter((item) => item.file === "src/orders/order-service.ts");
    assert.equal(serviceFindings.some((item) => item.effect === "database"), true);
    assert.equal(serviceFindings.some((item) => item.effect === "clock"), true);
    assert.equal(serviceFindings.every((item) => !item.locations || item.locations.every((location) => Number.isInteger(location.line))), true);

    const plan = await planAlignment(root, {
      useCase: "src/orders/order-service.ts",
      style: "functional-core",
      checkpoint: "copy",
      characterization: "allow-existing",
      maxFiles: 6,
      maxDiffLines: 200,
    });
    assert.equal(plan.canApply, true, plan.conflicts.join("\n"));
    assert.equal(plan.approvals.semanticChanges, true);
    assert.equal(plan.alignment.allowedPaths.includes("src/orders/**"), true);
    assert.equal(plan.alignment.tasks.some((task) => task.recipe === "functional-core:explicit-inputs"), true);
    assert.equal(plan.alignment.tasks.some((task) => task.recipe === "functional-core:extract-policy"), true);
    assert.deepEqual(plan.alignment.changeBudget, { maxFiles: 6, maxDiffLines: 200 });
  });

  it("uses the simple recipe without inventing ports or architectural layers", async () => {
    const root = await alignmentFixture();
    const plan = await planAlignment(root, {
      useCase: "src/orders/order-service.ts",
      style: "simple",
      checkpoint: "copy",
      characterization: "allow-existing",
    });
    assert.equal(plan.alignment.recipe.name, "simple-explicit-effects");
    assert.equal(plan.alignment.tasks.some((task) => task.recipe === "simple:explicit-effects"), true);
    assert.equal(plan.alignment.tasks.some((task) => /port|adapter|repository/i.test(task.recipe)), false);
    assert.equal(plan.alignment.tasks.every((task) => task.recipe.startsWith("simple:")), true);
    assert.equal(plan.alignment.recipe.antiPatterns.some((item) => /interfaces or factories/i.test(item)), true);
  });

  it("uses the clean recipe only when volatile-effect evidence justifies a port", async () => {
    const root = await alignmentFixture();
    const plan = await planAlignment(root, {
      useCase: "src/orders/order-service.ts",
      style: "clean",
      checkpoint: "copy",
      characterization: "allow-existing",
    });
    assert.equal(plan.alignment.recipe.name, "clean-ports-and-adapters");
    for (const recipe of [
      "clean:application-use-case",
      "clean:extract-policy",
      "clean:port-adapter",
      "clean:delivery",
      "clean:wire",
    ]) {
      assert.equal(plan.alignment.tasks.some((task) => task.recipe === recipe), true, recipe);
    }
    assert.equal(plan.alignment.recipe.antiPatterns.some((item) => /one repository interface per table/i.test(item)), true);
    assert.equal(plan.alignment.recipe.invariants.some((item) => /actual use-case need/i.test(item)), true);
  });

  it("emits complete manual task requests without launching an executor", async () => {
    const root = await alignmentFixture();
    const plan = await planAlignment(root, {
      useCase: "src/orders/order-service.ts",
      checkpoint: "copy",
      characterization: "allow-existing",
      executor: "manual",
    });
    const report = await executeAlignmentPlan(plan, { runner: pass });
    assert.equal(report.status, "awaiting-manual");
    assert.equal(report.ok, false);
    assert.equal(report.tasks.length, plan.alignment.tasks.length);
    const request = path.join(root, report.tasks[0].request);
    assert.equal(await exists(request), true);
    const document = await readJson(request);
    assert.equal(document.taskId, plan.alignment.tasks[0].id);
    assert.match(document.prohibitions.join(" "), /commit/);
  });

  it("executes a configured command one task at a time and independently guards the actual diff", async () => {
    const root = await alignmentFixture();
    const plan = await planAlignment(root, {
      useCase: "src/orders/order-service.ts",
      checkpoint: "copy",
      characterization: "allow-existing",
      executor: "command:fake-agent",
      maxFiles: 6,
      maxDiffLines: 300,
    });
    const runner = async (command, args, options) => {
      if (command === "fake-agent") {
        const request = JSON.parse(await readFile(args[0], "utf8"));
        const file = path.join(request.root, "src", "orders", "order-service.ts");
        const current = await readFile(file, "utf8");
        const changedPaths = [];
        if (!current.includes("alignment-task:")) {
          await writeFile(file, `${current}\n// alignment-task: explicit bounded change\n`);
          changedPaths.push("src/orders/order-service.ts");
        }
        await writeJsonFile(request.resultPath, { taskId: request.taskId, status: "completed", changedPaths });
      }
      return { status: 0, signal: null, stdout: "ok", stderr: "" };
    };
    const report = await executeAlignmentPlan(plan, { runner, executor: "command:fake-agent" });
    assert.equal(report.ok, true);
    assert.equal(report.status, "completed");
    assert.deepEqual(report.diff.changedPaths, ["src/orders/order-service.ts"]);
    assert.match(await readFile(path.join(root, "src", "orders", "order-service.ts"), "utf8"), /alignment-task/);
    assert.match(report.next, /Stop/);
  });

  it("rejects executor changes outside the approved paths and leaves the target unchanged", async () => {
    const root = await alignmentFixture();
    await writeFile(path.join(root, "README.md"), "# Keep\n");
    const plan = await planAlignment(root, {
      useCase: "src/orders/order-service.ts",
      checkpoint: "copy",
      characterization: "allow-existing",
      executor: "command:fake-agent",
    });
    const runner = async (command, args, options) => {
      if (command === "fake-agent") {
        const request = JSON.parse(await readFile(args[0], "utf8"));
        await writeFile(path.join(options.cwd, "README.md"), "# Changed outside scope\n");
        await writeJsonFile(request.resultPath, { taskId: request.taskId, status: "completed", changedPaths: ["README.md"] });
      }
      return { status: 0, signal: null, stdout: "", stderr: "" };
    };
    await assert.rejects(executeAlignmentPlan(plan, { runner, executor: "command:fake-agent" }), /outside the approved scope/);
    assert.equal(await readFile(path.join(root, "README.md"), "utf8"), "# Keep\n");
  });

  it("resumes manual alignment one verified task at a time and completes only after every gate", async () => {
    const root = await alignmentFixture();
    const plan = await planAlignment(root, {
      useCase: "src/orders/order-service.ts",
      checkpoint: "copy",
      characterization: "allow-existing",
      executor: "manual",
      maxFiles: 6,
      maxDiffLines: 400,
    });
    let report = await executeAlignmentPlan(plan, { runner: pass });
    assert.equal(report.currentTaskIndex, 0);
    assert.equal(report.tasks.filter((item) => item.request).length, 1);

    for (let index = 0; index < plan.alignment.tasks.length; index += 1) {
      const task = plan.alignment.tasks[index];
      const changedPaths = [];
      if (index === 0) {
        const file = path.join(root, "src", "orders", "order-service.ts");
        const current = await readFile(file, "utf8");
        await writeFile(file, `${current}\n// manual-alignment: characterized\n`);
        changedPaths.push("src/orders/order-service.ts");
      }
      await writeJsonFile(path.join(root, ".agentic", "migrations", plan.planId, `${task.id}.result.json`), {
        taskId: task.id,
        status: "completed",
        changedPaths,
        notes: ["completed under the approved task contract"],
      });
      report = await resumeAlignmentPlan(plan, { runner: pass });
      if (index < plan.alignment.tasks.length - 1) {
        assert.equal(report.status, "awaiting-manual");
        assert.equal(report.currentTaskIndex, index + 1);
      }
    }
    assert.equal(report.status, "completed");
    assert.equal(report.ok, true);
    assert.deepEqual(report.diff.changedPaths, ["src/orders/order-service.ts"]);
    await assert.rejects(resumeAlignmentPlan(plan, { runner: pass }), /already been applied/);
  });

  it("keeps manual alignment resumable when the claimed result does not match the filesystem", async () => {
    const root = await alignmentFixture();
    const plan = await planAlignment(root, {
      useCase: "src/orders/order-service.ts",
      checkpoint: "copy",
      characterization: "allow-existing",
      executor: "manual",
    });
    const started = await executeAlignmentPlan(plan, { runner: pass });
    const task = plan.alignment.tasks[0];
    await writeJsonFile(path.join(root, ".agentic", "migrations", plan.planId, `${task.id}.result.json`), {
      taskId: task.id,
      status: "completed",
      changedPaths: ["src/orders/order-service.ts"],
    });
    await assert.rejects(resumeAlignmentPlan(plan, { runner: pass }), /do not match the filesystem diff/);
    const stored = await readJson(path.join(root, ".agentic", "reports", "migrations", `${plan.planId}.json`));
    assert.equal(stored.status, "awaiting-manual");
    assert.match(stored.lastFailure.error, /do not match/);
    assert.equal(started.currentTask, stored.currentTask);
  });

  it("restores the target semantic diff when final target verification fails", async () => {
    const root = await alignmentFixture();
    const sourceFile = path.join(root, "src", "orders", "order-service.ts");
    const before = await readFile(sourceFile, "utf8");
    const plan = await planAlignment(root, {
      useCase: "src/orders/order-service.ts",
      checkpoint: "copy",
      characterization: "allow-existing",
      executor: "command:fake-agent",
      maxFiles: 6,
      maxDiffLines: 300,
    });
    const runner = async (command, args, options) => {
      if (command === "fake-agent") {
        const request = JSON.parse(await readFile(args[0], "utf8"));
        const file = path.join(request.root, "src", "orders", "order-service.ts");
        const current = await readFile(file, "utf8");
        const changedPaths = [];
        if (!current.includes("rollback-check")) {
          await writeFile(file, `${current}
// rollback-check
`);
          changedPaths.push("src/orders/order-service.ts");
        }
        await writeJsonFile(request.resultPath, { taskId: request.taskId, status: "completed", changedPaths });
        return { status: 0, signal: null, stdout: "", stderr: "" };
      }
      return { status: path.resolve(options.cwd) === path.resolve(root) ? 1 : 0, signal: null, stdout: "", stderr: "target failed" };
    };
    await assert.rejects(executeAlignmentPlan(plan, { runner, executor: "command:fake-agent" }), /target worktree/);
    assert.equal(await readFile(sourceFile, "utf8"), before);
    const report = await readJson(path.join(root, ".agentic", "reports", "migrations", `${plan.planId}.json`));
    assert.deepEqual(report.restoration, { attempted: true, ok: true });
  });

  it("rejects and restores unplanned files created by final target verification", async () => {
    const root = await alignmentFixture();
    const sourceFile = path.join(root, "src", "orders", "order-service.ts");
    const before = await readFile(sourceFile, "utf8");
    await writeFile(path.join(root, "README.md"), "# Original\n");
    const plan = await planAlignment(root, {
      useCase: "src/orders/order-service.ts",
      checkpoint: "copy",
      characterization: "allow-existing",
      executor: "command:fake-agent",
      maxFiles: 6,
      maxDiffLines: 300,
    });
    let wroteTargetLeak = false;
    const runner = async (command, args, options) => {
      if (command === "fake-agent") {
        const request = JSON.parse(await readFile(args[0], "utf8"));
        const file = path.join(request.root, "src", "orders", "order-service.ts");
        const current = await readFile(file, "utf8");
        const changedPaths = [];
        if (!current.includes("mutation-guard")) {
          await writeFile(file, `${current}
// mutation-guard
`);
          changedPaths.push("src/orders/order-service.ts");
        }
        await writeJsonFile(request.resultPath, { taskId: request.taskId, status: "completed", changedPaths });
      } else if (path.resolve(options.cwd) === path.resolve(root) && !wroteTargetLeak) {
        wroteTargetLeak = true;
        await writeFile(path.join(root, "README.md"), "# Leaked\n");
      }
      return { status: 0, signal: null, stdout: "", stderr: "" };
    };
    await assert.rejects(executeAlignmentPlan(plan, { runner, executor: "command:fake-agent" }), /unplanned paths/);
    assert.equal(await readFile(sourceFile, "utf8"), before);
    assert.equal(await readFile(path.join(root, "README.md"), "utf8"), "# Original\n");
  });

});
