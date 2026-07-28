import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runCommandAsync } from "../src/process-utils.js";
import * as processUtils from "../src/process-utils.js";
import * as workspaceVerify from "../src/workspace/verify.js";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exists } from "../src/fs-utils.js";

describe("bounded command evidence", () => {
  it("redacts credentials and bounds captured UTF-8 output by bytes", async () => {
    const canary = "repair-canary-secret";
    const script = [
      `process.stdout.write("token=${canary}\\n")`,
      'process.stdout.write("🔐".repeat(40))',
      `process.stderr.write("Authorization: Bearer ${canary}\\n")`,
    ].join(";");

    const result = await runCommandAsync(process.execPath, ["-e", script], {
      maxOutputBytes: 48,
    });

    assert.equal(result.status, 0);
    assert.equal(Buffer.byteLength(result.stdout, "utf8") <= 48, true);
    assert.equal(Buffer.byteLength(result.stderr, "utf8") <= 48, true);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(canary, "u"));
    assert.match(`${result.stdout}\n${result.stderr}`, /\[REDACTED\]/u);
  });

  it("redacts a long known secret split across writes before applying the byte bound", async () => {
    const secret = `repair-stream-secret-${"0123456789abcdef".repeat(16)}`;
    const payload = `token=${secret}\n`;
    const parts = payload.match(/.{1,17}/gu);
    const script = `
      const parts = ${JSON.stringify(parts)};
      let index = 0;
      function writeNext() {
        if (index === parts.length) return;
        process.stdout.write(parts[index]);
        index += 1;
        setTimeout(writeNext, 30);
      }
      writeNext();
    `;

    const result = await runCommandAsync(process.execPath, ["-e", script], {
      maxOutputBytes: 64,
      redactValues: [secret],
    });

    assert.equal(result.status, 0);
    assert.equal(Buffer.byteLength(result.stdout, "utf8") <= 64, true);
    assert.match(result.stdout, /\[REDACTED\]/u);
    assert.doesNotMatch(result.stdout, new RegExp(secret.slice(-32), "u"));
    assert.doesNotMatch(result.stdout, new RegExp(secret.slice(-16), "u"));
  });

  it("retains bounded overlap so a split secret cannot leak from the raw suffix", () => {
    const secret = `repair-buffer-secret-${"fedcba9876543210".repeat(16)}`;
    const stream = processUtils.createStreamingRedactor({
      maxOutputBytes: 64,
      sensitiveValues: [secret],
    });
    for (const chunk of `token=${secret}`.match(/.{1,13}/gu)) stream.push(chunk);

    const output = stream.value();
    assert.equal(Buffer.byteLength(output, "utf8") <= 64, true);
    assert.match(output, /\[REDACTED\]/u);
    assert.doesNotMatch(output, new RegExp(secret.slice(-32), "u"));
    assert.doesNotMatch(output, /fedcba9876543210/u);
  });
});

