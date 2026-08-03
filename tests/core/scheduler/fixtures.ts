import {
  CONTRACT_SCHEMA_VERSION,
  type TaskSummary,
} from "../../../packages/contracts/src/index.ts";
import type { CoreScheduler } from "../../../packages/symphony-core/src/scheduler/index.ts";
import { createWorkspaceReference } from "../../../packages/symphony-core/src/workspace/index.ts";

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
    labels: ["symphony:ready"],
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

export const policy = {
  activeStates: ["open", "urgent"],
  terminalStates: ["closed"],
  requiredLabels: ["symphony:ready"],
  excludedLabels: ["symphony:review"],
  maxConcurrentAgents: 2,
  maxConcurrentAgentsByState: { open: 1, urgent: 1 },
  maxRetryBackoffMs: 300_000,
};

export function queueFailedAttempt(scheduler: CoreScheduler, id: string) {
  scheduler.reserveAttempt({
    task: task(id),
    attemptId: `attempt-${id}-1`,
    sequence: 1,
    startReason: "dispatch",
    workspace: workspace(id, `attempt-${id}-1`),
    startedAt: "2026-08-02T12:00:00.000Z",
    idempotencyKey: `dispatch-${id}-1`,
  });
  return scheduler.finishAttempt({
    attemptId: `attempt-${id}-1`,
    status: "failed",
    finishedAt: "2026-08-02T12:00:02.000Z",
    error: "runner failed",
    idempotencyKey: `finish-${id}-1`,
  }).retry;
}
