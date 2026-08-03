import assert from "node:assert/strict";
import test from "node:test";

import { CoreError, CoreScheduler } from "../../../packages/symphony-core/src/scheduler/index.ts";
import { policy, queueFailedAttempt, task, workspace } from "./fixtures.ts";

test("RetryQueued transitions atomically enforce due time, refresh state, slots, and replay", () => {
  const early = new CoreScheduler(policy);
  const earlyRetry = queueFailedAttempt(early, "50");
  assert.ok(earlyRetry);
  assert.throws(
    () =>
      early.reserveAttempt({
        task: task("50"),
        attemptId: "attempt-50-early",
        sequence: 2,
        startReason: "retry",
        workspace: workspace("50", "attempt-50-early"),
        startedAt: "2026-08-02T12:00:11.999Z",
        idempotencyKey: "bypass-retry-50",
      }),
    (error) => error instanceof CoreError && error.code === "invalid_transition",
  );
  const notDue = early.transitionRetry({
    taskId: "50",
    refreshedTask: task("50"),
    nowMs: earlyRetry.dueAtMs - 1,
    idempotencyKey: "retry-50-early",
  });
  assert.equal(notDue.kind, "not_due");
  assert.deepEqual(
    early.transitionRetry({
      taskId: "50",
      refreshedTask: task("50"),
      nowMs: earlyRetry.dueAtMs - 1,
      idempotencyKey: "retry-50-early",
    }),
    notDue,
  );
  assert.deepEqual(
    early.transitionRetry({
      taskId: "50",
      refreshedTask: { ...task("50"), state: "closed" },
      nowMs: earlyRetry.dueAtMs,
      idempotencyKey: "retry-50-terminal",
    }),
    { kind: "released", reason: "terminal", cleanupWorkspaceIds: ["workspace:50"] },
  );
  assert.equal(early.snapshot().workspaces[0]?.state, "released");
  assert.equal(early.snapshot().claimedTaskIds.length, 0);

  const missing = new CoreScheduler(policy);
  const missingRetry = queueFailedAttempt(missing, "51");
  assert.ok(missingRetry);
  assert.deepEqual(
    missing.transitionRetry({
      taskId: "51",
      refreshedTask: null,
      nowMs: missingRetry.dueAtMs,
      idempotencyKey: "retry-51-missing",
    }),
    { kind: "released", reason: "missing", cleanupWorkspaceIds: [] },
  );
  assert.equal(missing.snapshot().workspaces[0]?.state, "retained");

  const unroutable = new CoreScheduler(policy);
  const unroutableRetry = queueFailedAttempt(unroutable, "52");
  assert.ok(unroutableRetry);
  assert.deepEqual(
    unroutable.transitionRetry({
      taskId: "52",
      refreshedTask: { ...task("52"), labels: ["symphoneer:ready", "symphoneer:review"] },
      nowMs: unroutableRetry.dueAtMs,
      idempotencyKey: "retry-52-unroutable",
    }),
    { kind: "released", reason: "unroutable", cleanupWorkspaceIds: [] },
  );

  const exhausted = new CoreScheduler({
    ...policy,
    maxConcurrentAgents: 1,
    maxConcurrentAgentsByState: { open: 1 },
  });
  const exhaustedRetry = queueFailedAttempt(exhausted, "53");
  assert.ok(exhaustedRetry);
  exhausted.reserveAttempt({
    task: task("54"),
    attemptId: "attempt-54-1",
    sequence: 1,
    startReason: "dispatch",
    workspace: workspace("54", "attempt-54-1"),
    startedAt: "2026-08-02T12:00:03.000Z",
    idempotencyKey: "dispatch-54-1",
  });
  const requeued = exhausted.transitionRetry({
    taskId: "53",
    refreshedTask: task("53"),
    nowMs: exhaustedRetry.dueAtMs,
    nextAttempt: {
      attemptId: "attempt-53-2",
      sequence: 2,
      workspace: workspace("53", "attempt-53-2"),
      startedAt: "2026-08-02T12:00:12.000Z",
    },
    idempotencyKey: "retry-53-exhausted",
  });
  assert.equal(requeued.kind, "requeued");
  assert.equal(requeued.kind === "requeued" ? requeued.retry.attempt : null, 2);
  assert.equal(exhausted.snapshot().retries.length, 1);

  const eligible = new CoreScheduler(policy);
  const eligibleRetry = queueFailedAttempt(eligible, "55");
  assert.ok(eligibleRetry);
  assert.equal(
    eligible.transitionRetry({
      taskId: "55",
      refreshedTask: task("55"),
      nowMs: eligibleRetry.dueAtMs,
      nextAttempt: {
        attemptId: "attempt-55-2",
        sequence: 2,
        workspace: workspace("55", "attempt-55-2"),
        startedAt: "2026-08-02T12:00:12.000Z",
      },
      idempotencyKey: "retry-55",
    }).kind,
    "reserved",
  );
  assert.equal(eligible.snapshot().retries.length, 0);
});
