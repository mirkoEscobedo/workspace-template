import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import {
  buildUpgradePlan,
  createProject,
  defaultUpgradePlanPath,
  persistUpgradePlan,
} from "../src/index.js";
import { exists } from "../src/fs-utils.js";
import { resolveProcessIdentity } from "../src/process-utils.js";
import { acquireUpgradeMutex } from "../src/upgrade/apply.js";

const execFileAsync = promisify(execFile);
const cliModule = pathToFileURL(path.resolve("src", "cli.js")).href;
const cliInvocation = `
  import { main } from ${JSON.stringify(cliModule)};
  main(process.argv.slice(1)).catch((error) => {
    console.error(\`Error: \${error instanceof Error ? error.message : String(error)}\`);
    process.exitCode = 1;
  });
`;

async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "workspace-template-upgrade-cli-"));
  const root = path.join(parent, "repo");
  await createProject({
    target: root, project: "javascript", style: "functional-core", tdd: "pragmatic",
    packageManager: "npm", agents: [], preset: "sol-codex",
    install: false, git: false, bootstrap: false, force: false, dryRun: false, yes: true,
  });
  await mkdir(path.join(root, "test"), { recursive: true });
  await writeFile(path.join(root, "test", "smoke.test.js"), "import { test } from 'node:test';\ntest('smoke', () => {});\n");
  const packagePath = path.join(root, "package.json");
  const manifest = JSON.parse(await readFile(packagePath, "utf8"));
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) delete manifest[section];
  manifest.scripts = { test: "node --test", check: "node --test" };
  await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
  return root;
}

async function runCli(args) {
  return execFileAsync(process.execPath, ["--input-type=module", "--eval", cliInvocation, ...args], {
    cwd: path.resolve(),
    encoding: "utf8",
    timeout: 60_000,
  });
}

describe("upgrade CLI completion output", () => {
  it("completes a bare non-JSON upgrade without treating its report as a plan", async () => {
    const root = await fixture();
    const result = await runCli(["upgrade", root, "--allow-network"]);
    assert.match(result.stdout, /Workspace (?:is already current|upgrade completed)/);
    assert.doesNotMatch(result.stderr, /Error:/);
  });

  it("completes a saved-plan non-JSON upgrade without treating its report as a plan", async () => {
    const root = await fixture();
    const plan = await buildUpgradePlan(root, { allowNetwork: true });
    const planPath = path.resolve(root, defaultUpgradePlanPath(plan));
    await persistUpgradePlan(planPath, plan);
    const result = await runCli(["upgrade", root, "--apply-plan", planPath]);
    assert.match(result.stdout, /Workspace (?:is already current|upgrade completed)/);
    assert.doesNotMatch(result.stderr, /Error:/);
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    it(`waits for detached verification cleanup before exiting on ${signal} via Windows IPC/process.emit simulation`, {
      skip: process.platform !== "win32",
    }, async () => {
      const root = await fixture();
      const marker = path.join(path.dirname(root), `${signal.toLowerCase()}-grandchild.json`);
      const verificationScript = `
        import { spawn } from "node:child_process";
        import { writeFileSync } from "node:fs";
        const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
          detached: true,
          stdio: "ignore",
        });
        writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ pid: child.pid }));
        child.unref();
        setInterval(() => {}, 1000);
      `;
      await writeFile(path.join(root, "test", "hanging-verification.js"), verificationScript);
      const packagePath = path.join(root, "package.json");
      const manifest = JSON.parse(await readFile(packagePath, "utf8"));
      manifest.scripts.check = "node test/hanging-verification.js";
      await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);

      const signalInvocation = `
        import { main } from ${JSON.stringify(cliModule)};
        process.on("message", (message) => {
          if (message?.signal) process.emit(message.signal, message.signal);
        });
        main(process.argv.slice(1)).then(
          () => process.disconnect?.(),
          (error) => {
            console.error(\`Error: \${error instanceof Error ? error.message : String(error)}\`);
            process.exitCode = 1;
            process.disconnect?.();
          },
        );
      `;
      const cli = spawn(process.execPath, [
        "--input-type=module",
        "--eval",
        signalInvocation,
        "upgrade",
        root,
        "--allow-network",
      ], {
        cwd: path.resolve(),
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        windowsHide: true,
      });
      let stderr = "";
      cli.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
      const exited = new Promise((resolve) => {
        cli.once("close", (status, exitSignal) => resolve({ status, signal: exitSignal }));
      });
      const deadline = Date.now() + 30_000;
      while (!(await exists(marker)) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(await exists(marker), true, stderr);
      const { pid } = JSON.parse(await readFile(marker, "utf8"));
      const exactIdentity = await resolveProcessIdentity(pid);
      assert.equal(exactIdentity.state, "alive", `grandchild ${pid} must be alive before ${signal}`);

      cli.send({ signal });
      const exit = await exited;
      assert.notEqual(exit.status, 0);
      assert.match(stderr, new RegExp(`interrupted by ${signal} after process cleanup`, "iu"));
      const after = await resolveProcessIdentity(pid);
      assert.equal(
        after.state === "absent" || (after.state === "alive" && after.identity !== exactIdentity.identity),
        true,
        `exact grandchild identity ${pid}/${exactIdentity.identity} survived CLI exit: ${JSON.stringify(after)}`,
      );

      const leaseDirectory = path.join(root, ".agent", "leases");
      const leaseEntries = await readdir(leaseDirectory).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
      assert.deepEqual(leaseEntries.filter((entry) => entry !== ".gitkeep"), []);
      const lockPath = path.join(root, ".agentic", "transactions", "upgrade.lock");
      assert.equal(await exists(path.join(lockPath, "owner")), false);
      const second = await acquireUpgradeMutex(lockPath, { planId: `after-${signal.toLowerCase()}` });
      await second.release();
      assert.equal(await exists(path.join(lockPath, "owner")), false);
    });
  }
});
