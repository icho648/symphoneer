import {
  type AttemptSnapshot,
  AttemptSnapshotSchema,
  type TaskSummary,
} from "@symphoneer/contracts";

import { terminateRunning } from "./attempt/index.ts";
import { evaluateEligibility } from "./eligibility.ts";
import { releaseRetry } from "./retry/index.ts";
import type { SchedulerState } from "./state.ts";
import { CoreError, type CorePolicy } from "./types.ts";

export interface ReconcileResult {
  keptAttemptIds: string[];
  stoppedAttemptIds: string[];
  cleanupWorkspaceIds: string[];
}

export function reconcile(
  state: SchedulerState,
  policy: CorePolicy,
  tasks: readonly TaskSummary[],
  observedAt: string,
): ReconcileResult {
  const timestamp = AttemptSnapshotSchema.shape.updatedAt.parse(observedAt);
  const active = [
    ...[...state.running.values()].map(({ attemptId }) => state.attempts.get(attemptId)),
    ...[...state.attempts.values()].filter((attempt) => attempt.status === "paused"),
  ];
  for (const attempt of active) {
    if (!attempt) throw new CoreError("not_found", "Active Attempt does not exist");
    if (Date.parse(timestamp) < Date.parse(attempt.updatedAt)) {
      throw new CoreError(
        "invalid_transition",
        "Reconciliation cannot precede active Attempt state",
      );
    }
  }
  const refreshed = new Map(tasks.map((task) => [task.id, task]));
  const keptAttemptIds: string[] = [];
  const stoppedAttemptIds: string[] = [];
  const cleanupWorkspaceIds: string[] = [];

  for (const [taskId, running] of [...state.running]) {
    const current = refreshed.get(taskId);
    const eligibility = current ? evaluateEligibility(current, policy) : null;
    if (current && eligibility?.eligible) {
      state.running.set(taskId, { ...running, task: current });
      keptAttemptIds.push(running.attemptId);
      continue;
    }

    const cleanup = eligibility?.reasons.includes("terminal_state") ?? false;
    const canceled = terminateRunning(
      state,
      taskId,
      "canceled_by_reconciliation",
      timestamp,
      current ? "Task is no longer eligible" : "Task is missing from reconciliation refresh",
      "retained",
    );
    state.claims.delete(taskId);
    state.retries.delete(taskId);
    stoppedAttemptIds.push(canceled.attempt.id);
    if (cleanup) cleanupWorkspaceIds.push(canceled.workspace.id);
  }

  for (const attempt of [...state.attempts.values()].filter(
    (candidate) => candidate.status === "paused",
  )) {
    const current = refreshed.get(attempt.taskId);
    const eligibility = current ? evaluateEligibility(current, policy) : null;
    if (current && eligibility?.eligible) {
      keptAttemptIds.push(attempt.id);
      continue;
    }
    const canceled = cancelPausedAttempt(
      state,
      attempt,
      timestamp,
      current ? "Task is no longer eligible" : "Task is missing from reconciliation refresh",
    );
    state.claims.delete(attempt.taskId);
    state.retries.delete(attempt.taskId);
    state.pausedFailureRetries.delete(attempt.id);
    stoppedAttemptIds.push(canceled.id);
    if (eligibility?.reasons.includes("terminal_state")) {
      cleanupWorkspaceIds.push(canceled.workspaceId);
    }
  }

  for (const [taskId] of [...state.retries]) {
    const current = refreshed.get(taskId);
    const eligibility = current ? evaluateEligibility(current, policy) : null;
    if (current && eligibility?.eligible) continue;

    const cleanup = eligibility?.reasons.includes("terminal_state") ?? false;
    cleanupWorkspaceIds.push(...releaseRetry(state, taskId, cleanup));
  }

  return { keptAttemptIds, stoppedAttemptIds, cleanupWorkspaceIds };
}

function cancelPausedAttempt(
  state: SchedulerState,
  attempt: AttemptSnapshot,
  finishedAt: string,
  failure: string,
): AttemptSnapshot {
  const canceled = AttemptSnapshotSchema.parse({
    ...attempt,
    status: "canceled_by_reconciliation",
    updatedAt: finishedAt,
    finishedAt,
    failure,
  });
  const threadId = attempt.providerSession?.threadId;
  if (threadId && state.pausedThreads.get(threadId) === attempt.id) {
    state.pausedThreads.delete(threadId);
  }
  state.attempts.set(canceled.id, canceled);
  return canceled;
}
