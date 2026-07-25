import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createProject } from "../src/create.js";
import { doctorProject } from "../src/doctor.js";
import { exists, listFiles, readJson } from "../src/fs-utils.js";

const projects = ["typescript", "javascript", "react", "rust", "flutter"];
const styles = ["simple", "functional-core", "clean"];

function options(target, project, style) {
  return {
    target,
    project,
    style,
    tdd: "pragmatic",
    packageManager: "npm",
    agents: [],
    install: false,
    git: false,
    bootstrap: false,
    force: false,
    dryRun: false,
    yes: true,
  };
}

function assertBalanced(text, file) {
  const pairs = new Map([
    [")", "("],
    ["]", "["],
    ["}", "{"],
  ]);
  const openings = new Set(pairs.values());
  const stack = [];
  for (const character of text) {
    if (openings.has(character)) stack.push(character);
    else if (pairs.has(character)) {
      assert.equal(stack.pop(), pairs.get(character), `${file} has unbalanced delimiters`);
    }
  }
  assert.deepEqual(stack, [], `${file} has unclosed delimiters`);
}

async function validateDartImports(root, packageName) {
  for (const file of await listFiles(path.join(root, "lib"))) {
    if (!file.endsWith(".dart")) continue;
    const content = await readFile(file, "utf8");
    assertBalanced(content, file);
    assert.doesNotMatch(content, /UnimplementedError|TODO/);
    const pattern = new RegExp(`package:${packageName}/([^']+)`, "g");
    for (const match of content.matchAll(pattern)) {
      assert.equal(
        await exists(path.join(root, "lib", match[1])),
        true,
        `${path.relative(root, file)} imports missing lib/${match[1]}`,
      );
    }
  }
}

async function validateRust(root) {
  for (const file of await listFiles(path.join(root, "src"))) {
    if (!file.endsWith(".rs")) continue;
    const content = await readFile(file, "utf8");
    assertBalanced(content, file);
    assert.doesNotMatch(content, /todo!|unimplemented!|TODO/);
  }
}

describe("generated project matrix", () => {
  it("creates all project/style combinations with coherent profiles and templates", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "workspace-template-matrix-"));

    for (const project of projects) {
      for (const style of styles) {
        const target = path.join(temp, `${project}-${style}`);
        await createProject(options(target, project, style));

        const profile = await readJson(path.join(target, ".agentic", "profile.json"));
        assert.equal(profile.project, project);
        assert.equal(profile.style, style);
        assert.equal(await exists(path.join(target, "AGENTS.md")), true);

        const doctor = await doctorProject(target);
        assert.deepEqual(doctor.errors, [], `${project}/${style}: ${doctor.errors.join("\n")}`);

        if (project === "rust") await validateRust(target);
        if (project === "flutter") {
          const pubspec = await readFile(path.join(target, "pubspec.yaml"), "utf8");
          const name = /^name:\s*(\S+)/m.exec(pubspec)?.[1];
          assert.ok(name);
          await validateDartImports(target, name);
        }

        if ((project === "react" || project === "flutter") && style === "clean") {
          const files = (await listFiles(target)).map((file) => path.relative(target, file));
          assert.equal(
            files.some((file) => /repository/i.test(file)),
            false,
            `${project}/clean should not invent a repository without an external boundary`,
          );
        }
      }
    }
  });
});
