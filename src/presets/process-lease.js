import { createHash, randomUUID } from "node:crypto";
import { lstat, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

export const PRESET_WORKER_DEADLINE_MS = 15_000;
export const PRESET_NATIVE_DEADLINE_MS = 5_000;

export function processOperationDigest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function newProcessLease(role, operation, workingDirectory, deadlineMs) {
  const startedAt = new Date();
  return {
    version: 1,
    runId: randomUUID(),
    ticketId: "FBK-001",
    agentId: "preset-apply",
    role,
    pid: null,
    startIdentity: {
      kind: "owner-nonce",
      value: randomUUID(),
      limitation: "Node exposes no dependency-free Windows process creation time; the owning ChildProcess handle and this unguessable launch nonce scope PID reuse checks.",
    },
    operationDigest: processOperationDigest(operation),
    workingDirectory,
    startedAt: startedAt.toISOString(),
    deadlineAt: new Date(startedAt.getTime() + deadlineMs).toISOString(),
    state: "starting",
    finalState: null,
  };
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    if (!["EINVAL", "EISDIR", "EPERM", "EACCES"].includes(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}

async function assertLeaseDirectory(leasePath) {
  const directory = path.dirname(leasePath);
  const details = await lstat(directory);
  if (details.isSymbolicLink() || !details.isDirectory()) {
    throw new Error(`Preset process lease parent must be a real directory: ${directory}`);
  }
  return directory;
}

function content(record) {
  return Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export async function createProcessLease(leasePath, lease, pid) {
  const directory = await assertLeaseDirectory(leasePath);
  const record = { ...lease, pid, state: "running" };
  const handle = await open(leasePath, "wx", 0o600);
  try {
    await handle.writeFile(content(record));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(directory);
  return record;
}

async function verifiedRecord(leasePath, expected) {
  const record = JSON.parse(await readFile(leasePath, "utf8"));
  if (
    record.runId !== expected.runId
    || record.pid !== expected.pid
    || record.startIdentity?.value !== expected.startIdentity.value
  ) {
    throw new Error(`Preset process lease identity changed: ${leasePath}`);
  }
  return record;
}

export async function closeProcessLease(leasePath, expected, finalState) {
  const directory = await assertLeaseDirectory(leasePath);
  const record = {
    ...await verifiedRecord(leasePath, expected),
    state: "closed",
    finalState,
    finishedAt: new Date().toISOString(),
  };
  const handle = await open(leasePath, "r+");
  try {
    await handle.truncate(0);
    await handle.writeFile(content(record));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(directory);
  await unlink(leasePath);
  await syncDirectory(directory);
  return record;
}
