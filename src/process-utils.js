import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const spawnWrapper = fileURLToPath(new URL("./process-spawn-wrapper.js", import.meta.url));

const WINDOWS_JOB_WRAPPER = String.raw`
Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class WorkspaceTemplateJob {
  [StructLayout(LayoutKind.Sequential)]
  private struct BasicLimits {
    public long PerProcessUserTimeLimit;
    public long PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize;
    public UIntPtr MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass;
    public uint SchedulingClass;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct IoCounters {
    public ulong ReadOperationCount;
    public ulong WriteOperationCount;
    public ulong OtherOperationCount;
    public ulong ReadTransferCount;
    public ulong WriteTransferCount;
    public ulong OtherTransferCount;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct ExtendedLimits {
    public BasicLimits BasicLimitInformation;
    public IoCounters IoInfo;
    public UIntPtr ProcessMemoryLimit;
    public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed;
    public UIntPtr PeakJobMemoryUsed;
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, uint length);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool QueryInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length, out uint returnedLength);

  private static IntPtr handle = IntPtr.Zero;

  public static void OwnCurrentProcess() {
    handle = CreateJobObject(IntPtr.Zero, null);
    if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
    var limits = new ExtendedLimits();
    limits.BasicLimitInformation.LimitFlags = 0x00002000;
    if (!SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf(limits))) {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    if (!AssignProcessToJobObject(handle, Process.GetCurrentProcess().Handle)) {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }
  }

  public static long[] MemberProcessIds() {
    var capacity = 64;
    while (capacity <= 4096) {
      var bytes = 8 + (IntPtr.Size * capacity);
      var buffer = Marshal.AllocHGlobal(bytes);
      try {
        uint returned;
        if (!QueryInformationJobObject(handle, 3, buffer, (uint)bytes, out returned)) {
          var error = Marshal.GetLastWin32Error();
          if (error == 122) { capacity *= 2; continue; }
          throw new Win32Exception(error);
        }
        var count = Marshal.ReadInt32(buffer, 4);
        var output = new List<long>(count);
        for (var index = 0; index < count; index++) {
          var offset = 8 + (index * IntPtr.Size);
          output.Add(IntPtr.Size == 8 ? Marshal.ReadInt64(buffer, offset) : Marshal.ReadInt32(buffer, offset));
        }
        return output.ToArray();
      } finally {
        Marshal.FreeHGlobal(buffer);
      }
    }
    throw new InvalidOperationException("Job membership exceeded the bounded evidence capacity");
  }
}
"@
[WorkspaceTemplateJob]::OwnCurrentProcess()
$spec = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:WORKSPACE_TEMPLATE_OWNED_SPEC)) | ConvertFrom-Json
[IO.File]::WriteAllText([string]$spec.barrier.nativeReadyPath, "$PID$([Environment]::NewLine)")
$nodePath = [string]$spec.node
$childArguments = @([string]$spec.wrapper, [string]$spec.encoded)
if ([string]::IsNullOrWhiteSpace($nodePath)) { throw "Owned process specification omitted the Node executable" }
& $nodePath @childArguments
$ownedExitCode = $LASTEXITCODE
$members = @()
foreach ($memberPid in [WorkspaceTemplateJob]::MemberProcessIds()) {
  try {
    $member = Get-Process -Id $memberPid -ErrorAction Stop
    $members += [ordered]@{
      pid = [int]$memberPid
      processStartIdentity = "windows-start-ticks:$($member.StartTime.ToUniversalTime().Ticks)"
    }
  } catch {}
}
$evidence = [ordered]@{ version = 1; measured = $true; membersBeforeClose = $members }
[IO.File]::WriteAllText([string]$spec.barrier.evidencePath, ($evidence | ConvertTo-Json -Depth 5 -Compress))
exit $ownedExitCode
`;

function spawnSpec(command, args, environment = process.env) {
  if (process.platform !== "win32") return { command, args };
  const base = path.basename(command).toLowerCase().replace(/\.(?:cmd|exe)$/u, "");
  const nodeRoot = path.dirname(process.execPath);
  const npmCli = base === "npm"
    ? environment.npm_execpath ?? path.join(nodeRoot, "node_modules", "npm", "bin", "npm-cli.js")
    : base === "npx"
      ? path.join(nodeRoot, "node_modules", "npm", "bin", "npx-cli.js")
      : ["pnpm", "pnpx", "yarn", "yarnpkg"].includes(base)
        ? path.join(nodeRoot, "node_modules", "corepack", "dist", `${base}.js`)
        : null;
  if (!npmCli || !existsSync(npmCli)) return { command, args };
  return { command: process.execPath, args: [npmCli, ...args] };
}

