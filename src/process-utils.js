import { spawn, spawnSync } from "node:child_process";

export function commandExists(command) {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [command], { stdio: "ignore", shell: false });
  return result.status === 0;
}

export function runCommandCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: "pipe",
    encoding: "utf8",
    shell: false,
    timeout: options.timeout,
    maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
  });

  return {
    command,
    args: [...args],
    cwd: options.cwd,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function boundedAppend(current, chunk, maximum) {
  const next = current + chunk;
  return next.length <= maximum ? next : next.slice(next.length - maximum);
}

async function terminateProcessTree(child, graceMs = 2_000) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", shell: false });
    return;
  }
  try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch {} }
  await new Promise((resolve) => setTimeout(resolve, graceMs));
  if (child.exitCode === null) {
    try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} }
  }
}

export function runCommandAsync(command, args, options = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const maximum = options.maxOutputBytes ?? 100_000;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timeout;

    if (options.stdin !== undefined) {
      child.stdin.end(typeof options.stdin === "string" ? options.stdin : JSON.stringify(options.stdin));
    }
    child.stdout.on("data", (chunk) => { stdout = boundedAppend(stdout, chunk.toString("utf8"), maximum); });
    child.stderr.on("data", (chunk) => { stderr = boundedAppend(stderr, chunk.toString("utf8"), maximum); });

    const finish = (status, signal, error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({
        command,
        args: [...args],
        cwd: options.cwd,
        status,
        signal,
        stdout,
        stderr,
        error,
        timedOut,
        durationMs: Date.now() - startedAt,
        pid: child.pid,
      });
    };
    child.on("error", (error) => finish(null, null, error));
    child.on("close", (status, signal) => finish(status, signal));

    if (options.timeout) {
      timeout = setTimeout(async () => {
        timedOut = true;
        await terminateProcessTree(child, options.terminationGraceMs ?? 1_000);
      }, options.timeout);
      timeout.unref?.();
    }
  });
}

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: options.quiet ? "pipe" : "inherit",
    encoding: "utf8",
    shell: false,
    timeout: options.timeout,
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.quiet ? `\n${result.stderr || result.stdout || ""}` : "";
    throw new Error(`${command} ${args.join(" ")} exited with code ${result.status}.${detail}`);
  }

  return result;
}


export function runCommandCaptureAsync(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32" && options.detached !== false,
      windowsHide: true,
    });
    const maxBuffer = options.maxBuffer ?? 4 * 1024 * 1024;
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    let timeout;

    function append(current, chunk) {
      const combined = Buffer.concat([current, Buffer.from(chunk)]);
      return combined.length > maxBuffer ? combined.subarray(combined.length - maxBuffer) : combined;
    }
    child.stdout?.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", (chunk) => { stderr = append(stderr, chunk); });

    if (options.timeout) {
      timeout = setTimeout(() => {
        if (settled) return;
        try {
          if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM");
          else child.kill("SIGTERM");
        } catch {}
        setTimeout(() => {
          if (settled) return;
          try {
            if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
            else child.kill("SIGKILL");
          } catch {}
        }, options.killGraceMs ?? 2_000).unref();
      }, options.timeout);
      timeout.unref?.();
    }

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({ command, args: [...args], cwd: options.cwd, status: null, signal: null, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"), error });
    });
    child.on("close", (status, signal) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({ command, args: [...args], cwd: options.cwd, status, signal, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"), error: undefined });
    });
  });
}
