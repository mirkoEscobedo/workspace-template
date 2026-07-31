import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function successfulResult(command, args, cwd, result = {}) {
  return {
    command,
    args,
    cwd,
    status: 0,
    signal: null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut: false,
    aborted: false,
    durationMs: 1,
    lease: { final: { zeroDescendants: true } },
  };
}

function resolveTool(run, command) {
  const result = process.platform === "win32"
    ? run("powershell.exe", [
        "-NoProfile",
        "-Command",
        `(Get-Command ${command} -CommandType Application).Source`,
      ])
    : run("which", [command]);
  const resolved = result.stdout.trim().split(/\r?\n/u)[0];
  assert.notEqual(resolved, "", `${command} is required for the packed verification smoke`);
  return resolved;
}

export async function runPackedDirtyVerificationSmoke({
  sandbox,
  packageRoot,
  invokeJson,
  run,
}) {
  const root = path.join(sandbox, "dirty-polyglot");
  const pythonRoot = path.join(root, "python-worker");
  const rustRoot = path.join(root, "rust-tool");
  const verificationTools = {
    cargo: resolveTool(run, "cargo"),
    uv: resolveTool(run, "uv"),
  };
  await mkdir(path.join(pythonRoot, "tests"), { recursive: true });
  await mkdir(path.join(rustRoot, "src"), { recursive: true });
  await writeJson(path.join(root, "package.json"), {
    name: "packed-dirty-polyglot",
    private: true,
    type: "module",
    workspaces: ["python-worker", "rust-tool"],
    scripts: { check: "node -e \"process.exit(0)\"" },
  });
  await writeJson(path.join(root, "package-lock.json"), {
    name: "packed-dirty-polyglot",
    lockfileVersion: 3,
  });
  await writeFile(path.join(root, "dirty-input.txt"), "baseline\n", "utf8");
  await writeFile(path.join(root, ".gitignore"), [
    "**/.venv/",
    "**/__pycache__/",
    "**/*.pyc",
    "**/target/",
    "",
  ].join("\n"), "utf8");
  await writeFile(path.join(pythonRoot, ".python-version"), "3.14\n", "utf8");
  await writeFile(path.join(pythonRoot, "pyproject.toml"), [
    "[project]",
    'name = "packed-python-worker"',
    'version = "0.1.0"',
    'requires-python = ">=3.11"',
    "dependencies = []",
    "",
    "[dependency-groups]",
    'dev = ["pytest>=8.0"]',
    "",
  ].join("\n"), "utf8");
  await writeFile(path.join(pythonRoot, "tests", "test_runtime.py"), [
    "import sys",
    "",
    "def test_python_314_branch():",
    "    assert sys.version_info[:2] == (3, 14)",
    "",
  ].join("\n"), "utf8");
  await writeFile(path.join(rustRoot, "Cargo.toml"), [
    "[package]",
    'name = "packed-rust-tool"',
    'version = "0.1.0"',
    'edition = "2024"',
    "",
  ].join("\n"), "utf8");
  await writeFile(path.join(rustRoot, "src", "lib.rs"), [
    "#[cfg(test)]",
    "mod tests {",
    "    #[test]",
    "    fn commit_bound_acceptance_is_enabled() {",
    "        assert!(true);",
    "    }",
    "}",
    "",
  ].join("\n"), "utf8");
  run(verificationTools.uv, ["lock"], { cwd: pythonRoot });
  run(verificationTools.cargo, ["generate-lockfile"], { cwd: rustRoot });

  const adoptionPlanPath = path.join(sandbox, "dirty-polyglot-adoption.json");
  const adoption = invokeJson([
    "adopt", root, "--dry-run", "--json", "--no-tickets",
    "--workspace", "all", "--plan-out", adoptionPlanPath,
  ]);
  assert.equal(adoption.canApply, true, adoption.conflicts?.join("\n"));
  assert.equal(invokeJson([
    "adopt", root, "--apply-plan", adoptionPlanPath, "--json",
  ]).ok, true);

  const workspacePath = path.join(root, ".agentic", "workspace.json");
  const workspace = JSON.parse(await readFile(workspacePath, "utf8"));
  workspace.modules.push({
    id: "packed-python-worker",
    name: "packed-python-worker",
    path: "python-worker",
    project: "python",
    packageManager: "uv",
    manifest: "python-worker/pyproject.toml",
    lockOwner: "python-worker",
    dependencies: [],
    commands: {
      fullSteps: [{ command: "uv", args: ["run", "pytest"] }],
      full: "uv run pytest",
    },
    opaque: false,
  });
  workspace.modules.sort((left, right) => left.id.localeCompare(right.id));
  await writeJson(workspacePath, workspace);
  const pythonCommandsPath = path.join(
    root,
    ".agentic",
    "modules",
    "packed-python-worker",
    "commands.json",
  );
  const pythonProfilePath = path.join(
    root,
    ".agentic",
    "modules",
    "packed-python-worker",
    "profile.json",
  );
  await writeJson(pythonCommandsPath, workspace.modules
    .find((module) => module.id === "packed-python-worker").commands);
  await writeJson(pythonProfilePath, {
    version: 1,
    id: "packed-python-worker",
    path: "python-worker",
    project: "python",
    packageManager: "uv",
    architecture: {
      current: "existing-or-mixed",
      preferredForNewCode: null,
      migrationPolicy: "incremental-protected-vertical-slices",
    },
  });
  const managedPath = path.join(root, ".agentic", "managed-files.json");
  const managed = JSON.parse(await readFile(managedPath, "utf8"));
  for (const [relative, file, mode] of [
    [".agentic/workspace.json", workspacePath, "managed"],
    [".agentic/modules/packed-python-worker/commands.json", pythonCommandsPath, "project-owned-extension"],
    [".agentic/modules/packed-python-worker/profile.json", pythonProfilePath, "project-owned-extension"],
  ]) {
    managed.files[relative] = { mode, hash: sha256(await readFile(file)) };
  }
  await writeJson(managedPath, managed);

  for (const args of [
    ["init"],
    ["config", "user.email", "workspace-template@example.invalid"],
    ["config", "user.name", "Workspace Template Packed Smoke"],
    ["add", "."],
    ["commit", "-m", "packed dirty verification fixture"],
  ]) {
    run("git", args, { cwd: root });
  }
  const sourceHead = run("git", ["rev-parse", "HEAD"], { cwd: root }).stdout.trim();
  await writeFile(path.join(root, "dirty-input.txt"), "sealed dirty input\n", "utf8");

  const upgradePlanPath = path.join(sandbox, "dirty-polyglot-upgrade.json");
  const planning = invokeJson([
    "upgrade", root, "--plan-out", upgradePlanPath,
    "--allow-dirty", "--allow-network", "--json",
  ]);
  assert.equal(planning.status, "planned");
  const plan = JSON.parse(await readFile(upgradePlanPath, "utf8"));
  assert.equal(plan.canApply, true, plan.conflicts?.join("\n"));
  const fullSteps = plan.metadata.verificationCommands.modules
    .flatMap((module) => module.fullSteps);
  assert.equal(fullSteps.some((step) =>
    step.command === "uv" && step.args.includes("pytest")), true);
  assert.equal(fullSteps.some((step) =>
    step.command === "cargo" && step.args[0] === "test"), true);

  const observed = { python314: 0, commitBoundCargo: 0 };
  const runner = async (command, args, options) => {
    const executable = path.basename(command).replace(/\.exe$/iu, "");
    if (executable === "git") {
      const result = run(command, args, { cwd: options.cwd, env: options.env });
      return successfulResult(command, args, options.cwd, result);
    }
    if (executable === "uv" && args.includes("pytest")) {
      assert.equal(await readFile(path.join(options.cwd, ".python-version"), "utf8"), "3.14\n");
      assert.equal(
        await readFile(path.join(options.cwd, "..", "dirty-input.txt"), "utf8"),
        "sealed dirty input\n",
      );
      observed.python314 += 1;
    }
    if (executable === "cargo" && args[0] === "test") {
      const checkpointRoot = path.resolve(options.cwd, "..");
      assert.equal(
        await readFile(path.join(checkpointRoot, "dirty-input.txt"), "utf8"),
        "sealed dirty input\n",
      );
      assert.equal(run("git", ["status", "--porcelain"], {
        cwd: checkpointRoot,
      }).stdout.trim(), "");
      assert.notEqual(
        run("git", ["rev-parse", "HEAD"], { cwd: checkpointRoot }).stdout.trim(),
        sourceHead,
      );
      observed.commitBoundCargo += 1;
    }
    if (executable === "uv" || executable === "cargo") {
      const result = run(verificationTools[executable], args, {
        cwd: options.cwd,
        env: options.env,
      });
      return successfulResult(command, args, options.cwd, result);
    }
    return successfulResult(command, args, options.cwd);
  };
  const { createUpgradeApplyTestHarness } = await import(
    pathToFileURL(path.join(packageRoot, "src", "upgrade", "apply.js")).href
  );
  const report = await createUpgradeApplyTestHarness({ runner }).apply(plan);

  assert.equal(report.ok, true);
  assert.equal(observed.python314 >= 2, true);
  assert.equal(observed.commitBoundCargo >= 2, true);
  assert.match(run("git", ["status", "--short"], { cwd: root }).stdout, /dirty-input\.txt/u);
}
