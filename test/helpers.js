import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function temporaryDirectory(prefix = "caw-test-") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export function run(root, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    env: { ...process.env, ...options.env },
    timeout: options.timeout ?? 120_000,
  });
  if (options.allowFailure !== true && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}):\n${result.stderr || result.stdout}`);
  }
  return result;
}

export function initializeGit(root) {
  run(root, "git", ["init"]);
  run(root, "git", ["add", "."]);
  run(root, "git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "fixture"]);
}

export async function writeJsonFile(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function createNodeModule(root, relative, definition = {}) {
  const moduleRoot = path.join(root, relative);
  await mkdir(path.join(moduleRoot, "src"), { recursive: true });
  await writeJsonFile(path.join(moduleRoot, "package.json"), {
    name: definition.name ?? path.basename(relative),
    private: true,
    type: "module",
    scripts: definition.scripts ?? { check: "node --test" },
    dependencies: definition.dependencies ?? {},
    devDependencies: definition.devDependencies ?? { typescript: "5.0.0" },
  });
  await writeFile(path.join(moduleRoot, "src", "index.ts"), definition.source ?? "export const value = 1;\n", "utf8");
  await writeJsonFile(path.join(moduleRoot, "tsconfig.json"), { compilerOptions: { strict: true } });
  return moduleRoot;
}
