import assert from "node:assert/strict";
import { test } from "node:test";
import type { AttemptSnapshot, TaskSummary } from "@symphoneer/contracts";
import { taskColumn } from "../../../src/web/lib/task-column.ts";

const task = (overrides: Partial<TaskSummary> = {}): TaskSummary =>
  ({
    schemaVersion: 2,
    id: "task-1",
    identifier: "symphoneer-1",
    source: { kind: "github", nativeId: "1", url: "https://github.com/example/repo/issues/1" },
    title: "Task",
    state: "open",
    labels: [],
    dispatchable: true,
    ...overrides,
  }) as TaskSummary;

const attempt = (overrides: Partial<AttemptSnapshot> = {}): AttemptSnapshot =>
  ({
    schemaVersion: 2,
    id: "attempt-1",
    taskId: "task-1",
    sequence: 1,
    startReason: "dispatch",
    status: "succeeded",
    workspaceId: "workspace-1",
    startedAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
    finishedAt: "2026-08-04T00:00:00.000Z",
    ...overrides,
  }) as AttemptSnapshot;

test("task board uses the review label for the waiting-human lane", () => {
  assert.equal(taskColumn(task({ labels: ["symphoneer:review"] }), []), "REVIEW");
  assert.equal(
    taskColumn(task({ labels: ["symphoneer:review"] }), [
      attempt({ status: "preparing_workspace" }),
    ]),
    "RUNNING",
  );
  assert.equal(taskColumn(task(), []), "READY");
  assert.equal(taskColumn(task({ dispatchable: false }), []), "BLOCKED");
});
