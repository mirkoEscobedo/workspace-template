import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArgs } from "../src/args.js";

describe("parseArgs", () => {
  it("parses a create command and normalizes project aliases", () => {
    const parsed = parseArgs([
      "demo",
      "--project",
      "ts",
      "--style=clean",
      "--tdd",
      "strict",
      "--agents",
      "claude,codex",
      "--no-install",
    ]);

    assert.equal(parsed.command, "create");
    assert.equal(parsed.options.target, "demo");
    assert.equal(parsed.options.project, "typescript");
    assert.equal(parsed.options.style, "clean");
    assert.equal(parsed.options.tdd, "strict");
    assert.deepEqual(parsed.options.agents, ["claude", "codex"]);
    assert.equal(parsed.options.install, false);
    assert.equal(parsed.options.agentsExplicit, true);
  });

  it("uses the project config agent targets for sync unless --agents is explicit", () => {
    const parsed = parseArgs(["sync", "."]);
    assert.equal(parsed.command, "sync");
    assert.equal(parsed.options.target, ".");
    assert.equal(parsed.options.agentsExplicit, false);
  });

  it("parses retrofit as safe adoption with Frontier defaults", () => {
    const parsed = parseArgs([
      "retrofit",
      ".",
      "--agents",
      "frontier",
      "--current-ticket",
      "031",
      "--current-status",
      "repair",
    ]);

    assert.equal(parsed.command, "adopt");
    assert.equal(parsed.options.requestedCommand, "retrofit");
    assert.equal(parsed.options.project, "auto");
    assert.equal(parsed.options.style, "preserve");
    assert.equal(parsed.options.tdd, "preserve");
    assert.deepEqual(parsed.options.agents, ["codex", "opencode"]);
    assert.equal(parsed.options.currentTicket, "031");
    assert.equal(parsed.options.currentStatus, "repair");
  });

  it("keeps preserve and auto values adoption-only", () => {
    assert.throws(() => parseArgs(["create", "demo", "--project", "auto"]), /Unknown project/);
    assert.throws(() => parseArgs(["create", "demo", "--project", "rust", "--style", "preserve"]), /Unknown style/);
    const adopted = parseArgs(["adopt", ".", "--project", "auto", "--style", "preserve", "--tdd", "preserve"]);
    assert.equal(adopted.options.style, "preserve");
  });

  it("rejects unknown create choices", () => {
    assert.throws(
      () => parseArgs(["demo", "--project", "cobol"]),
      /Unknown project/,
    );
    assert.throws(
      () => parseArgs(["demo", "--project", "rust", "--style", "enterprise"]),
      /Unknown style/,
    );
  });

  it("parses the advanced plan/apply command families without broadening authority", () => {
    const tooling = parseArgs([
      "tooling", "plan", ".",
      "--pack", "quality",
      "--dependency", "example@1.2.3",
      "--kind", "development",
      "--module", "web",
      "--scripts", "managed-block",
      "--lifecycle-scripts", "deny",
      "--lockfile", "preserve",
      "--plan-out", ".agentic/plans/tooling.json",
    ]);
    assert.equal(tooling.command, "tooling");
    assert.equal(tooling.subcommand, "plan");
    assert.deepEqual(tooling.options.packs, ["quality"]);
    assert.deepEqual(tooling.options.dependencies, ["example@1.2.3"]);
    assert.deepEqual(tooling.options.modules, ["web"]);
    assert.equal(tooling.options.lockfile, "preserve");
    assert.equal(tooling.options.allowNetwork, undefined);
    assert.equal(tooling.options.lifecycleScripts, "deny");

    const restructure = parseArgs([
      "restructure", "plan", ".",
      "--module", "web",
      "--move", "src/old.ts=>src/new.ts",
      "--organization", "feature-first",
      "--style", "functional-core",
      "--imports", "report",
      "--tests", "co-locate",
      "--generated", "include-explicit",
      "--checkpoint", "patch",
    ]);
    assert.equal(restructure.command, "restructure");
    assert.deepEqual(restructure.options.moves, ["src/old.ts=>src/new.ts"]);
    assert.equal(restructure.options.checkpoint, "patch");
    assert.equal(restructure.options.imports, "report");

    const align = parseArgs([
      "align", "plan", ".",
      "--module", "orders",
      "--use-case", "src/orders/service.ts",
      "--style", "clean",
      "--characterization", "allow-existing",
      "--review", "quality",
      "--executor", "command:codex",
      "--max-files", "8",
      "--max-diff-lines", "400",
      "--allowed-path", "src/orders/**",
      "--nested-plan", ".agentic/plans/tooling.json",
    ]);
    assert.equal(align.command, "align");
    assert.equal(align.options.executor, "command:codex");
    assert.equal(align.options.maxFiles, 8);
    assert.equal(align.options.maxDiffLines, 400);
    assert.deepEqual(align.options.allowedPaths, ["src/orders/**"]);
    assert.deepEqual(align.options.nestedPlans, [{ path: ".agentic/plans/tooling.json" }]);
  });

  it("validates advanced enums and numeric bounds", () => {
    assert.throws(() => parseArgs(["verify", ".", "--scope", "everything"]), /--scope/);
    assert.throws(() => parseArgs(["tooling", "plan", ".", "--kind", "optional"]), /--kind/);
    assert.throws(() => parseArgs(["tooling", "plan", ".", "--lockfile", "rewrite"]), /--lockfile/);
    assert.throws(() => parseArgs(["restructure", "plan", ".", "--checkpoint", "none"]), /--checkpoint/);
    assert.throws(() => parseArgs(["restructure", "plan", ".", "--imports", "regex"]), /--imports/);
    assert.throws(() => parseArgs(["align", "plan", ".", "--review", "rubber-stamp"]), /--review/);
    assert.throws(() => parseArgs(["align", "plan", ".", "--max-files", "0"]), /--max-files/);
  });

});
