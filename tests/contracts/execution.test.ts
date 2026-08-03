import assert from "node:assert/strict";
import test from "node:test";

import {
  AttemptSnapshotSchema,
  CONTRACT_SCHEMA_VERSION,
  TaskSummarySchema,
  WorkspaceReferenceSchema,
} from "../../packages/contracts/src/index.ts";

test("a Task boundary accepts the current schema version and rejects another version", () => {
  const task = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "github:icho648/symphoneer:13",
    identifier: "#13",
    source: {
      kind: "github",
      nativeId: "13",
      url: "https://github.com/icho648/symphoneer/issues/13",
    },
    title: "Build the core",
    state: "open",
    labels: ["symphony:ready"],
    dispatchable: true,
  };

  assert.equal(TaskSummarySchema.parse(task).id, task.id);
  assert.throws(() => TaskSummarySchema.parse({ ...task, schemaVersion: 2 }));
});

test("Attempt and Workspace boundaries reject conflicting active ownership", () => {
  const workspace = WorkspaceReferenceSchema.parse({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "workspace-13",
    taskId: "task-13",
    path: "/tmp/symphoneer/13",
    repository: "icho648/symphoneer",
    branch: "codex/issue-13",
    host: "local",
    state: "ready",
    ownerAttemptId: "attempt-13",
  });
  const attempt = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "attempt-13",
    taskId: "task-13",
    sequence: 1,
    startReason: "dispatch",
    status: "streaming_turn",
    workspaceId: workspace.id,
    activeTurn: { threadId: "thread-13", turnId: "turn-13" },
    startedAt: "2026-08-02T12:00:00.000Z",
    updatedAt: "2026-08-02T12:00:01.000Z",
  };

  assert.equal(AttemptSnapshotSchema.parse(attempt).activeTurn?.turnId, "turn-13");
  assert.throws(() => AttemptSnapshotSchema.parse({ ...attempt, activeTurn: null }));
  assert.throws(() =>
    AttemptSnapshotSchema.parse({
      ...attempt,
      status: "succeeded",
      finishedAt: "2026-08-02T12:00:02.000Z",
    }),
  );
  assert.throws(() =>
    WorkspaceReferenceSchema.parse({
      ...workspace,
      state: "retained",
      ownerAttemptId: "attempt-13",
    }),
  );
});
