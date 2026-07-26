import { appendFile } from "node:fs/promises";
import path from "node:path";
import { ensureDirectory, readTextIfExists, writeJson } from "../fs-utils.js";

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
  await appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

export async function readJournal(root, planId) {
  const raw = await readTextIfExists(journalPath(root, planId));
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid transaction journal ${planId} at line ${index + 1}: ${error.message}`);
      }
    });
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