describe("upgrade verification process ownership", () => {
  it("fails closed before payload or lease creation when native ownership is unavailable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workspace-template-runner-posix-"));
    const sentinel = path.join(root, "payload-ran");
    const runner = new workspaceVerify.UpgradeVerificationRunner({
      root,
      runId: "run-posix-capability",
      planId: "plan-posix-capability",
      phaseId: "pre-mutation",
      platform: "linux",
    });

    await assert.rejects(
      () => runner.run(process.execPath, ["-e", `require("node:fs").writeFileSync(${JSON.stringify(sentinel)},"ran")`]),
      /POSIX.*detached-session.*native process owner/iu,
    );
    assert.equal(await exists(sentinel), false);
    assert.equal(await exists(path.join(root, ".agent", "leases")), false);
  });

  it("times out the whole tree, closes its lease, and omits ambient credentials", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workspace-template-runner-"));
    const pidPath = path.join(root, "grandchild.pid");
    const canary = "ambient-canary-credential";
    const previous = process.env.UPGRADE_CANARY_CREDENTIAL;
    process.env.UPGRADE_CANARY_CREDENTIAL = canary;
    const script = [
      'const {spawn}=require("node:child_process")',
      `const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{detached:true,stdio:"ignore"})`,
      `require("node:fs").writeFileSync(${JSON.stringify(pidPath)},String(child.pid))`,
      "child.unref()",
      'process.stdout.write(`credential=${process.env.UPGRADE_CANARY_CREDENTIAL}\\n`)',
      "setInterval(()=>{},1000)",
    ].join(";");
    try {
      const runner = new workspaceVerify.UpgradeVerificationRunner({
        root,
        runId: "run-process-test",
        planId: "plan-process-test",
        phaseId: "post-apply",
        timeoutMs: 2_000,
        terminationGraceMs: 100,
      });
      const result = await runner.run(process.execPath, ["-e", script], {
        cwd: root,
        stepId: "spawn-grandchild",
      });
      assert.match(result.stdout, /credential=/u, JSON.stringify(result));
      const grandchildPid = Number(await readFile(pidPath, "utf8"));

      assert.equal(result.timedOut, true);
      assert.equal(result.lease.final.zeroDescendants, true);
      const ownership = result.lease.final.platformOwnership;
      assert.equal(ownership.membersBeforeClose.length > 0, true);
      assert.equal(ownership.verifiedAbsent.length, ownership.membersBeforeClose.length);
      assert.deepEqual(ownership.unknown, []);
      assert.doesNotMatch(JSON.stringify(result), new RegExp(canary, "u"));
      assert.match(result.stdout, /credential=undefined/u);
      assert.deepEqual(await readdir(path.join(root, ".agent", "leases")), []);
      assert.throws(() => process.kill(grandchildPid, 0), undefined, "grandchild survived timeout");
    } finally {
      if (previous === undefined) delete process.env.UPGRADE_CANARY_CREDENTIAL;
      else process.env.UPGRADE_CANARY_CREDENTIAL = previous;
    }
  });

  it("closes the whole tree on interruption and runner failure", async () => {
    for (const terminal of ["failure", "abort"]) {
      const root = await mkdtemp(path.join(os.tmpdir(), `workspace-template-runner-${terminal}-`));
      const pidPath = path.join(root, "grandchild.pid");
      const controller = new AbortController();
      const script = [
        'const {spawn}=require("node:child_process")',
        'const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{detached:true,stdio:"ignore"})',
        `require("node:fs").writeFileSync(${JSON.stringify(pidPath)},String(child.pid))`,
        "child.unref()",
        terminal === "failure" ? "process.exitCode=7" : "setInterval(()=>{},1000)",
      ].join(";");
      const runner = new workspaceVerify.UpgradeVerificationRunner({
        root,
        runId: `run-${terminal}`,
        planId: `plan-${terminal}`,
        phaseId: "post-apply",
        timeoutMs: 15_000,
        terminationGraceMs: 100,
        signal: controller.signal,
      });
      const running = runner.run(process.execPath, ["-e", script], {
        cwd: root,
        stepId: terminal,
      });
      if (terminal === "abort") {
        let payloadStarted = false;
        for (let attempt = 0; attempt < 500; attempt += 1) {
          try {
            await readFile(pidPath, "utf8");
            payloadStarted = true;
            break;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        }
        assert.equal(payloadStarted, true, "abort payload did not start before the test deadline");
        controller.abort();
      }
      const result = await running;
      const grandchildPid = Number(await readFile(pidPath, "utf8"));
      assert.equal(result.lease.final.zeroDescendants, true);
      assert.equal(terminal === "abort" ? result.aborted : result.status !== 0, true);
      assert.deepEqual(await readdir(path.join(root, ".agent", "leases")), []);
      assert.throws(() => process.kill(grandchildPid, 0));
    }
  });

  it("keeps the payload behind ownership, identity, and durable-lease registration", async () => {
    for (const failure of ["identity", "lease"]) {
      const root = await mkdtemp(path.join(os.tmpdir(), `workspace-template-barrier-${failure}-`));
      const sentinel = path.join(root, "payload-ran");
      const runner = new workspaceVerify.UpgradeVerificationRunner({
        root,
        runId: `run-${failure}`,
        planId: `plan-${failure}`,
        phaseId: "pre-mutation",
        timeoutMs: 5_000,
        terminationGraceMs: 100,
        identityResolver: failure === "identity"
          ? async () => ({ state: "unknown", reason: "injected identity failure" })
          : undefined,
        leaseWriter: failure === "lease"
          ? async () => { throw new Error("injected lease failure"); }
          : undefined,
      });

      await assert.rejects(
        () => runner.run(process.execPath, ["-e", `require("node:fs").writeFileSync(${JSON.stringify(sentinel)},"ran")`], {
          cwd: root,
          stepId: failure,
        }),
        new RegExp(`injected ${failure} failure`, "iu"),
      );
      assert.equal(await exists(sentinel), false);
      assert.deepEqual(await readdir(path.join(root, ".agent", "leases")), []);
    }
  });
});
