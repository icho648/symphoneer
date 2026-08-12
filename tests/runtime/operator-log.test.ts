import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { OperatorLog } from "../../src/runtime/service/operator-log.ts";

test("operator JSONL stores only redacted project operations", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "symphoneer-operator-log-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, "project-1", "operator.jsonl");
  const log = new OperatorLog(path);

  await log.append({
    occurredAt: "2026-08-12T10:00:00.000Z",
    operation: "worker.open",
    outcome: "failed",
    durationMs: 12,
    taskId: "task-47",
    attemptId: "attempt-47",
    threadId: "019ff583-fedd-7f21-8dde-2338db58f224",
    pid: 123,
    errorKind: "token_abcdefghijklmnopqrstuvwxyz",
  });

  const [record] = (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(record, {
    occurredAt: "2026-08-12T10:00:00.000Z",
    operation: "worker.open",
    outcome: "failed",
    durationMs: 12,
    taskId: "task-47",
    attemptId: "attempt-47",
    threadId: "019ff583-fedd-7f21-8dde-2338db58f224",
    pid: 123,
    errorKind: "[redacted]",
  });
  assert.equal("prompt" in record, false);
});