export function commandExists(command) {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [command], { stdio: "ignore", shell: false });
  return result.status === 0;
}

/**
 * Resolve a PID to an operating-system process start identity. Callers must
 * distinguish an absent PID from an identity lookup that failed for a live
 * process; treating the latter as stale could steal another owner's lease.
 */
export async function resolveProcessIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return { state: "absent" };
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code === "ESRCH") return { state: "absent" };
    if (error.code !== "EPERM") return { state: "unknown", reason: error.message };
  }
  if (process.platform === "linux") {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/u);
      const startTicks = fields[19];
      return startTicks
        ? { state: "alive", identity: `linux-start-ticks:${startTicks}` }
        : { state: "unknown", reason: "Linux process stat omitted start time" };
    } catch (error) {
      if (error.code === "ENOENT") return { state: "absent" };
      return { state: "unknown", reason: error.message };
    }
  }
  if (process.platform === "win32") {
    const script = [
      "$ErrorActionPreference='Stop'",
      `$p=Get-Process -Id ${pid}`,
      "[Console]::Out.Write($p.StartTime.ToUniversalTime().Ticks)",
    ].join(";");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    });
    if (result.status === 0 && /^\d+$/u.test(result.stdout.trim())) {
      return { state: "alive", identity: `windows-start-ticks:${result.stdout.trim()}` };
    }
  } else {
    const result = spawnSync("ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8",
      shell: false,
    });
    if (result.status === 0 && result.stdout.trim()) {
      return { state: "alive", identity: `ps-start:${result.stdout.trim()}` };
    }
  }
  try {
    process.kill(pid, 0);
    return { state: "unknown", reason: "Process is live but its start identity could not be resolved" };
  } catch (error) {
    return error.code === "ESRCH"
      ? { state: "absent" }
      : { state: "unknown", reason: error.message };
  }
}

export function runCommandCapture(command, args, options = {}) {
  const environment = { ...process.env, ...options.env };
  const executable = spawnSpec(command, args, environment);
  const result = spawnSync(executable.command, executable.args, {
    cwd: options.cwd,
    env: environment,
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

const SECRET_ASSIGNMENT = /(\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd|pwd|secret|token)\b\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/giu;
const SECRET_FLAG = /(--(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd|pwd|secret|token)(?:=|\s+))(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/giu;
const BEARER_VALUE = /(\b(?:authorization\s*:\s*)?bearer\s+)[A-Za-z0-9._~+/=-]+/giu;

function redactText(value, sensitiveValues = []) {
  let output = String(value ?? "");
  for (const secret of sensitiveValues) {
    if (typeof secret === "string" && secret.length >= 4) output = output.replaceAll(secret, "[REDACTED]");
  }
  return output
    .replace(BEARER_VALUE, "$1[REDACTED]")
    .replace(SECRET_ASSIGNMENT, "$1[REDACTED]")
    .replace(SECRET_FLAG, "$1[REDACTED]");
}

function boundedUtf8(value, maximum) {
  if (!Number.isInteger(maximum) || maximum < 0) return value;
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= maximum) return value;
  let offset = buffer.length - maximum;
  while (offset < buffer.length && (buffer[offset] & 0xc0) === 0x80) offset += 1;
  return buffer.subarray(offset).toString("utf8");
}

export function createStreamingRedactor(options = {}) {
  const maximum = options.maxOutputBytes ?? 100_000;
  const sensitiveValues = (options.sensitiveValues ?? [])
    .filter((value) => typeof value === "string" && value.length >= 4);
  const longestSensitiveBytes = sensitiveValues.reduce(
    (longest, value) => Math.max(longest, Buffer.byteLength(value, "utf8")),
    0,
  );
  const rawMaximum = maximum + longestSensitiveBytes + 256;
  let raw = "";
  let prefixDiscarded = false;

  function redactLeadingPartialToken(value) {
    if (!prefixDiscarded || value.startsWith("[REDACTED]")) return value;
    let knownSuffixLength = 0;
    for (const secret of sensitiveValues) {
      for (let offset = 1; offset < secret.length; offset += 1) {
        const suffix = secret.slice(offset);
        if (suffix.length > knownSuffixLength && raw.startsWith(suffix)) {
          knownSuffixLength = suffix.length;
        }
      }
    }
    if (knownSuffixLength > 0) return `[REDACTED]${value.slice(knownSuffixLength)}`;
    return value.replace(/^[A-Za-z0-9._~+/=-]+/u, "[REDACTED]");
  }

  return {
    push(chunk) {
      raw += String(chunk);
      if (Buffer.byteLength(raw, "utf8") > rawMaximum) {
        raw = boundedUtf8(raw, rawMaximum);
        prefixDiscarded = true;
      }
    },
    value() {
      const redacted = redactLeadingPartialToken(redactText(raw, sensitiveValues));
      return boundedUtf8(redacted, maximum);
    },
  };
}

async function terminateProcessTree(child, graceMs = 2_000, ownsDescendants = false, stopPath) {
  if (!child.pid) return;
  const waitForClose = (milliseconds) => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timer);
      child.removeListener("close", done);
      resolve();
    }
    child.once("close", done);
  });
  if (stopPath) {
    await writeFile(stopPath, "stop\n").catch(() => {});
    const cooperativeGraceMs = process.platform === "win32" && ownsDescendants
      ? Math.max(graceMs, 5_000)
      : graceMs;
    await waitForClose(cooperativeGraceMs);
    if (child.exitCode !== null) return;
  }
  if (process.platform === "win32") {
    try { child.kill("SIGTERM"); } catch {}
    await waitForClose(graceMs);
    if (child.exitCode === null) {
      if (ownsDescendants) {
        try { child.kill("SIGKILL"); } catch {}
      } else {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", shell: false });
      }
    }
    return;
  }
  try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch {} }
  await new Promise((resolve) => setTimeout(resolve, graceMs));
  try { process.kill(-child.pid, "SIGKILL"); } catch { if (child.exitCode === null) try { child.kill("SIGKILL"); } catch {} }
}

