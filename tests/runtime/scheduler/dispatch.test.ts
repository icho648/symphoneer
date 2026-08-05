import assert from "node:assert/strict";
import test from "node:test";

import { CoreScheduler, sortTasksForDispatch } from "../../../src/runtime/scheduler/index.ts";
import { policy, task, workspace } from "./fixtures.ts";

test("dispatch order is priority, oldest creation time, then identifier", () => {
  const tasks = [
    { ...task("c"), priority: null, createdAt: "2026-08-01T00:00:00.000Z" },
    { ...task("b"), priority: 2, createdAt: "2026-08-02T00:00:00.000Z" },
    { ...task("a"), priority: 2, createdAt: "2026-08-01T00:00:00.000Z" },
    { ...task("d"), priority: 9, createdAt: "2026-07-01T00:00:00.000Z" },
    { ...task("e"), priority: 1, createdAt: null },
  ];

  assert.deepEqual(
    sortTasksForDispatch(tasks).map(({ id }) => id),
    ["e", "a", "b", "d", "c"],
  );
  assert.deepEqual(
    tasks.map(({ id }) => id),
    ["c", "b", "a", "d", "e"],
  );
});

test("one scheduler authority prevents duplicate task, workspace, and concurrency ownership", () => {
  const scheduler = new CoreScheduler(policy);
  const first = scheduler.reserveAttempt({
    task: task("13"),
    attemptId: "attempt-13",
    sequence: 1,
    startReason: "dispatch",
    workspace: workspace("13", "attempt-13"),
    startedAt: "2026-08-02T12:00:00.000Z",
    idempotencyKey: "dispatch-13",
  });

  assert.equal(first.kind, "reserved");
  assert.deepEqual(
    scheduler.reserveAttempt({
      task: task("13"),
      attemptId: "attempt-13",
      sequence: 1,
      startReason: "dispatch",
      workspace: workspace("13", "attempt-13"),
      startedAt: "2026-08-02T12:00:00.000Z",
      idempotencyKey: "dispatch-13",
    }),
    first,
  );
  assert.deepEqual(
    scheduler.reserveAttempt({
      task: task("13"),
      attemptId: "attempt-13-duplicate",
      sequence: 2,
      startReason: "dispatch",
      workspace: workspace("13", "attempt-13-duplicate"),
      startedAt: "2026-08-02T12:00:01.000Z",
      idempotencyKey: "dispatch-13-again",
    }),
    { kind: "rejected", reasons: ["already_claimed"] },
  );
  assert.deepEqual(
    scheduler.reserveAttempt({
      task: task("14"),
      attemptId: "attempt-14",
      sequence: 1,
      startReason: "dispatch",
      workspace: workspace("14", "attempt-14"),
      startedAt: "2026-08-02T12:00:01.000Z",
      idempotencyKey: "dispatch-14",
    }),
    { kind: "rejected", reasons: ["state_concurrency_exhausted"] },
  );

  const urgent = scheduler.reserveAttempt({
    task: task("15", "urgent"),
    attemptId: "attempt-15",
    sequence: 1,
    startReason: "dispatch",
    workspace: workspace("15", "attempt-15"),
    startedAt: "2026-08-02T12:00:02.000Z",
    idempotencyKey: "dispatch-15",
  });
  assert.equal(urgent.kind, "reserved");
  assert.deepEqual(
    scheduler.reserveAttempt({
      task: task("16", "urgent"),
      attemptId: "attempt-16",
      sequence: 1,
      startReason: "dispatch",
      workspace: workspace("16", "attempt-16"),
      startedAt: "2026-08-02T12:00:03.000Z",
      idempotencyKey: "dispatch-16",
    }),
    { kind: "rejected", reasons: ["global_concurrency_exhausted"] },
  );
  assert.equal(scheduler.snapshot().activeAttempts.length, 2);
});
