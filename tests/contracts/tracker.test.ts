import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTRACT_SCHEMA_VERSION,
  type TaskSummary,
  TaskSummarySchema,
} from "@symphoneer/contracts";
import type { Tracker } from "../../src/runtime/tracker/tracker.ts";
import { TrackerError } from "../../src/runtime/tracker/tracker.ts";
import { FakeTracker } from "../fixtures/fake-tracker.ts";

const task: TaskSummary = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  id: "github:icho648/symphoneer:14",
  identifier: "#14",
  source: {
    kind: "github",
    nativeId: "1014",
    url: "https://github.com/icho648/symphoneer/issues/14",
  },
  title: "Connect execution boundaries",
  state: "open",
  labels: ["symphoneer:ready"],
  dispatchable: true,
  workflowStatus: "backlog",
  blocked: null,
  createdAt: "2026-08-03T12:00:00Z",
  updatedAt: "2026-08-03T12:00:01Z",
};

test("the deterministic Fake satisfies the Tracker public contract", async () => {
  const tracker: Tracker = new FakeTracker([{ nativeId: "14", task, versionToken: '"v1"' }]);

  const snapshot = await tracker.getTask("14");
  assert.equal(snapshot.task.id, task.id);
  assert.equal(snapshot.versionToken, '"v1"');
  assert.equal(snapshot.task.dispatchable, true);

  await assert.rejects(
    tracker.getTask("14", { expectedUpdatedAt: "2026-08-03T12:00:00Z" }),
    (error) => error instanceof TrackerError && error.code === "tracker_conflict",
  );
  await assert.rejects(
    tracker.getTask("99"),
    (error) => error instanceof TrackerError && error.code === "not_found",
  );
});

test("TaskSummary defaults the local WorkflowStatus for legacy Tracker payloads", () => {
  const parsed = TaskSummarySchema.parse({
    ...task,
    workflowStatus: undefined,
    blocked: undefined,
  });

  assert.equal(parsed.workflowStatus, "backlog");
  assert.equal(parsed.blocked, null);
  assert.equal(parsed.state, "open");
});

test("TaskSummary normalizes the retired Ready WorkflowStatus to Backlog", () => {
  assert.equal(
    TaskSummarySchema.parse({ ...task, workflowStatus: "ready" }).workflowStatus,
    "backlog",
  );
});
