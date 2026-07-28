#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const spec = JSON.parse(Buffer.from(process.argv[2], "base64").toString("utf8"));
const environment = { ...process.env };
delete environment.WORKSPACE_TEMPLATE_OWNED_SPEC;
const barrier = spec.barrier;
let child;
let stopped = false;

function stop() {
  if (stopped) return;
  stopped = true;
  if (child) {
    try { child.kill("SIGTERM"); } catch {}
  } else {
    process.exitCode = 125;
  }
}

if (barrier?.nativeReadyPath && !existsSync(barrier.nativeReadyPath)) {
  writeFileSync(barrier.nativeReadyPath, `${process.pid}\n`, { flag: "wx" });
}
const stopTimer = barrier?.stopPath
  ? setInterval(() => { if (existsSync(barrier.stopPath)) stop(); }, 20)
  : undefined;
stopTimer?.unref();

function startPayload() {
  if (stopped) {
    process.exit();
    return;
  }
  child = spawn(spec.command, spec.args, {
    env: environment,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });
  child.on("error", (error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 125;
  });
  child.on("close", (status) => {
    if (stopTimer) clearInterval(stopTimer);
    process.exitCode = status ?? 1;
  });
}

if (!barrier?.startPath) startPayload();
else {
  const startTimer = setInterval(() => {
    if (stopped) {
      clearInterval(startTimer);
      process.exit();
    } else if (existsSync(barrier.startPath)) {
      clearInterval(startTimer);
      startPayload();
    }
  }, 10);
}
