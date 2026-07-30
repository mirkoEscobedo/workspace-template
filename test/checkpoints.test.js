import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import {
  createCheckpoint,
  createFileBackup,
  disposeBackup,
  restoreFileBackup,
} from "../src/checkpoints/index.js";
import { exists } from "../src/fs-utils.js";
import { temporaryDirectory } from "./helpers.js";

describe("checkpoints and bounded rollback", () => {
  it("creates an isolated copy checkpoint and excludes generated transaction state", async () => {
    const root = await temporaryDirectory("caw-checkpoint-");
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "src", "build"), { recursive: true });
    await mkdir(path.join(root, "tools", "source"), { recursive: true });
    await mkdir(path.join(root, "tools", "ac-dev", "target", "debug"), { recursive: true });
    await mkdir(path.join(root, "packages", "ui", "node_modules", "dependency"), { recursive: true });
    await mkdir(path.join(root, ".agent", "leases"), { recursive: true });
    await mkdir(path.join(root, ".agentic", "transactions", "old"), { recursive: true });
    await writeFile(path.join(root, "src", "value.txt"), "source\n");
    await writeFile(path.join(root, "src", "build", "authority.json"), "{}\n");
    await writeFile(path.join(root, "tools", "ac-dev", "Cargo.toml"), "[package]\nname = \"ac-dev\"\nversion = \"0.1.0\"\n");
    await writeFile(path.join(root, "tools", "source", "Cargo.toml"), "[package]\nname = \"source\"\nversion = \"0.1.0\"\n");
    await writeFile(path.join(root, "tools", "source", "target"), "authoritative file\n");
    await writeFile(path.join(root, "tools", "ac-dev", "target", "debug", "artifact.bin"), "generated\n");
    await writeFile(path.join(root, "packages", "ui", "node_modules", "dependency", "index.js"), "generated\n");
    await writeFile(path.join(root, ".agent", "leases", ".gitkeep"), "");
    await writeFile(path.join(root, ".agent", "leases", "active.json"), "{}\n");
    await writeFile(path.join(root, ".agentic", "transactions", "old", "journal.jsonl"), "{}\n");

    const checkpoint = await createCheckpoint(root, "copy");
    try {
      assert.equal(checkpoint.mode, "copy");
      assert.equal(await readFile(path.join(checkpoint.root, "src", "value.txt"), "utf8"), "source\n");
      assert.equal(await readFile(path.join(checkpoint.root, "src", "build", "authority.json"), "utf8"), "{}\n");
      assert.equal(await readFile(path.join(checkpoint.root, "tools", "source", "target"), "utf8"), "authoritative file\n");
      assert.equal(await exists(path.join(checkpoint.root, "tools", "ac-dev", "target")), false);
      assert.equal(await exists(path.join(checkpoint.root, "packages", "ui", "node_modules")), false);
      assert.equal(await exists(path.join(checkpoint.root, ".agent", "leases", ".gitkeep")), true);
      assert.equal(await exists(path.join(checkpoint.root, ".agent", "leases", "active.json")), false);
      assert.equal(await exists(path.join(checkpoint.root, ".agentic", "transactions")), false);
      await writeFile(path.join(checkpoint.root, "src", "value.txt"), "checkpoint\n");
      assert.equal(await readFile(path.join(root, "src", "value.txt"), "utf8"), "source\n");
    } finally {
      await checkpoint.cleanup();
    }
    assert.equal(await exists(checkpoint.directory), false);
  });

  it("restores files, directories, and paths that were absent before a failed transaction", async () => {
    const root = await temporaryDirectory("caw-backup-");
    await mkdir(path.join(root, "config"), { recursive: true });
    await writeFile(path.join(root, "config", "settings.json"), '{"before":true}\n');
    await mkdir(path.join(root, "tree"), { recursive: true });
    await writeFile(path.join(root, "tree", "owned.txt"), "before\n");

    const backup = await createFileBackup(root, ["config/settings.json", "tree", "created.txt"]);
    try {
      await writeFile(path.join(root, "config", "settings.json"), '{"after":true}\n');
      await writeFile(path.join(root, "tree", "owned.txt"), "after\n");
      await writeFile(path.join(root, "tree", "new.txt"), "new\n");
      await writeFile(path.join(root, "created.txt"), "temporary\n");

      await restoreFileBackup(backup);
      assert.equal(await readFile(path.join(root, "config", "settings.json"), "utf8"), '{"before":true}\n');
      assert.equal(await readFile(path.join(root, "tree", "owned.txt"), "utf8"), "before\n");
      assert.equal(await exists(path.join(root, "tree", "new.txt")), false);
      assert.equal(await exists(path.join(root, "created.txt")), false);
    } finally {
      await disposeBackup(backup);
    }
    assert.equal(await exists(backup.directory), false);
  });

  it("falls back from a Git worktree to an isolated copy outside Git and rejects unknown modes", async () => {
    const root = await temporaryDirectory("caw-checkpoint-fallback-");
    await writeFile(path.join(root, "file.txt"), "value\n");
    const checkpoint = await createCheckpoint(root, "worktree");
    try {
      assert.equal(checkpoint.requestedMode, "worktree");
      assert.equal(checkpoint.mode, "copy");
      assert.match(checkpoint.fallbackReason, /Git repository root|not a Git repository root|git/i);
    } finally {
      await checkpoint.cleanup();
    }
    await assert.rejects(createCheckpoint(root, "none"), /Unsupported checkpoint mode/);
  });
});
