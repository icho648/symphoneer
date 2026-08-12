import assert from "node:assert/strict";
import test from "node:test";

import { CoreScheduler } from "../../src/runtime/scheduler/index.ts";
import { policy, queueFailedAttempt, retained, task, workspace } from "./fixtures.ts";

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

  const beforeInvalidReconciliation = scheduler.snapshot();
  assert.throws(() =>
    scheduler.reconcile({
      tasks: [
        { ...task("40"), state: "urgent" },
        { ...task("41"), state: "closed" },
      ],
      observedAt: "invalid",
      idempotencyKey: "reconcile-invalid",
    }),
  );
  assert.deepEqual(scheduler.snapshot(), beforeInvalidReconciliation);

  const atomic = new CoreScheduler({
    ...policy,
    maxConcurrentAgents: 2,
    maxConcurrentAgentsByState: { open: 1, urgent: 1 },
  });
  for (const [id, state] of [
    ["60", "open"],
    ["61", "urgent"],
  ] as const) {
    atomic.reserveAttempt({
      task: task(id, state),
      attemptId: `attempt-${id}`,
      sequence: 1,
      startReason: "dispatch",
      workspace: workspace(id, `attempt-${id}`),
      startedAt: "2026-08-02T12:00:00.000Z",
      idempotencyKey: `dispatch-${id}`,
    });
  }
  assert.throws(() =>
    atomic.reconcile({
      tasks: [task("60", "urgent"), task("61", "closed")],
      observedAt: "2026-08-02T11:59:59.000Z",
      idempotencyKey: "reconcile-atomic-invalid",
    }),
  );
  atomic.finishAttempt({
    attemptId: "attempt-61",
    status: "canceled_by_reconciliation",
    finishedAt: "2026-08-02T12:00:02.000Z",
    workspace: retained(workspace("61", "attempt-61")),
    idempotencyKey: "finish-61",
  });
  assert.equal(
    atomic.reserveAttempt({
      task: task("62", "urgent"),
      attemptId: "attempt-62",
      sequence: 1,
      startReason: "dispatch",
      workspace: workspace("62", "attempt-62"),
      startedAt: "2026-08-02T12:00:03.000Z",
      idempotencyKey: "dispatch-62",
    }).kind,
    "reserved",
  );

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
      ["workspace:40", "retained"],
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
    {
      keptAttemptIds: [],
      stoppedAttemptIds: [],
      cleanupWorkspaceIds: ["workspace:43"],
    },
  );
  const retrySnapshot = retrying.snapshot();
  assert.deepEqual(retrySnapshot.retries, []);
  assert.deepEqual(retrySnapshot.claimedTaskIds, []);
  assert.deepEqual(
    retrySnapshot.workspaces.map(({ id, state }) => [id, state]),
    [
      ["workspace:43", "retained"],
      ["workspace:44", "retained"],
      ["workspace:45", "retained"],
    ],
  );
});

test("terminal reconciliation accepts a later retained Workspace observation", () => {
  const scheduler = new CoreScheduler(policy);
  const owned = workspace("46", "attempt-46");
  scheduler.reserveAttempt({
    task: task("46"),
    attemptId: "attempt-46",
    sequence: 1,
    startReason: "dispatch",
    workspace: owned,
    startedAt: "2026-08-02T12:00:00.000Z",
    idempotencyKey: "dispatch-46",
  });

  scheduler.reconcile({
    tasks: [{ ...task("46"), state: "closed" }],
    observedAt: "2026-08-02T12:00:01.000Z",
    idempotencyKey: "reconcile-46",
  });
  const observed = {
    ...retained(owned),
    gitHead: "b".repeat(40),
    worktreeFingerprint: "b".repeat(64),
  };
  scheduler.finishAttempt({
    attemptId: "attempt-46",
    status: "canceled_by_reconciliation",
    finishedAt: "2026-08-02T12:00:02.000Z",
    workspace: observed,
    idempotencyKey: "finish-46",
  });

  assert.equal(scheduler.snapshot().workspaces[0]?.worktreeFingerprint, "b".repeat(64));
});

test("reconciliation keeps a Codex-controlled paused Attempt locked", () => {
  const setup = new CoreScheduler(policy);
  const owned = workspace("47", "attempt-47");
  setup.reserveAttempt({
    task: task("47"),
    attemptId: "attempt-47",
    sequence: 1,
    startReason: "dispatch",
    workspace: owned,
    startedAt: "2026-08-02T12:00:00.000Z",
    idempotencyKey: "dispatch-47",
  });
  setup.attachTurn({
    attemptId: "attempt-47",
    threadId: "thread-47",
    turnId: "turn-47",
    updatedAt: "2026-08-02T12:00:01.000Z",
    idempotencyKey: "turn-47",
  });
  const paused = setup.pauseAttempt({
    attemptId: "attempt-47",
    pausedAt: "2026-08-02T12:00:02.000Z",
    workspace: retained(owned),
    idempotencyKey: "pause-47",
  });
  const scheduler = new CoreScheduler(policy);
  scheduler.restore({
    tasks: [task("47")],
    attempts: [{ ...paused.attempt, controller: "codex" }],
    workspaces: [paused.workspace],
  });

  assert.deepEqual(
    scheduler.reconcile({
      tasks: [{ ...task("47"), state: "closed" }],
      observedAt: "2026-08-02T12:01:00.000Z",
      idempotencyKey: "reconcile-codex-47",
    }),
    { keptAttemptIds: ["attempt-47"], stoppedAttemptIds: [], cleanupWorkspaceIds: [] },
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