async function waitForFile(filePath, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(filePath)) return;
    if (child.exitCode !== null) throw new Error("Native ownership host exited before establishing ownership");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for native process ownership");
}

async function verifyMeasuredMembers(members, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  let result;
  do {
    const verifiedAbsent = [];
    const unknown = [];
    const remaining = [];
    for (const member of members) {
      const current = await resolveProcessIdentity(member.pid);
      if (current.state === "absent"
        || (current.state === "alive" && current.identity !== member.processStartIdentity)) {
        verifiedAbsent.push(member);
      } else if (current.state === "unknown") unknown.push({ ...member, reason: current.reason });
      else remaining.push(member);
    }
    result = { verifiedAbsent, unknown, remaining };
    if (unknown.length === 0 && remaining.length === 0) return result;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  return result;
}

async function measurePosixProcessGroup(groupId) {
  const members = [];
  const unknown = [];
  if (process.platform === "linux") {
    let entries;
    try {
      entries = await readdir("/proc", { withFileTypes: true });
    } catch (error) {
      return { members, unknown: [{ reason: `Could not enumerate /proc: ${error.message}` }] };
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) continue;
      try {
        const stat = await readFile(`/proc/${entry.name}/stat`, "utf8");
        const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/u);
        if (Number(fields[2]) !== groupId) continue;
        const startTicks = fields[19];
        if (startTicks) members.push({
          pid: Number(entry.name),
          processStartIdentity: `linux-start-ticks:${startTicks}`,
        });
        else unknown.push({ pid: Number(entry.name), reason: "Linux process stat omitted start time" });
      } catch (error) {
        if (error.code !== "ENOENT") unknown.push({ pid: Number(entry.name), reason: error.message });
      }
    }
  } else {
    const result = spawnSync("ps", ["-axo", "pid=,pgid=,lstart="], { encoding: "utf8", shell: false });
    if (result.status !== 0) return { members, unknown: [{ reason: "Could not enumerate POSIX process groups" }] };
    for (const line of result.stdout.split(/\r?\n/u)) {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/u);
      if (match && Number(match[2]) === groupId) {
        members.push({ pid: Number(match[1]), processStartIdentity: `ps-start:${match[3].trim()}` });
      }
    }
  }
  return { members, unknown };
}

