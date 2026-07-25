import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { exists } from "../src/fs-utils.js";
import { commandExists, runCommandCapture } from "../src/process-utils.js";

const script = path.resolve("assets", "scripts", "retrofit_tickets.py");

function resolvePython() {
  if (commandExists("uv")) return ["uv", ["run", "python"]];
  if (commandExists("python3")) return ["python3", []];
  if (commandExists("python")) return ["python", []];
  return [null, []];
}

const [python, pythonArgs] = resolvePython();

describe("standalone ticket retrofit script", { skip: python === null }, () => {
  it("runs without site-packages/PyYAML and emits generated YAML artifacts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workspace-template-python-"));
    const track = path.join(root, "docs", "tickets", "push");
    await mkdir(path.join(track, "001-first"), { recursive: true });
    await writeFile(path.join(track, "master-prompt.md"), "# Goal\n\nShip the behavior.\n");
    await writeFile(path.join(track, "001-first", "ticket.md"), "# Ticket 001\n\n## Required Behavior\n\n- Ship it.\n");
    await writeFile(path.join(track, "001-first", "validation.md"), "# Validation\n\nPending.\n");
    assert.notEqual(python, null, "Python runtime must be available via uv or python executable");
    const result = runCommandCapture(python, [
      ...pythonArgs,
      "-B",
      "-S",
      script,
      track,
      "--apply",
    ]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(await exists(path.join(track, "001-first", "contract.yaml")), true);
    assert.equal(await exists(path.join(track, "frontier.json")), true);
    assert.equal(await exists(path.join(track, "wayfinder-frontier.yaml")), true);
  });
});
