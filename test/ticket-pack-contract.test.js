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
const validator = path.resolve("assets", "scripts", "validate_ticket_pack.py");

function runValidator(track) {
  return runCommandCapture(
    python,
    [...pythonArgs, "-B", "-S", validator, track, "--json"],
    { cwd: path.dirname(validator) },
  );
}

function contractYaml({
  kind = "implementation",
  executionPolicy = "implement-and-review",
  includePublicOutcome = true,
  publicOutcome = "observable behavior",
  verification = "",
} = {}) {
  return `
id: T-001
kind: ${kind}
execution_policy: ${executionPolicy}
status: ready
risk_lane: 1
${includePublicOutcome ? `public_outcome: ${publicOutcome}` : ""}
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
${verification}`.trimStart();
}

async function validateContract(options) {
  const track = await temporaryDirectory("workspace-ticket-contract-");
  const ticket = path.join(track, "001-first");
  await mkdir(ticket, { recursive: true });
  await writeFile(path.join(ticket, "contract.yaml"), contractYaml(options));
  return runValidator(track);
}

describe("executable ticket verification contract", { skip: python === null }, () => {
  it("rejects missing or vacuous exact verification commands with a stable diagnostic", async () => {
    const cases = [
      ["missing verification", ""],
      ["missing commands", "verification:\n  repair_levels: [L0]\n  landing_levels: [L0]\n"],
      ["empty commands", "verification:\n  commands: []\n"],
      ["blank command", "verification:\n  commands:\n    - \"   \"\n"],
    ];

    for (const [name, verification] of cases) {
      const result = await validateContract({ verification });
      assert.equal(result.status, 1, `${name}\n${result.stderr || result.stdout}`);
      const report = JSON.parse(result.stdout);
      assert.deepEqual(
        report.errors,
        ["T-001: executable ticket verification.commands must contain at least one nonblank command"],
        name,
      );
    }
  });

  it("accepts a concrete executable command and preserves non-executable records", async () => {
    const executable = await validateContract({
      verification: "verification:\n  commands:\n    - npm run test -- test/example.test.js\n",
    });
    assert.equal(executable.status, 0, executable.stderr || executable.stdout);

    const exemptions = [
      ["tracker", { kind: "tracker" }],
      ["custom aggregate", { kind: "aggregate-only" }],
      ["historical record", { kind: "historical" }],
      ["aggregate-only policy", { executionPolicy: "aggregate-only" }],
      ["historical-only policy", { kind: "imported", executionPolicy: "historical-only" }],
    ];
    for (const [name, options] of exemptions) {
      const result = await validateContract(options);
      assert.equal(result.status, 0, `${name}\n${result.stderr || result.stdout}`);
      const report = JSON.parse(result.stdout);
      assert.deepEqual(report.errors, [], name);
    }
  });

  it("requires exact exemption markers instead of normalizing padded values", async () => {
    const cases = [
      ["padded tracker kind", { kind: '" tracker "' }],
      ["padded aggregate kind", { kind: '" aggregate-only "' }],
      ["padded aggregate policy", { executionPolicy: '" aggregate-only "' }],
      ["padded historical policy", { kind: "imported", executionPolicy: '" historical-only "' }],
    ];

    for (const [name, options] of cases) {
      const result = await validateContract(options);
      assert.equal(result.status, 1, `${name}\n${result.stderr || result.stdout}`);
      const report = JSON.parse(result.stdout);
      assert.deepEqual(
        report.errors,
        ["T-001: executable ticket verification.commands must contain at least one nonblank command"],
        name,
      );
    }
  });

  it("treats non-string discriminator values as executable without crashing", async () => {
    const cases = [
      ["list kind", { kind: "[]" }],
      ["object kind", { kind: "{}" }],
      ["list execution policy", { executionPolicy: "[]" }],
      ["object execution policy", { executionPolicy: "{}" }],
    ];

    for (const [name, options] of cases) {
      const result = await validateContract(options);
      assert.equal(result.status, 1, `${name}\n${result.stderr || result.stdout}`);
      const report = JSON.parse(result.stdout);
      assert.deepEqual(
        report.errors,
        ["T-001: executable ticket verification.commands must contain at least one nonblank command"],
        name,
      );
    }
  });

  it("requires public_outcome to be a nonblank string", async () => {
    const verification = "verification:\n  commands:\n    - npm test\n";
    const cases = [
      ["missing", { includePublicOutcome: false, verification }],
      ["whitespace", { publicOutcome: '"   "', verification }],
      ["null", { publicOutcome: "null", verification }],
      ["list", { publicOutcome: "[]", verification }],
      ["object", { publicOutcome: "{}", verification }],
    ];

    for (const [name, options] of cases) {
      const result = await validateContract(options);
      assert.equal(result.status, 1, `${name}\n${result.stderr || result.stdout}`);
      const report = JSON.parse(result.stdout);
      assert.deepEqual(
        report.errors,
        ["T-001: public_outcome must be a nonblank string"],
        name,
      );
    }
  });

  it("keeps the schema, template, guidance, and mirrored validator aligned", async () => {
    const [
      schemaText,
      template,
      skill,
      reference,
      dependencyFreeValidator,
      skillValidator,
    ] = await Promise.all([
      readFile("assets/skills/compile-master-plan/schemas/ticket-contract.schema.json", "utf8"),
      readFile("assets/skills/compile-master-plan/assets/contract-template.yaml", "utf8"),
      readFile("assets/skills/compile-master-plan/SKILL.md", "utf8"),
      readFile("assets/skills/compile-master-plan/references/ticket-contract.md", "utf8"),
      readFile("assets/scripts/validate_ticket_pack.py", "utf8"),
      readFile("assets/skills/compile-master-plan/scripts/validate_ticket_pack.py", "utf8"),
    ]);
    const schema = JSON.parse(schemaText);
    const executableRule = schema.allOf?.find(
      (rule) => rule.then?.required?.includes("verification"),
    );

    assert.ok(executableRule, "schema must conditionally require executable verification");
    assert.deepEqual(
      executableRule.then.properties.verification.required,
      ["commands"],
    );
    const commands = executableRule.then.properties.verification.properties.commands;
    assert.equal(commands.minItems, 1);
    assert.equal(commands.items.pattern, "\\S");
    assert.equal(schema.properties.public_outcome.pattern, "\\S");

    assert.doesNotMatch(template, /commands:\s*\[\]/);
    assert.match(template, /commands:\s*\r?\n\s+-\s+\S/);
    assert.match(skill, /executable ticket.*nonblank exact command/is);
    assert.match(skill, /exemption markers.*exact string/is);
    assert.match(reference, /executable ticket.*nonblank exact command/is);
    assert.match(reference, /public_outcome.*nonblank string/is);

    const sharedBody = (source) => source.slice(source.indexOf("DONE ="));
    assert.equal(sharedBody(dependencyFreeValidator), sharedBody(skillValidator));
  });
});
