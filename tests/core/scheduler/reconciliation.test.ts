import assert from "node:assert/strict";
import test from "node:test";

import { CoreScheduler } from "../../../packages/symphony-core/src/scheduler/index.ts";
import { policy, queueFailedAttempt, task, workspace } from "./fixtures.ts";

test("reconciliation stops terminal, unroutable, and missing Tasks without duplicate cleanup", () => {
  const scheduler = new CoreScheduler({
    ...policy,
    maxConcurrentAgents: 3,
    maxConcurrentAgentsByState: { open: 3, urgent: 3 },
  });
  for (const id of ["40", "41", "42"]) {
    scheduler.reserveAttempt({
      task: task(id),
      attemptId: `attempt-${id}`,
      sequence: 1,
      startReason: "dispatch",
      workspace: workspace(id, `attempt-${id}`),
      startedAt: "2026-08-02T12:00:00.000Z",
      idempotencyKey: `dispatch-${id}`,
    });
    scheduler.attachTurn({
      attemptId: `attempt-${id}`,
      threadId: `thread-${id}`,
      turnId: `turn-${id}`,
      updatedAt: "2026-08-02T12:00:01.000Z",
      idempotencyKey: `turn-${id}`,
    });
  }

  const result = scheduler.reconcile({
    tasks: [
      { ...task("40"), state: "closed" },
      { ...task("41"), labels: ["symphoneer:ready", "symphoneer:review"] },
    ],
    observedAt: "2026-08-02T12:01:00.000Z",
    idempotencyKey: "reconcile-1",
  });

  assert.deepEqual(result, {
    keptAttemptIds: [],
    stoppedAttemptIds: ["attempt-40", "attempt-41", "attempt-42"],
    cleanupWorkspaceIds: ["workspace:40"],
  });
  assert.deepEqual(
    scheduler.reconcile({
      tasks: [
        { ...task("40"), state: "closed" },
        { ...task("41"), labels: ["symphoneer:ready", "symphoneer:review"] },
      ],
      observedAt: "2026-08-02T12:01:00.000Z",
      idempotencyKey: "reconcile-1",
    }),
    result,
  );
  const snapshot = scheduler.snapshot();
  assert.equal(snapshot.activeAttempts.length, 0);
  assert.equal(snapshot.activeTurns.length, 0);
  assert.equal(snapshot.claimedTaskIds.length, 0);
  assert.deepEqual(
    snapshot.workspaces.map(({ id, state }) => [id, state]),
    [
      ["workspace:40", "released"],
      ["workspace:41", "retained"],
      ["workspace:42", "retained"],
    ],
  );
  assert.ok(snapshot.attempts.every((attempt) => attempt.status === "canceled_by_reconciliation"));

  const retrying = new CoreScheduler(policy);
  for (const id of ["43", "44", "45"]) queueFailedAttempt(retrying, id);
  assert.deepEqual(
    retrying.reconcile({
      tasks: [
        { ...task("43"), state: "closed" },
        { ...task("44"), labels: ["symphoneer:ready", "symphoneer:review"] },
      ],
      observedAt: "2026-08-02T12:01:00.000Z",
      idempotencyKey: "reconcile-retries",
    }),
    { keptAttemptIds: [], stoppedAttemptIds: [], cleanupWorkspaceIds: ["workspace:43"] },
  );
  const retrySnapshot = retrying.snapshot();
  assert.deepEqual(retrySnapshot.retries, []);
  assert.deepEqual(retrySnapshot.claimedTaskIds, []);
  assert.deepEqual(
    retrySnapshot.workspaces.map(({ id, state }) => [id, state]),
    [
      ["workspace:43", "released"],
      ["workspace:44", "retained"],
      ["workspace:45", "retained"],
    ],
  );
});

test("the in-memory idempotency replay window stays bounded", () => {
  const scheduler = new CoreScheduler(policy);
  for (let index = 0; index <= 1_000; index += 1) {
    scheduler.reconcile({
      tasks: [],
      observedAt: "2026-08-02T12:00:00.000Z",
      idempotencyKey: `bounded-replay-${index}`,
    });
  }
  assert.doesNotThrow(() =>
    scheduler.reconcile({
      tasks: [],
      observedAt: "2026-08-02T12:00:01.000Z",
      idempotencyKey: "bounded-replay-0",
    }),
  );
});
