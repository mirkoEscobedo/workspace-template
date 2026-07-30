import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, it } from "node:test";
import { isGeneratedCachePath } from "../src/generated-paths.js";
import { readTree } from "../src/workspace-artifacts.js";
import { temporaryDirectory } from "./helpers.js";

const execFileAsync = promisify(execFile);

describe("generated cache exclusion", () => {
  it("omits Python bytecode and cache directories from managed artifact enumeration", async () => {
    const root = await temporaryDirectory("workspace-template-cache-assets-");
    await mkdir(path.join(root, "scripts", "__pycache__"), { recursive: true });
    await writeFile(path.join(root, "scripts", "source.py"), "print('source')\n");
    await writeFile(path.join(root, "scripts", "__pycache__", "source.cpython-314.pyc"), "bytecode\n");
    await writeFile(path.join(root, "scripts", "stale.pyo"), "optimized bytecode\n");

    const artifacts = await readTree(root, ".agentic");

    assert.deepEqual(artifacts.map((artifact) => artifact.path), [".agentic/scripts/source.py"]);
  });

  it("keeps generated Python caches out of the packed distribution", async () => {
    const nestedIgnore = await readFile(path.resolve("assets", ".npmignore"), "utf8");
    assert.match(nestedIgnore, /\*\*\/__pycache__\/\*\*/u);
    assert.match(nestedIgnore, /\*\*\/\*\.pyc/u);
    const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    const cache = await temporaryDirectory("workspace-template-npm-cache-");
    const { stdout } = await execFileAsync(process.execPath, [npmCli, "pack", "--dry-run", "--json"], {
      cwd: path.resolve(),
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: cache },
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const [pack] = JSON.parse(stdout);
    const cacheFiles = pack.files.map((file) => file.path).filter(isGeneratedCachePath);

    assert.deepEqual(cacheFiles, []);
  });
});
