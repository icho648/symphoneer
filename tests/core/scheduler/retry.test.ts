import assert from "node:assert/strict";
import test from "node:test";

import {
  CoreError,
  CoreScheduler,
  retryDelayMs,
} from "../../../packages/symphony-core/src/scheduler/index.ts";
import { policy, queueFailedAttempt, task, workspace } from "./fixtures.ts";

test("the scheduler owns Attempt sequence, retry provenance, and consecutive backoff", () => {
  const scheduler = new CoreScheduler(policy);
  for (const startReason of ["retry", "continuation"] as const) {
    assert.throws(
      () =>
        scheduler.reserveAttempt({
          task: task("25"),
          attemptId: `attempt-25-${startReason}`,
          sequence: 1,
          startReason,
          workspace: workspace("25", `attempt-25-${startReason}`),
          startedAt: "2026-08-02T12:00:00.000Z",
          idempotencyKey: `fresh-${startReason}-25`,
        }),
      (error) => error instanceof CoreError && error.code === "invalid_transition",
    );
  }
  assert.throws(
    () =>
      scheduler.reserveAttempt({
        task: task("25"),
        attemptId: "attempt-25-2",
        sequence: 2,
        startReason: "dispatch",
        workspace: workspace("25", "attempt-25-2"),
        startedAt: "2026-08-02T12:00:00.000Z",
        idempotencyKey: "dispatch-25-wrong-sequence",
      }),
    (error) => error instanceof CoreError && error.code === "conflict",
  );

  const firstRetry = queueFailedAttempt(scheduler, "25");
  assert.ok(firstRetry);
  assert.throws(
    () =>
      scheduler.transitionRetry({
        taskId: "25",
        refreshedTask: task("25"),
        nowMs: firstRetry.dueAtMs,
        nextAttempt: {
          attemptId: "attempt-25-repeated",
          sequence: 1,
          workspace: workspace("25", "attempt-25-repeated"),
          startedAt: "2026-08-02T12:00:12.000Z",
        },
        idempotencyKey: "retry-25-wrong-sequence",
      }),
    (error) => error instanceof CoreError && error.code === "conflict",
  );
  const reserved = scheduler.transitionRetry({
    taskId: "25",
    refreshedTask: task("25"),
    nowMs: firstRetry.dueAtMs,
    nextAttempt: {
      attemptId: "attempt-25-2",
      sequence: 2,
      workspace: workspace("25", "attempt-25-2"),
      startedAt: "2026-08-02T12:00:12.000Z",
    },
    idempotencyKey: "retry-25-2",
  });
  assert.equal(reserved.kind, "reserved");
  assert.equal(reserved.kind === "reserved" ? reserved.attempt.startReason : null, "retry");
  const secondRetry = scheduler.finishAttempt({
    attemptId: "attempt-25-2",
    status: "failed",
    finishedAt: "2026-08-02T12:00:20.000Z",
    error: "failed again",
    idempotencyKey: "finish-25-2",
  }).retry;
  assert.equal(secondRetry?.attempt, 2);
  assert.equal(secondRetry?.dueAtMs, Date.parse("2026-08-02T12:00:40.000Z"));
});

test("worker outcomes schedule one deterministic retry and release active owners", () => {
  const scheduler = new CoreScheduler(policy);
  scheduler.reserveAttempt({
    task: task("30"),
    attemptId: "attempt-30-1",
    sequence: 1,
    startReason: "dispatch",
    workspace: workspace("30", "attempt-30-1"),
    startedAt: "2026-08-02T12:00:00.000Z",
    idempotencyKey: "dispatch-30-1",
  });
  scheduler.attachTurn({
    attemptId: "attempt-30-1",
    threadId: "thread-30",
    turnId: "turn-30-1",
    updatedAt: "2026-08-02T12:00:01.000Z",
    idempotencyKey: "turn-30-1",
  });
  const beforeInvalidFinish = scheduler.snapshot();
  assert.throws(() =>
    scheduler.finishAttempt({
      attemptId: "attempt-30-1",
      status: "failed",
      finishedAt: "invalid",
      error: "runner failed",
      idempotencyKey: "finish-30-invalid",
    }),
  );
  assert.deepEqual(scheduler.snapshot(), beforeInvalidFinish);
  const finished = scheduler.finishAttempt({
    attemptId: "attempt-30-1",
    status: "failed",
    finishedAt: "2026-08-02T12:00:02.000Z",
    error: "runner failed",
    idempotencyKey: "finish-30-1",
  });

  assert.equal(finished.retry?.dueAtMs, Date.parse("2026-08-02T12:00:02.000Z") + 10_000);
  assert.deepEqual(
    scheduler.finishAttempt({
      attemptId: "attempt-30-1",
      status: "failed",
      finishedAt: "2026-08-02T12:00:02.000Z",
      error: "runner failed",
      idempotencyKey: "finish-30-1",
    }),
    finished,
  );
  assert.equal(scheduler.snapshot().activeAttempts.length, 0);
  assert.equal(scheduler.snapshot().activeTurns.length, 0);
  assert.equal(scheduler.snapshot().workspaceOwners.length, 0);
  assert.equal(scheduler.snapshot().retries.length, 1);
  assert.deepEqual(scheduler.dueRetries(Date.parse("2026-08-02T12:00:11.999Z")), []);
  assert.equal(scheduler.dueRetries(Date.parse("2026-08-02T12:00:12.000Z")).length, 1);
  assert.equal(retryDelayMs("failure", 1, 300_000), 10_000);
  assert.equal(retryDelayMs("failure", 10_000, 300_000), 300_000);
  assert.equal(retryDelayMs("continuation", 99, 300_000), 1_000);

  assert.equal(
    scheduler.transitionRetry({
      taskId: "30",
      refreshedTask: task("30"),
      nowMs: Date.parse("2026-08-02T12:00:12.000Z"),
      nextAttempt: {
        attemptId: "attempt-30-2",
        sequence: 2,
        workspace: workspace("30", "attempt-30-2"),
        startedAt: "2026-08-02T12:00:12.000Z",
      },
      idempotencyKey: "dispatch-30-2",
    }).kind,
    "reserved",
  );
  const beforeInvalidSuccess = scheduler.snapshot();
  assert.throws(() =>
    scheduler.finishAttempt({
      attemptId: "attempt-30-2",
      status: "succeeded",
      finishedAt: "2026-08-02T12:00:20.000Z",
      error: "unexpected failure",
      idempotencyKey: "finish-30-invalid-success",
    }),
  );
  assert.deepEqual(scheduler.snapshot(), beforeInvalidSuccess);
  const continued = scheduler.finishAttempt({
    attemptId: "attempt-30-2",
    status: "succeeded",
    finishedAt: "2026-08-02T12:00:20.000Z",
    idempotencyKey: "finish-30-2",
  });
  assert.equal(continued.retry?.kind, "continuation");
  assert.equal(continued.retry?.dueAtMs, Date.parse("2026-08-02T12:00:21.000Z"));
  assert.deepEqual(
    scheduler.finishAttempt({
      attemptId: "attempt-30-1",
      status: "failed",
      finishedAt: "2026-08-02T12:00:02.000Z",
      error: "runner failed",
      idempotencyKey: "finish-30-1-late",
    }),
    { attempt: finished.attempt, retry: null },
  );
});
