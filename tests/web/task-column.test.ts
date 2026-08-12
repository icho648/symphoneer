import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskSummary } from "@symphoneer/contracts";
import {
  compareExecutionPriority,
  taskBelongsToProject,
  taskNeedsAttention,
} from "../../src/web/lib/task-column.ts";

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

test("execution queue prioritizes attention, running, ready, backlog, then done", () => {
  const tasks = [
    task({ id: "done", workflowStatus: "done" }),
    task({ id: "backlog", workflowStatus: "backlog" }),
    task({ id: "ready", workflowStatus: "ready" }),
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
    ["blocked", "review", "running", "ready", "backlog", "done"],
  );
  assert.equal(taskNeedsAttention(tasks[0] as TaskSummary), true);
  assert.equal(taskNeedsAttention(task({ workflowStatus: "in_review" })), true);
  assert.equal(taskNeedsAttention(task({ workflowStatus: "ready" })), false);
});
