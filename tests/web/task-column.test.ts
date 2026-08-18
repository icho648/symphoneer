import assert from "node:assert/strict";
import { test } from "node:test";
import type { AttemptSnapshot, RuntimeTask } from "@symphoneer/contracts";
import {
  blockedReasonSummary,
  compareExecutionPriority,
  taskBelongsToProject,
  taskCanStart,
  taskCardAction,
  taskNeedsAttention,
  visibleTaskLabels,
} from "../../src/web/lib/task-column.ts";
import { buildCommand } from "../../src/web/stores/runtime-commands.ts";

const task = (overrides: Partial<RuntimeTask> = {}): RuntimeTask =>
  ({
    schemaVersion: 2,
    id: "task-1",
    identifier: "symphoneer-1",
    source: { kind: "github", nativeId: "1", url: "https://github.com/example/repo/issues/1" },
    title: "Task",
    state: "open",
    labels: [],
    dispatchable: true,
    issuePhase: "ready",
    blocked: false,
    executionState: "idle",
    displayState: "ready",
    lastAttemptOutcome: null,
    ...overrides,
  }) as RuntimeTask;

test("task board groups tasks by Runtime project identity instead of parsing tracker URLs", () => {
  const project = {
    id: "project-alpha",
    trackerKind: "github",
    repository: "example/repo",
    projectRoot: "/projects/alpha",
    workspaceRoot: "/workspaces/project-alpha",
  };
  assert.equal(taskBelongsToProject(task({ projectId: project.id }), project), true);
  assert.equal(taskBelongsToProject(task({ projectId: "project-bravo" }), project), false);
  assert.equal(taskBelongsToProject(task(), project), false);
});

test("execution queue prioritizes attention, running, backlog, then done", () => {
  const tasks = [
    task({ id: "done", issuePhase: "closed", displayState: "done" }),
    task({ id: "backlog", issuePhase: "backlog", displayState: "backlog" }),
    task({ id: "running", executionState: "running", displayState: "in_progress" }),
    task({ id: "review", issuePhase: "review", displayState: "in_review" }),
    task({
      id: "blocked",
      blocked: true,
    }),
  ];

  assert.deepEqual(
    tasks.sort(compareExecutionPriority).map((item) => item.id),
    ["blocked", "review", "running", "backlog", "done"],
  );
  assert.equal(taskNeedsAttention(tasks[0] as RuntimeTask), true);
  assert.equal(taskNeedsAttention(task({ issuePhase: "review", displayState: "in_review" })), true);
});

test("only dispatchable Backlog tasks expose a start action", () => {
  assert.equal(taskCanStart(task(), null), true);
  assert.equal(taskCanStart(task({ dispatchable: false }), null), false);
  assert.equal(
    taskCanStart(task({ executionState: "running", displayState: "in_progress" }), null),
    false,
  );
});

test("task card actions move the delivery flow forward instead of restating the gate", () => {
  assert.deepEqual(
    taskCardAction(
      task({ issuePhase: "backlog", displayState: "backlog", dispatchable: false }),
      null,
    ),
    { kind: "mark_ready" },
  );
  assert.deepEqual(taskCardAction(task(), null), { kind: "start" });
  assert.deepEqual(
    taskCardAction(
      task({ issuePhase: "review", displayState: "in_review", dispatchable: false }),
      null,
    ),
    {
      kind: "open_review",
    },
  );
  assert.deepEqual(
    taskCardAction(
      task({
        body: "Opened https://github.com/example/repo/pull/51 for review.",
        issuePhase: "review",
        displayState: "in_review",
        dispatchable: false,
      }),
      null,
    ),
    { kind: "open_review", href: "https://github.com/example/repo/pull/51" },
  );
  assert.deepEqual(
    taskCardAction(
      task({
        source: {
          kind: "github",
          nativeId: "15",
          url: "https://github.com/example/repo/pull/15",
        },
        identifier: "#15",
        issuePhase: "review",
        displayState: "in_review",
        dispatchable: false,
      }),
      null,
    ),
    { kind: "open_review", href: "https://github.com/example/repo/pull/15" },
  );
  assert.equal(
    taskCardAction(task({ executionState: "running", displayState: "in_progress" }), null),
    null,
  );
});

test("task cards hide system labels and summarize blocked reasons", () => {
  assert.deepEqual(visibleTaskLabels(["symphoneer:ready", "bug", "symphoneer:review"]), ["bug"]);
  assert.equal(
    blockedReasonSummary("pnpm install failed with code 1: Lockfile verification failed"),
    "pnpm install failed with code 1",
  );
});

test("task board records a human decision instead of only moving the card to done", () => {
  const attempt = {
    schemaVersion: 2,
    id: "attempt-1",
    taskId: "task-1",
    sequence: 1,
    startReason: "dispatch",
    status: "succeeded",
    controller: "symphoneer",
    workspaceId: "workspace-1",
    providerSession: null,
    startedAt: "2026-08-12T08:00:00.000Z",
    updatedAt: "2026-08-12T08:01:00.000Z",
    finishedAt: "2026-08-12T08:01:00.000Z",
    failure: null,
  } as AttemptSnapshot;

  assert.deepEqual(
    buildCommand(
      { kind: "record_review", evidenceIds: ["verification-1"] },
      { expectedEventSequence: 12, idempotencyKey: "review-1" },
      attempt,
      task({ issuePhase: "review", displayState: "in_review" }),
    ),
    {
      kind: "record_review",
      evidenceIds: ["verification-1"],
      expectedEventSequence: 12,
      idempotencyKey: "review-1",
      attemptId: attempt.id,
      expectedAttemptUpdatedAt: attempt.updatedAt,
      decision: "merge_close",
      decidedBy: "local-human",
      nextAction: null,
    },
  );
});
