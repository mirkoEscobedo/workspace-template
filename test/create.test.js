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
      assert.equal(await exists(path.join(target, ".agentic", "skills", "delivery-loop", "SKILL.md")), true);
      assert.equal(await exists(path.join(target, ".agentic", "skills", "review-change", "SKILL.md")), true);

      const config = JSON.parse(await readFile(path.join(target, ".agentic", "config.json"), "utf8"));
      const profile = JSON.parse(await readFile(path.join(target, ".agentic", "profile.json"), "utf8"));
      assert.equal(config.version, 4);
      assert.equal(profile.version, 3);
      assert.equal(config.execution.method, "adaptive");
      assert.equal(config.execution.defaultMode, "direct");
      assert.equal(config.execution.limits.semanticRepairs, 2);
      assert.equal(config.execution.limits.flakyReruns, 1);

      const report = await doctorProject(target);
      assert.deepEqual(report.errors, [], report.errors.join("\n"));
    }
  });

  it("materializes packaged text with Git-portable LF line endings", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "workspace-template-line-endings-"));
    const target = path.join(temp, "demo");
    await createProject(options(target, "typescript", "functional-core", ["codex"]));

    const managedText = [
      ".agentic/skills/verify/SKILL.md",
      ".agentic/skill-baselines/verify/SKILL.md",
      ".agentic/policies/verification.yaml",
      ".codex/agents/implementer.toml",
    ];
    for (const relative of managedText) {
      assert.equal(
        (await readFile(path.join(target, ...relative.split("/")), "utf8")).includes("\r\n"),
        false,
        relative,
      );
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

  it("uses effective --yes rules in dry-run commands", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "workspace-template-drysafe-"));
    const target = path.join(temp, "flutter-app");
    const result = await createProject({
      ...options(target, "flutter"),
      dryRun: true,
      yes: true,
      install: true,
      bootstrap: true,
      git: true,
    });

    assert.equal(result.dryRun, true);
    assert.equal(await exists(target), false);
    assert.equal(result.plannedCommands.includes("git init"), true);
    assert.equal(result.plannedCommands.some((command) => command.startsWith("flutter create")), false);
    assert.equal(result.plannedCommands.some((command) => command.startsWith("flutter")), false);
  });

  it("includes networked create commands in dry-run when --allow-network is set", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "workspace-template-drysafe-net-"));
    const target = path.join(temp, "flutter-app");
    const result = await createProject({
      ...options(target, "flutter"),
      dryRun: true,
      yes: true,
      allowNetwork: true,
      install: true,
      bootstrap: true,
      git: false,
    });

    assert.equal(result.plannedCommands.some((command) => command.startsWith("flutter create --project-name")), true);
    assert.equal(result.plannedCommands.some((command) => command.startsWith("flutter pub get")), true);
  });

  it("suppresses networked create actions in --yes by default", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "workspace-template-safe-mode-"));
    const target = path.join(temp, "flutter-app");
    const result = await createProject({
      ...options(target, "flutter"),
      yes: true,
      install: true,
      bootstrap: true,
      git: false,
    });

    assert.match(result.warnings.join("\n"), /Install was skipped because --yes was used without --allow-network/);
    assert.match(result.warnings.join("\n"), /Flutter bootstrap was skipped because --yes was used without --allow-network/);
    assert.equal(await exists(path.join(target, "pubspec.yaml")), true);
  });

  it("rejects explicit networked create actions without --allow-network", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "workspace-template-safe-mode-blocked-"));
    const target = path.join(temp, "typescript-app");

    await assert.rejects(
      createProject({
        ...options(target, "typescript"),
        yes: true,
        install: true,
        installExplicit: true,
      }),
      /--yes requires --allow-network to run dependency install in create/,
    );
    assert.equal(await exists(target), false);
  });

  it("does not treat --bootstrap as networked for non-Flutter projects", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "workspace-template-safe-mode-noflutter-bootstrap-"));
    const target = path.join(temp, "typescript-app");

    const result = await createProject({
      ...options(target, "typescript"),
      yes: true,
      bootstrap: true,
      bootstrapExplicit: true,
      install: false,
      dryRun: true,
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.warnings.some((warning) => warning.includes("Flutter bootstrap")), false);
    assert.equal(result.plannedCommands.some((command) => command.startsWith("flutter create")), false);
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
