import path from "node:path";
import { ensureDirectory, readTextIfExists, writeBytesAtomic, writeJson } from "../fs-utils.js";

export function journalPath(root, planId) {
  return path.join(root, ".agentic", "transactions", planId, "journal.jsonl");
}

export function reportPath(root, kind, planId) {
  return path.join(root, ".agentic", "reports", kind, `${planId}.json`);
}

export async function appendJournal(root, planId, event) {
  const file = journalPath(root, planId);
  await ensureDirectory(path.dirname(file));
  const previous = await readJournal(root, planId);
  const record = {
    sequence: previous.length + 1,
    at: new Date().toISOString(),
    ...event,
  };
  const records = [...previous, record].map((item) => JSON.stringify(item)).join("\n");
  await writeBytesAtomic(file, Buffer.from(`${records}\n`, "utf8"));
  return record;
}

function isTornFinalFragment(fragment, error) {
  const trimmed = fragment.trim();
  if (!trimmed.startsWith("{")) return false;
  if (/unterminated|unexpected end/i.test(error.message)) return true;
  if (/[}\]]$/u.test(trimmed)) return false;
  const position = /position (\d+)/i.exec(error.message)?.[1];
  return position !== undefined && Number(position) >= fragment.length - 1;
}

export async function readJournal(root, planId) {
  const raw = await readTextIfExists(journalPath(root, planId));
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const records = [];
  for (const [index, line] of lines.entries()) {
    if (!line) throw new Error(`Invalid transaction journal ${planId} at line ${index + 1}: empty record`);
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      const finalUnterminated = index === lines.length - 1 && !raw.endsWith("\n");
      if (finalUnterminated && isTornFinalFragment(line, error)) break;
      throw new Error(`Invalid transaction journal ${planId} at line ${index + 1}: ${error.message}`);
    }
  }
  for (const [index, record] of records.entries()) {
    if (record.sequence !== index + 1) {
      throw new Error(`Invalid transaction journal ${planId} sequence at line ${index + 1}`);
    }
  }
  return records;
}

function completed(event) {
  return event?.state === "completed"
    || event?.type === "completed"
    || (event?.event === "finish" && event?.status === "completed");
}

export async function assertNotApplied(root, planId) {
  const events = await readJournal(root, planId);
  if (events.some(completed)) throw new Error(`Plan ${planId} has already been applied`);
  return events;
}

/**
 * Write a report. The preferred signature is:
 *   writeReport(root, planId, report, kind?)
 * The legacy four-argument order (root, kind, planId, report) remains accepted
 * so older generated plans can still be applied safely.
 */
export async function writeReport(root, second, third, fourth) {
  let kind;
  let planId;
  let report;
  if (typeof third === "string" && fourth && typeof fourth === "object") {
    kind = second;
    planId = third;
    report = fourth;
  } else {
    planId = second;
    report = third;
    kind = fourth ?? report?.command ?? "plans";
  }
  if (!planId || !report) throw new Error("writeReport requires a plan ID and report object");
  const file = reportPath(root, kind, planId);
  await ensureDirectory(path.dirname(file));
  await writeJson(file, report);
  return file;
}

export const writePlanReport = writeReport;