function liveProcess(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/**
 * Close processes that remain in the owned process group after its root exits.
 * This generic POSIX helper does not claim containment of setsid/detached
 * descendants; upgrade verification rejects POSIX before launch. Windows
 * upgrade verification instead uses the native Job Object path above.
 */
export async function closeOwnedDescendants(rootPid, options = {}) {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return [];
  if (process.platform === "win32") return [];
  let owned = false;
  try {
    process.kill(-rootPid, 0);
    owned = true;
  } catch (error) {
    if (error.code === "EPERM") owned = true;
  }
  if (!owned) return [];
  try { process.kill(-rootPid, "SIGTERM"); } catch {}
  await new Promise((resolve) => setTimeout(resolve, options.graceMs ?? 100));
  try { process.kill(-rootPid, "SIGKILL"); } catch {}
  await new Promise((resolve) => setTimeout(resolve, 50));
  return liveProcess(-rootPid) ? [rootPid] : [];
}

export async function runCommandAsync(command, args, options = {}) {
  if (options.ownDescendants && options.barrierDirectory) {
    await mkdir(options.barrierDirectory, { recursive: true });
  }
  const barrierRoot = options.ownDescendants
    ? await mkdtemp(path.join(options.barrierDirectory ?? os.tmpdir(), "workspace-template-owned-"))
    : undefined;
  const barrier = barrierRoot ? {
    nativeReadyPath: path.join(barrierRoot, "native-ready"),
    startPath: path.join(barrierRoot, "start"),
    stopPath: path.join(barrierRoot, "stop"),
    evidencePath: path.join(barrierRoot, "ownership-evidence.json"),
  } : undefined;
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const maximum = options.maxOutputBytes ?? 100_000;
    const redactValues = options.redactValues ?? [];
    const environment = options.inheritEnv === false ? { ...(options.env ?? {}) } : { ...process.env, ...options.env };
    const executable = spawnSpec(command, args, environment);
    const wrappedSpec = options.ownDescendants
      ? {
          ...executable,
          barrier,
        }
      : undefined;
    const encodedWrappedSpec = wrappedSpec
      ? Buffer.from(JSON.stringify(wrappedSpec)).toString("base64")
      : undefined;
    const encodedOwnedSpec = process.platform === "win32" && options.ownDescendants
      ? Buffer.from(JSON.stringify({
        node: process.execPath,
        wrapper: spawnWrapper,
        encoded: encodedWrappedSpec,
        barrier,
      })).toString("base64")
      : undefined;
    if (encodedOwnedSpec) environment.WORKSPACE_TEMPLATE_OWNED_SPEC = encodedOwnedSpec;
    const owned = process.platform === "win32" && options.ownDescendants
      ? {
          command: "powershell.exe",
          args: ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_JOB_WRAPPER],
        }
      : options.ownDescendants
        ? { command: process.execPath, args: [spawnWrapper, encodedWrappedSpec] }
        : executable;
    const child = spawn(owned.command, owned.args, {
      cwd: options.cwd,
      env: environment,
      shell: false,
      stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const stdout = createStreamingRedactor({ maxOutputBytes: maximum, sensitiveValues: redactValues });
    const stderr = createStreamingRedactor({ maxOutputBytes: maximum, sensitiveValues: redactValues });
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let timeout;
    let abortListener;
    let spawnRegistration = Promise.resolve();
    let ownershipEstablished = false;
    const measuredMemberMap = new Map();
    const measurementUnknown = [];
    const capturePosixMembers = async () => {
      if (!options.ownDescendants || process.platform === "win32") return;
      const measurement = await measurePosixProcessGroup(child.pid);
      for (const member of measurement.members) {
        measuredMemberMap.set(`${member.pid}:${member.processStartIdentity}`, member);
      }
      measurementUnknown.push(...measurement.unknown);
    };
    const terminateOwned = async () => {
      await capturePosixMembers();
      await terminateProcessTree(
        child,
        options.terminationGraceMs ?? 1_000,
        options.ownDescendants,
        barrier?.stopPath,
      );
    };

    if (options.stdin !== undefined) {
      child.stdin.end(typeof options.stdin === "string" ? options.stdin : JSON.stringify(options.stdin));
    }
    child.stdout.on("data", (chunk) => {
      stdout.push(chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk) => {
      stderr.push(chunk.toString("utf8"));
    });

    const finish = async (status, signal, error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (abortListener) options.signal?.removeEventListener("abort", abortListener);
      try {
        await spawnRegistration;
      } catch (registrationError) {
        error = registrationError;
        await terminateOwned();
      }
      await capturePosixMembers();
      const remaining = options.ownDescendants && process.platform !== "win32"
        ? await closeOwnedDescendants(child.pid, { graceMs: options.terminationGraceMs ?? 100 })
        : [];
      let measured = { membersBeforeClose: [], verifiedAbsent: [], unknown: [...measurementUnknown], remaining };
      if (options.ownDescendants && process.platform === "win32") {
        try {
          const nativeEvidence = JSON.parse(await readFile(barrier.evidencePath, "utf8"));
          const verification = await verifyMeasuredMembers(nativeEvidence.membersBeforeClose ?? []);
          measured = { membersBeforeClose: nativeEvidence.membersBeforeClose ?? [], ...verification };
        } catch (evidenceError) {
          measured.unknown.push({ reason: `Windows Job evidence unavailable: ${evidenceError.message}` });
        }
      } else if (options.ownDescendants) {
        const membersBeforeClose = [...measuredMemberMap.values()];
        const verification = await verifyMeasuredMembers(membersBeforeClose);
        measured = {
          membersBeforeClose,
          verifiedAbsent: verification.verifiedAbsent,
          unknown: [...measurementUnknown, ...verification.unknown],
          remaining: verification.remaining.length > 0 ? verification.remaining : remaining,
        };
      }
      if (barrierRoot) {
        await rm(barrierRoot, { recursive: true, force: true }).catch(() => {});
        if (options.barrierDirectory) await rmdir(options.barrierDirectory).catch(() => {});
      }
      resolve({
        command,
        args: args.map((argument) => redactText(argument, redactValues)),
        cwd: options.cwd,
        status,
        signal,
        stdout: stdout.value(),
        stderr: stderr.value(),
        error: error ? new Error(redactText(error.message ?? error, redactValues)) : undefined,
        timedOut,
        aborted,
        durationMs: Date.now() - startedAt,
        pid: child.pid,
        ownership: options.ownDescendants
          ? {
              kind: process.platform === "win32" ? "windows-job-object" : "posix-process-group",
              state: "closed",
              established: ownershipEstablished,
              zeroDescendants: ownershipEstablished
                && measured.remaining.length === 0
                && measured.unknown.length === 0,
              membersBeforeClose: measured.membersBeforeClose,
              verifiedAbsent: measured.verifiedAbsent,
              unknown: measured.unknown,
              remaining: measured.remaining,
            }
          : undefined,
      });
    };
    spawnRegistration = (async () => {
      if (barrier) {
        await waitForFile(barrier.nativeReadyPath, child, options.ownershipTimeoutMs ?? 5_000);
        ownershipEstablished = true;
      }
      if (options.onSpawn) {
        await options.onSpawn({
          pid: child.pid,
          ownershipEstablished,
          platformOwnership: process.platform === "win32"
            ? { kind: "windows-job-object", ownerPid: child.pid, state: "established" }
            : { kind: "posix-process-group", groupId: child.pid, state: "established" },
        });
      }
      await capturePosixMembers();
      if (barrier) await writeFile(barrier.startPath, `${randomUUID()}\n`, { flag: "wx" });
      if (options.timeout && !settled) {
        timeout = setTimeout(async () => {
          timedOut = true;
          await terminateOwned();
        }, options.timeout);
        timeout.unref?.();
      }
    })();
    spawnRegistration.catch(async () => {
      await terminateOwned();
    });
    child.on("error", (error) => { void finish(null, null, error); });
    child.on("close", (status, signal) => { void finish(status, signal); });

    if (options.signal) {
      abortListener = async () => {
        aborted = true;
        await terminateOwned();
      };
      if (options.signal.aborted) void abortListener();
      else options.signal.addEventListener("abort", abortListener, { once: true });
    }
  });
}

export function runCommand(command, args, options = {}) {
  const environment = { ...process.env, ...options.env };
  const executable = spawnSpec(command, args, environment);
  const result = spawnSync(executable.command, executable.args, {
    cwd: options.cwd,
    env: environment,
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
    const environment = { ...process.env, ...options.env };
    const executable = spawnSpec(command, args, environment);
    const child = spawn(executable.command, executable.args, {
      cwd: options.cwd,
      env: environment,
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
