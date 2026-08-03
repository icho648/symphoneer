import type { TaskSummary } from "@symphoneer/contracts";

import { terminateRunning } from "./attempt/index.ts";
import { evaluateEligibility } from "./eligibility.ts";
import type { SchedulerState } from "./state.ts";
import type { CorePolicy } from "./types.ts";

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
      observedAt,
      current ? "Task is no longer eligible" : "Task is missing from reconciliation refresh",
      cleanup ? "released" : "retained",
    );
    state.claims.delete(taskId);
    state.retries.delete(taskId);
    stoppedAttemptIds.push(canceled.attempt.id);
    if (cleanup) cleanupWorkspaceIds.push(canceled.workspace.id);
  }

  return { keptAttemptIds, stoppedAttemptIds, cleanupWorkspaceIds };
}
