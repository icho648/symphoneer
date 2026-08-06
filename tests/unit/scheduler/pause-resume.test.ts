import assert from "node:assert/strict";
import test from "node:test";

import { CoreError, CoreScheduler } from "../../../src/runtime/scheduler/index.ts";
import { policy, queueFailedAttempt, retained, task, workspace } from "../../fixtures/scheduler.ts";

test("pause retains the Provider session and Workspace without scheduling a retry", () => {
  const scheduler = new CoreScheduler(policy);
  const initialWorkspace = workspace("14", "attempt-14");
  scheduler.reserveAttempt({
    task: task("14"),
    attemptId: "attempt-14",
    sequence: 1,
    startReason: "dispatch",
    workspace: initialWorkspace,
    startedAt: "2026-08-03T12:00:00.000Z",
    idempotencyKey: "dispatch-14",
  });
  scheduler.attachTurn({
    attemptId: "attempt-14",
    threadId: "thread-14",
    turnId: "turn-14",
    updatedAt: "2026-08-03T12:00:01.000Z",
    idempotencyKey: "turn-14",
  });

  const paused = scheduler.pauseAttempt({
    attemptId: "attempt-14",
    pausedAt: "2026-08-03T12:00:02.000Z",
    workspace: retained(initialWorkspace),
    idempotencyKey: "pause-14",
  });
  assert.equal(paused.attempt.status, "paused");
  assert.deepEqual(paused.attempt.providerSession, {
    threadId: "thread-14",
    lastTurnId: "turn-14",
  });
  assert.equal(paused.workspace.state, "retained");
  assert.equal(paused.workspace.ownerAttemptId, null);
  assert.deepEqual(scheduler.snapshot().retries, []);
  assert.deepEqual(scheduler.snapshot().activeAttempts, []);
  assert.deepEqual(scheduler.snapshot().claimedTaskIds, ["14"]);
  scheduler.reserveAttempt({
    task: task("15", "urgent"),
    attemptId: "attempt-15",
    sequence: 1,
    startReason: "dispatch",
    workspace: workspace("15", "attempt-15"),
    startedAt: "2026-08-03T12:00:03.000Z",
    idempotencyKey: "dispatch-15",
  });
  assert.throws(
    () =>
      scheduler.attachTurn({
        attemptId: "attempt-15",
        threadId: "thread-14",
        turnId: "turn-15",
        updatedAt: "2026-08-03T12:00:03.000Z",
        idempotencyKey: "turn-15",
      }),
    (error) => error instanceof CoreError && error.code === "conflict",
  );
  assert.throws(
    () =>
      scheduler.attachTurn({
        attemptId: "attempt-14",
        threadId: "thread-14",
        turnId: "turn-without-resume",
        updatedAt: "2026-08-03T12:00:03.000Z",
        idempotencyKey: "turn-without-resume",
      }),
    (error) => error instanceof CoreError && error.code === "invalid_transition",
  );

  const ready = { ...paused.workspace, state: "ready" as const, ownerAttemptId: "attempt-14" };
  const resumed = scheduler.resumePausedAttempt({
    attemptId: "attempt-14",
    task: task("14"),
    workspace: ready,
    resumedAt: "2026-08-03T12:00:04.000Z",
    idempotencyKey: "resume-14",
  });
  assert.equal(resumed.status, "launching_agent");
  assert.deepEqual(resumed.providerSession, paused.attempt.providerSession);
  assert.throws(
    () =>
      scheduler.attachTurn({
        attemptId: "attempt-15",
        threadId: "thread-14",
        turnId: "turn-15-after-resume",
        updatedAt: "2026-08-03T12:00:04.000Z",
        idempotencyKey: "turn-15-after-resume",
      }),
    (error) => error instanceof CoreError && error.code === "conflict",
  );
  assert.throws(
    () =>
      scheduler.attachTurn({
        attemptId: "attempt-14",
        threadId: "foreign-thread",
        turnId: "foreign-turn",
        updatedAt: "2026-08-03T12:00:05.000Z",
        idempotencyKey: "foreign-turn",
      }),
    (error) => error instanceof CoreError && error.code === "conflict",
  );
  const continued = scheduler.attachTurn({
    attemptId: "attempt-14",
    threadId: "thread-14",
    turnId: "turn-14-resumed",
    updatedAt: "2026-08-03T12:00:05.000Z",
    idempotencyKey: "turn-14-resumed",
  });
  assert.deepEqual(continued.providerSession, {
    threadId: "thread-14",
    lastTurnId: "turn-14-resumed",
  });
});

