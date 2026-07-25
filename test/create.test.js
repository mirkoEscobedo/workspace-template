import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createProject } from "../src/create.js";
import { doctorProject } from "../src/doctor.js";
import { exists } from "../src/fs-utils.js";
import { syncSkills } from "../src/sync.js";

function options(target, project, style = "functional-core", agents = []) {
  return {
    target,
    project,
    style,
    tdd: "pragmatic",
    packageManager: "npm",
    agents,
    install: false,
    git: false,
    bootstrap: false,
    force: false,
    dryRun: false,
    yes: true,
  };
}

describe("createProject", () => {
  it("creates every requested stack with canonical skills and a valid profile", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "workspace-template-"));
    const cases = [
      ["typescript", "functional-core", "package.json"],
      ["javascript", "simple", "package.json"],
      ["react", "clean", "vite.config.ts"],
      ["rust", "functional-core", "Cargo.toml"],
      ["flutter", "clean", "pubspec.yaml"],
    ];

    for (const [project, style, marker] of cases) {
      const target = path.join(temp, `${project}-${style}`);
      await createProject(options(target, project, style));

      assert.equal(await exists(path.join(target, marker)), true);
      assert.equal(await exists(path.join(target, "AGENTS.md")), true);
      assert.equal(
        await exists(path.join(target, ".agentic", "skills", "implementation-style", "SKILL.md")),
        true,
      );

      const report = await doctorProject(target);
      assert.deepEqual(report.errors, [], report.errors.join("\n"));
    }
  });

  it("projects canonical skills and repairs drift", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "workspace-template-sync-"));
    const target = path.join(temp, "demo");
    await createProject(
      options(target, "typescript", "functional-core", [
        "claude",
        "codex",
        "copilot",
        "cursor",
        "opencode",
        "gemini",
      ]),
    );

    assert.match(await readFile(path.join(target, "CLAUDE.md"), "utf8"), /^@AGENTS\.md$/m);
    assert.match(await readFile(path.join(target, "GEMINI.md"), "utf8"), /^@AGENTS\.md$/m);
    assert.equal(
      await exists(path.join(target, ".agents", "skills", "wayfinder", "SKILL.md")),
      true,
    );

    const canonical = path.join(target, ".agentic", "skills", "wayfinder", "SKILL.md");
    const projected = path.join(target, ".claude", "skills", "wayfinder", "SKILL.md");
    await writeFile(canonical, `${await readFile(canonical, "utf8")}\n<!-- local extension -->\n`);

    let report = await doctorProject(target);
    assert.match(report.warnings.join("\n"), /projection drift/);

    await syncSkills(target);
    report = await doctorProject(target);
    assert.equal(report.warnings.some((warning) => warning.includes("projection drift")), false);
    assert.match(await readFile(projected, "utf8"), /local extension/);
  });

  it("preserves a custom CLAUDE.md and reports a missing AGENTS.md import", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "workspace-template-custom-claude-"));
    const target = path.join(temp, "demo");
    await createProject(options(target, "typescript"));

    const custom = "# Custom Claude policy\n\nKeep this file untouched.\n";
    await writeFile(path.join(target, "CLAUDE.md"), custom);
    await syncSkills(target, ["claude"]);

    assert.equal(await readFile(path.join(target, "CLAUDE.md"), "utf8"), custom);
    const report = await doctorProject(target);
    assert.match(report.warnings.join("\n"), /CLAUDE\.md does not import AGENTS\.md/);
  });

  it("supports a dry run without creating the target", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "workspace-template-dry-"));
    const target = path.join(temp, "not-created");
    const result = await createProject({
      ...options(target, "rust"),
      dryRun: true,
    });

    assert.equal(result.dryRun, true);
    assert.equal(await exists(target), false);
    assert.ok(result.plannedFiles.includes("Cargo.toml"));
  });

  it("refuses a non-empty target without --force", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "workspace-template-existing-"));
    await writeFile(path.join(temp, "keep.txt"), "keep\n");

    await assert.rejects(
      createProject(options(temp, "javascript")),
      /Target directory is not empty/,
    );
  });
});
