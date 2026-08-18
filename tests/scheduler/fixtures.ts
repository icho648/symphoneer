import {
  CONTRACT_SCHEMA_VERSION,
  type TaskSummary,
  type WorkspaceReference,
} from "@symphoneer/contracts";
import type { CoreScheduler } from "../../src/runtime/scheduler/index.ts";
import { createWorkspaceReference } from "../../src/runtime/workspace/index.ts";

export function task(id: string, state = "open"): TaskSummary {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id,
    identifier: `#${id}`,
    source: {
      kind: "github",
      nativeId: id,
      url: `https://github.com/icho648/symphoneer/issues/${id}`,
    },
    title: `Task ${id}`,
    state,
    labels: ["symphoneer:ready"],
    dispatchable: true,
  };
}

export function workspace(taskId: string, attemptId: string, identifier = `#${taskId}`) {
  return createWorkspaceReference({
    root: "/tmp/symphoneer-workspaces",
    taskId,
    identifier,
    attemptId,
    repository: "icho648/symphoneer",
    branch: `codex/${taskId}`,
    host: "local",
  });
}

export const retained = (workspace: WorkspaceReference): WorkspaceReference => ({
  ...workspace,
  state: "retained",
  ownerAttemptId: null,
});

export const policy = {
  activeStates: ["open", "urgent"],
  terminalStates: ["closed"],
  requiredLabels: ["symphoneer:ready"],
  excludedLabels: ["symphoneer:review"],
  maxConcurrentAgents: 2,
  maxConcurrentAgentsByState: { open: 1, urgent: 1 },
  maxAttempts: 100,
  maxRetryBackoffMs: 300_000,
};

export function queueFailedAttempt(scheduler: CoreScheduler, id: string) {
  const owned = workspace(id, `attempt-${id}-1`);
  scheduler.reserveAttempt({
    task: task(id),
    attemptId: `attempt-${id}-1`,
    sequence: 1,
    startReason: "dispatch",
    workspace: owned,
    startedAt: "2026-08-02T12:00:00.000Z",
    idempotencyKey: `dispatch-${id}-1`,
  });
  return scheduler.finishAttempt({
    attemptId: `attempt-${id}-1`,
    status: "failed",
    finishedAt: "2026-08-02T12:00:02.000Z",
    workspace: retained(owned),
    error: "runner failed",
    idempotencyKey: `finish-${id}-1`,
  }).retry;
}
