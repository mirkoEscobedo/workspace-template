import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { packageManagerAdapter } from "../src/tooling/package-managers/index.js";

const localDev = [{ name: "demo", version: "file:../demo", kind: "development" }];
const remoteRuntime = [{ name: "demo", version: "1.2.3", kind: "runtime" }];

describe("native package-manager adapters", () => {
  it("renders exact argv and lifecycle policy for npm-family managers", () => {
    const cases = [
      ["npm", ["install", "--save-dev", "--ignore-scripts", "demo@file:../demo"]],
      ["pnpm", ["add", "--save-dev", "--ignore-scripts", "demo@file:../demo"]],
      ["yarn", ["add", "--dev", "--ignore-scripts", "demo@file:../demo"]],
      ["bun", ["add", "--dev", "--ignore-scripts", "demo@file:../demo"]],
    ];
    for (const [name, args] of cases) {
      const planned = packageManagerAdapter(name).planAdd(localDev, { lifecycleScripts: "deny" });
      assert.equal(planned.executable, name);
      assert.deepEqual(planned.args, args);
      assert.equal(planned.network, false);
      assert.equal(planned.lifecycleScripts, false);
    }

    const npmRuntime = packageManagerAdapter("npm").planAdd(remoteRuntime, { lifecycleScripts: "allow" });
    assert.deepEqual(npmRuntime.args, ["install", "--save", "demo@1.2.3"]);
    assert.equal(npmRuntime.network, true);
    assert.equal(npmRuntime.lifecycleScripts, true);
  });

  it("uses Cargo and Flutter/Dart native path arguments without hand-editing lockfiles", () => {
    const cargo = packageManagerAdapter("cargo").planAdd(localDev);
    assert.equal(cargo.executable, "cargo");
    assert.deepEqual(cargo.args, ["add", "--dev", "demo", "--path", "../demo"]);
    assert.equal(cargo.network, false);

    const flutter = packageManagerAdapter("flutter").planAdd(localDev, { project: "flutter" });
    assert.equal(flutter.executable, "flutter");
    assert.deepEqual(flutter.args, ["pub", "add", "--dev", "demo", "--path", "../demo"]);

    const dart = packageManagerAdapter("dart").planAdd(localDev, { project: "dart" });
    assert.equal(dart.executable, "dart");
    assert.deepEqual(dart.args, ["pub", "add", "--dev", "demo", "--path", "../demo"]);
  });

  it("rejects unsupported managers and mixed dependency kinds in one native command", () => {
    assert.throws(() => packageManagerAdapter("unknown"), /Unsupported package manager/);
    assert.throws(
      () => packageManagerAdapter("npm").planAdd([...localDev, ...remoteRuntime]),
      /grouped by dependency kind/,
    );
  });
});
