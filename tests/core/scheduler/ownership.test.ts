import assert from "node:assert/strict";
import test from "node:test";

import { CoreError, CoreScheduler } from "../../../packages/symphony-core/src/scheduler/index.ts";
import { workspaceKey } from "../../../packages/symphony-core/src/workspace/index.ts";
import { policy, task, workspace } from "./fixtures.ts";

test("workspace and active Turn ownership are unique and idempotent", () => {
  const scheduler = new CoreScheduler({
    ...policy,
    maxConcurrentAgents: 3,
    maxConcurrentAgentsByState: { open: 3, urgent: 3 },
  });
  scheduler.reserveAttempt({
    task: task("20"),
    attemptId: "attempt-20",
    sequence: 1,
    startReason: "dispatch",
    workspace: workspace("20", "attempt-20", "shared-identifier"),
    startedAt: "2026-08-02T12:00:00.000Z",
    idempotencyKey: "dispatch-20",
  });

  assert.deepEqual(
    scheduler.reserveAttempt({
      task: task("21"),
      attemptId: "attempt-21",
      sequence: 1,
      startReason: "dispatch",
      workspace: {
        ...workspace("21", "attempt-21", "shared-identifier"),
        path: `${workspace("21", "attempt-21", "shared-identifier").path}/../${workspaceKey("shared-identifier")}`,
      },
      startedAt: "2026-08-02T12:00:01.000Z",
      idempotencyKey: "dispatch-21",
    }),
    { kind: "rejected", reasons: ["workspace_owned"] },
  );

  const attached = scheduler.attachTurn({
    attemptId: "attempt-20",
    threadId: " thread-20 ",
    turnId: " turn-20 ",
    updatedAt: "2026-08-02T12:00:02.000Z",
    idempotencyKey: "attach-turn-20",
  });
  assert.deepEqual(
    scheduler.attachTurn({
      attemptId: "attempt-20",
      threadId: " thread-20 ",
      turnId: " turn-20 ",
      updatedAt: "2026-08-02T12:00:02.000Z",
      idempotencyKey: "attach-turn-20",
    }),
    attached,
  );
  scheduler.reserveAttempt({
    task: task("22"),
    attemptId: "attempt-22",
    sequence: 1,
    startReason: "dispatch",
    workspace: workspace("22", "attempt-22"),
    startedAt: "2026-08-02T12:00:02.000Z",
    idempotencyKey: "dispatch-22",
  });
  assert.throws(
    () =>
      scheduler.attachTurn({
        attemptId: "attempt-22",
        threadId: "thread-20",
        turnId: "turn-20",
        updatedAt: "2026-08-02T12:00:03.000Z",
        idempotencyKey: "attach-alias-turn",
      }),
    (error) => error instanceof CoreError && error.code === "conflict",
  );
  assert.throws(
    () =>
      scheduler.attachTurn({
        attemptId: "attempt-20",
        threadId: "thread-20",
        turnId: "turn-other",
        updatedAt: "2026-08-02T12:00:03.000Z",
        idempotencyKey: "attach-another-turn",
      }),
    (error) => error instanceof CoreError && error.code === "conflict",
  );
  assert.deepEqual(scheduler.snapshot().activeTurns, [
    { attemptId: "attempt-20", threadId: "thread-20", turnId: "turn-20" },
  ]);
});

test("Workspace reservations reject task and stable identity changes", () => {
  const scheduler = new CoreScheduler(policy);
  assert.throws(
    () =>
      scheduler.reserveAttempt({
        task: task("23"),
        attemptId: "attempt-23",
        sequence: 1,
        startReason: "dispatch",
        workspace: workspace("other-task", "attempt-23"),
        startedAt: "2026-08-02T12:00:00.000Z",
        idempotencyKey: "dispatch-23",
      }),
    (error) => error instanceof CoreError && error.code === "conflict",
  );
  scheduler.reserveAttempt({
    task: task("24"),
    attemptId: "attempt-24-1",
    sequence: 1,
    startReason: "dispatch",
    workspace: workspace("24", "attempt-24-1"),
    startedAt: "2026-08-02T12:00:00.000Z",
    idempotencyKey: "dispatch-24-1",
  });
  scheduler.finishAttempt({
    attemptId: "attempt-24-1",
    status: "canceled_by_reconciliation",
    finishedAt: "2026-08-02T12:00:01.000Z",
    idempotencyKey: "finish-24-1",
  });

  const mismatches = [
    { id: "workspace:other" },
    { repository: "icho648/other" },
    { branch: "codex/other" },
    { host: "remote" },
  ];
  for (const [index, mismatch] of mismatches.entries()) {
    const attemptId = `attempt-24-mismatch-${index}`;
    assert.deepEqual(
      scheduler.reserveAttempt({
        task: task("24"),
        attemptId,
        sequence: 2,
        startReason: "dispatch",
        workspace: { ...workspace("24", attemptId), ...mismatch },
        startedAt: "2026-08-02T12:00:02.000Z",
        idempotencyKey: `dispatch-24-mismatch-${index}`,
      }),
      { kind: "rejected", reasons: ["workspace_owned"] },
    );
  }

  assert.equal(
    scheduler.reserveAttempt({
      task: task("24"),
      attemptId: "attempt-24-2",
      sequence: 2,
      startReason: "dispatch",
      workspace: workspace("24", "attempt-24-2"),
      startedAt: "2026-08-02T12:00:02.000Z",
      idempotencyKey: "dispatch-24-2",
    }).kind,
    "reserved",
  );
});
