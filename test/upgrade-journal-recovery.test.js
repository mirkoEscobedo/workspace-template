import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { appendJournal, readJournal } from "../src/index.js";

describe("transaction journal crash recovery", () => {
  it("drops only a torn unterminated final fragment and atomically continues the sequence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workspace-template-journal-tail-"));
    const planId = "journal-tail";
    await appendJournal(root, planId, { event: "start", status: "running" });
    const journal = path.join(root, ".agentic", "transactions", planId, "journal.jsonl");
    await writeFile(journal, `${await readFile(journal, "utf8")}{"sequence":2,"event":"operation-int`);

    assert.deepEqual(
      (await readJournal(root, planId)).map((event) => event.event),
      ["start"],
    );
    const validPrefix = `${JSON.stringify({ sequence: 1, event: "start", status: "running" })}\n`;
    await writeFile(journal, `${validPrefix}{"sequence":2,"message":"x}`);
    assert.deepEqual(
      (await readJournal(root, planId)).map((event) => event.event),
      ["start"],
    );
    const appended = await appendJournal(root, planId, { event: "recovered", status: "restored" });
    assert.equal(appended.sequence, 2);
    assert.equal((await readFile(journal, "utf8")).endsWith("\n"), true);
    assert.deepEqual(
      (await readJournal(root, planId)).map((event) => event.event),
      ["start", "recovered"],
    );
  });

  it("rejects malformed complete lines and non-contiguous sequence numbers", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workspace-template-journal-strict-"));
    const planId = "journal-strict";
    const journal = path.join(root, ".agentic", "transactions", planId, "journal.jsonl");
    await appendJournal(root, planId, { event: "start" });
    await writeFile(journal, `${await readFile(journal, "utf8")}{bad}\n`);
    await assert.rejects(readJournal(root, planId), /line 2/i);
    await writeFile(journal, `${JSON.stringify({ sequence: 1, event: "start" })}\n{"a":1,}`);
    await assert.rejects(readJournal(root, planId), /line 2/i);
    await writeFile(journal, [
      JSON.stringify({ sequence: 1, event: "start" }),
      JSON.stringify({ sequence: 3, event: "operation" }),
      "",
    ].join("\n"));
    await assert.rejects(readJournal(root, planId), /sequence/i);
  });
});
