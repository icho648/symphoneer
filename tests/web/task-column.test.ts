import assert from "node:assert/strict";
import { test } from "node:test";
import type { AttemptSnapshot, TaskSummary } from "@symphoneer/contracts";
import {
  compareExecutionPriority,
  taskBelongsToProject,
  taskCanStart,
  taskNeedsAttention,
} from "../../src/web/lib/task-column.ts";
import { buildCommand } from "../../src/web/stores/runtime-commands.ts";

const task = (overrides: Partial<TaskSummary> = {}): TaskSummary =>
  ({
    schemaVersion: 2,
    id: "task-1",
    identifier: "symphoneer-1",
    source: { kind: "github", nativeId: "1", url: "https://github.com/example/repo/issues/1" },
    title: "Task",
    state: "open",
    labels: [],
    dispatchable: true,
    workflowStatus: "backlog",
    blocked: null,
    ...overrides,
  }) as TaskSummary;

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
    task({ id: "done", workflowStatus: "done" }),
    task({ id: "backlog", workflowStatus: "backlog" }),
    task({ id: "running", workflowStatus: "in_progress" }),
    task({ id: "review", workflowStatus: "in_review" }),
    task({
      id: "blocked",
      workflowStatus: "backlog",
      blocked: { reason: "Workspace conflict", since: "2026-08-08T00:00:00.000Z" },
    }),
  ];

  assert.deepEqual(
    tasks.sort(compareExecutionPriority).map((item) => item.id),
    ["blocked", "review", "running", "backlog", "done"],
  );
  assert.equal(taskNeedsAttention(tasks[0] as TaskSummary), true);
  assert.equal(taskNeedsAttention(task({ workflowStatus: "in_review" })), true);
});

test("only dispatchable Backlog tasks expose a start action", () => {
  assert.equal(taskCanStart(task(), null), true);
  assert.equal(taskCanStart(task({ dispatchable: false }), null), false);
  assert.equal(taskCanStart(task({ workflowStatus: "in_progress" }), null), false);
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
      task({ workflowStatus: "in_review" }),
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
