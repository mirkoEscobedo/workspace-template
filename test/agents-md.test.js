import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateManagedAgentsBlock } from "../src/agents-md.js";

describe("managed AGENTS commands", () => {
  it("retains ordinary stack commands when full verification is overridden", () => {
    const block = generateManagedAgentsBlock({
      project: "flutter",
      style: "preserve",
      tdd: "preserve",
      packageManager: "flutter",
      commands: {
        full: "flutter analyze",
        fullSteps: [{ command: "flutter", args: ["analyze"] }],
      },
    });

    assert.match(block, /Run locally \| `flutter run`/);
    assert.match(block, /Run one focused test \| `flutter test path\/to\/test\.dart`/);
    assert.match(block, /Run tests \| `flutter test`/);
    assert.match(block, /Format \| `dart format \.`/);
    assert.match(block, /Full verification \| `flutter analyze`/);
  });
});