test("terminal reconciliation requests cleanup without releasing a paused Workspace early", () => {
  const scheduler = new CoreScheduler(policy);
  scheduler.reserveAttempt({
    task: task("15"),
    attemptId: "attempt-15",
    sequence: 1,
    startReason: "dispatch",
    workspace: workspace("15", "attempt-15"),
    startedAt: "2026-08-03T12:00:00.000Z",
    idempotencyKey: "dispatch-15",
  });
  scheduler.attachTurn({
    attemptId: "attempt-15",
    threadId: "thread-15",
    turnId: "turn-15",
    updatedAt: "2026-08-03T12:00:01.000Z",
    idempotencyKey: "turn-15",
  });
  scheduler.pauseAttempt({
    attemptId: "attempt-15",
    pausedAt: "2026-08-03T12:00:02.000Z",
    workspace: retained(workspace("15", "attempt-15")),
    idempotencyKey: "pause-15",
  });

  assert.deepEqual(
    scheduler.reconcile({
      tasks: [task("15", "closed")],
      observedAt: "2026-08-03T12:00:03.000Z",
      idempotencyKey: "reconcile-15",
    }),
    {
      keptAttemptIds: [],
      stoppedAttemptIds: ["attempt-15"],
      cleanupWorkspaceIds: ["workspace:15"],
    },
  );
  const snapshot = scheduler.snapshot();
  assert.equal(snapshot.attempts[0]?.status, "canceled_by_reconciliation");
  assert.equal(snapshot.workspaces[0]?.state, "retained");
  assert.deepEqual(snapshot.claimedTaskIds, []);
  scheduler.reserveAttempt({
    task: task("replacement", "urgent"),
    attemptId: "attempt-replacement",
    sequence: 1,
    startReason: "dispatch",
    workspace: workspace("replacement", "attempt-replacement"),
    startedAt: "2026-08-03T12:00:04.000Z",
    idempotencyKey: "dispatch-replacement",
  });
  assert.equal(
    scheduler.attachTurn({
      attemptId: "attempt-replacement",
      threadId: "thread-15",
      turnId: "turn-replacement",
      updatedAt: "2026-08-03T12:00:05.000Z",
      idempotencyKey: "turn-replacement",
    }).activeTurn?.threadId,
    "thread-15",
  );
});

test("pause and resume preserve consecutive failure backoff", () => {
  const scheduler = new CoreScheduler(policy);
  const queued = queueFailedAttempt(scheduler, "16");
  assert.ok(queued);
  const ready = workspace("16", "attempt-16-2");
  assert.equal(
    scheduler.transitionRetry({
      taskId: "16",
      refreshedTask: task("16"),
      nowMs: queued.dueAtMs,
      nextAttempt: {
        attemptId: "attempt-16-2",
        sequence: 2,
        workspace: ready,
        startedAt: "2026-08-02T12:00:12.000Z",
      },
      idempotencyKey: "retry-16",
    }).kind,
    "reserved",
  );
  scheduler.attachTurn({
    attemptId: "attempt-16-2",
    threadId: "thread-16",
    turnId: "turn-16",
    updatedAt: "2026-08-02T12:00:13.000Z",
    idempotencyKey: "turn-16",
  });
  const paused = scheduler.pauseAttempt({
    attemptId: "attempt-16-2",
    pausedAt: "2026-08-02T12:00:14.000Z",
    workspace: retained(ready),
    idempotencyKey: "pause-16",
  });
  scheduler.resumePausedAttempt({
    attemptId: "attempt-16-2",
    task: task("16"),
    workspace: { ...paused.workspace, state: "ready", ownerAttemptId: "attempt-16-2" },
    resumedAt: "2026-08-02T12:00:15.000Z",
    idempotencyKey: "resume-16",
  });
  assert.equal(
    scheduler.finishAttempt({
      attemptId: "attempt-16-2",
      status: "failed",
      finishedAt: "2026-08-02T12:00:16.000Z",
      workspace: retained(ready),
      idempotencyKey: "finish-16-2",
    }).retry?.attempt,
    2,
  );
});
