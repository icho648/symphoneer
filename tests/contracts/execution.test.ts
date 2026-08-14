import assert from "node:assert/strict";
import test from "node:test";

import {
  AttemptSnapshotSchema,
  CONTRACT_SCHEMA_VERSION,
  TaskSummarySchema,
  WorkspaceReferenceSchema,
} from "@symphoneer/contracts";

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
    labels: ["symphoneer:ready"],
    dispatchable: true,
  };

  assert.equal(TaskSummarySchema.parse(task).id, task.id);
  assert.throws(() => TaskSummarySchema.parse({ ...task, schemaVersion: 1 }));
});

test("Attempt and Workspace boundaries reject conflicting active ownership", () => {
  const workspace = WorkspaceReferenceSchema.parse({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "workspace-13",
    taskId: "task-13",
    path: "/tmp/symphoneer/13",
    repository: "icho648/symphoneer",
    branch: "codex/issue-13",
    gitHead: null,
    worktreeFingerprint: null,
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
    providerSession: { threadId: "thread-13", lastTurnId: "turn-13" },
    startedAt: "2026-08-02T12:00:00.000Z",
    updatedAt: "2026-08-02T12:00:01.000Z",
  };

  const parsed = AttemptSnapshotSchema.parse(attempt);
  assert.equal(parsed.activeTurn?.turnId, "turn-13");
  assert.equal(parsed.controller, "symphoneer");
  assert.equal(
    AttemptSnapshotSchema.parse({ ...attempt, controller: "codex" }).controller,
    "codex",
  );
  assert.throws(() =>
    AttemptSnapshotSchema.parse({ ...attempt, controller: "codex", providerSession: null }),
  );
  assert.throws(() =>
    AttemptSnapshotSchema.parse({
      ...attempt,
      controller: "codex",
      providerSession: { ...attempt.providerSession, provider: "claude-code" },
    }),
  );
  assert.throws(() => AttemptSnapshotSchema.parse({ ...attempt, activeTurn: null }));
  assert.throws(() =>
    AttemptSnapshotSchema.parse({ ...attempt, updatedAt: "2026-08-02T11:59:59.000Z" }),
  );
  assert.throws(() =>
    AttemptSnapshotSchema.parse({
      ...attempt,
      status: "failed",
      activeTurn: null,
      finishedAt: "2026-08-02T12:00:02.000Z",
      failure: "runner failed",
    }),
  );
  assert.throws(() =>
    AttemptSnapshotSchema.parse({
      ...attempt,
      status: "succeeded",
      activeTurn: null,
      finishedAt: "2026-08-02T12:00:02.000Z",
      failure: "unexpected failure",
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
