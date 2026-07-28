import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { commandExists, runCommandCapture } from "../src/process-utils.js";
import { temporaryDirectory } from "./helpers.js";

function resolvePython() {
  if (commandExists("uv")) return ["uv", ["run", "python"]];
  if (commandExists("python3")) return ["python3", []];
  if (commandExists("python")) return ["python", []];
  return [null, []];
}

const [python, pythonArgs] = resolvePython();

function runPython(args, options) {
  return runCommandCapture(python, [...pythonArgs, ...args], options);
}

describe("dependency-free retrofit scripts", { skip: python === null }, () => {
  it("round-trips generated YAML with Python site packages disabled", async () => {
    const scripts = path.resolve("assets", "scripts");
    const program = [
      "import sys",
      `sys.path.insert(0, ${JSON.stringify(scripts)})`,
      "import _mini_yaml as yaml",
      "value = {'id': 'T-001', 'risk_lane': 3, 'blocked_by': ['T-000'], 'budgets': {'zero_owned_processes_after_run': True}}",
      "raw = yaml.safe_dump(value)",
      "assert yaml.safe_load(raw) == value",
      "print(raw)",
    ].join("; ");
    const result = runPython(["-B", "-S", "-c", program], { cwd: scripts });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /risk_lane: 3/);
  });

  it("validates a ticket pack without PyYAML", async () => {
    const track = await temporaryDirectory("caw-ticket-pack-");
    const ticket = path.join(track, "001-first");
    await mkdir(ticket, { recursive: true });
    await writeFile(path.join(ticket, "contract.yaml"), `
id: T-001
kind: implementation
status: ready
risk_lane: 1
public_outcome: observable behavior
blocked_by: []
write_set:
  - src/example.js
conflict_keys: []
human_gates: []
review_lenses:
  - code-test
preflight_required: true
budgets:
  zero_owned_processes_after_run: true
`.trimStart());
    const script = path.resolve("assets", "scripts", "validate_ticket_pack.py");
    const result = runPython(["-B", "-S", script, track, "--json"], { cwd: path.dirname(script) });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.ready, ["T-001"]);
    assert.deepEqual(report.errors, []);
  });

  it("enforces architecture ratchets without PyYAML", async () => {
    const root = await temporaryDirectory("caw-architecture-budget-");
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "tests", "large.test.js"), Array.from({ length: 12 }, (_, index) => `// ${index}`).join("\n") + "\n");
    const config = path.join(root, "budgets.yaml");
    await writeFile(config, `
file_defaults:
  test_warn_loc: 5
  test_split_plan_loc: 20
  test_block_growth_loc: 30
locked_files:
  tests/large.test.js:
    baseline_loc: 10
    allowed_growth: 0
concentration:
  warn_top_10_share: 1.0
`.trimStart());
    const script = path.resolve("assets", "scripts", "check_architecture_budgets.py");
    const result = runPython(["-B", "-S", script, "--root", root, "--config", config], { cwd: path.dirname(script) });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.violations.some((item) => item.kind === "locked-file-growth"), true);
    assert.equal(report.warnings.some((item) => item.kind === "test-warning"), true);
  });

  it("refuses to overwrite a schema-v2 frontier with the generic writer", async () => {
    const track = await temporaryDirectory("caw-schema-v2-frontier-");
    const ticket = path.join(track, "001-first");
    await mkdir(ticket, { recursive: true });
    await writeFile(path.join(ticket, "contract.yaml"), `
id: T-001
kind: implementation
status: ready
risk_lane: 1
public_outcome: observable behavior
blocked_by: []
write_set:
  - src/example.js
conflict_keys: []
human_gates: []
review_lenses:
  - code-test
preflight_required: true
budgets:
  zero_owned_processes_after_run: true
`.trimStart());
    const frontierPath = path.join(track, "frontier.json");
    const original = `${JSON.stringify({ schema_version: 2, preserved: true }, null, 2)}\n`;
    await writeFile(frontierPath, original);
    const script = path.resolve("assets", "scripts", "validate_ticket_pack.py");
    const result = runPython(["-B", "-S", script, track, "--write-frontier", "--json"], { cwd: path.dirname(script) });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /refusing to overwrite schema-v2 frontier/i);
    assert.equal(await readFile(frontierPath, "utf8"), original);
  });

  it("classifies package-local test directories as tests", async () => {
    const root = await temporaryDirectory("caw-package-test-classification-");
    const packageTest = path.join(root, "packages", "worker", "test");
    await mkdir(packageTest, { recursive: true });
    await writeFile(path.join(packageTest, "runner.js"), "// test fixture\n");
    const config = path.join(root, "budgets.yaml");
    await writeFile(config, "file_defaults:\n  test_warn_loc: 500\nconcentration:\n  warn_top_10_share: 1.0\n");
    const script = path.resolve("assets", "scripts", "check_architecture_budgets.py");
    const result = runPython(["-B", "-S", script, "--root", root, "--config", config], { cwd: path.dirname(script) });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.files["packages/worker/test/runner.js"].kind, "test");
  });

});
