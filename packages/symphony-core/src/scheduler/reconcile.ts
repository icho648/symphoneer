import type { TaskSummary } from "@symphoneer/contracts";

import { evaluateEligibility } from "../eligibility.ts";
import { terminateRunning } from "./attempt.ts";
import { normalizeState } from "./policy.ts";
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
  const terminalStates = new Set(policy.terminalStates.map(normalizeState));
  const keptAttemptIds: string[] = [];
  const stoppedAttemptIds: string[] = [];
  const cleanupWorkspaceIds: string[] = [];

  for (const [taskId, running] of [...state.running]) {
    const current = refreshed.get(taskId);
    if (current && evaluateEligibility(current, policy).eligible) {
      state.running.set(taskId, { ...running, task: current });
      keptAttemptIds.push(running.attemptId);
      continue;
    }

    const cleanup = current ? terminalStates.has(normalizeState(current.state)) : false;
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
