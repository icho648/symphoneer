import type { TaskSummary } from "@symphoneer/contracts";
import { WorkspaceReferenceSchema } from "@symphoneer/contracts";

import { reserve } from "../dispatch/index.ts";
import { evaluateEligibility } from "../eligibility.ts";
import type { SchedulerState } from "../state.ts";
import {
  CoreError,
  type CorePolicy,
  type ReserveAttemptRequest,
  type RetryEntry,
  type RetryTransition,
} from "../types.ts";
import { retryDelayMs } from "./backoff.ts";

export { retryDelayMs } from "./backoff.ts";

export function transitionRetry(
  state: SchedulerState,
  policy: CorePolicy,
  request: {
    taskId: string;
    task: TaskSummary | null;
    nowMs: number;
    nextAttempt?: Omit<ReserveAttemptRequest, "task" | "startReason" | "idempotencyKey">;
    idempotencyKey: string;
  },
): RetryTransition {
  const retry = state.retries.get(request.taskId);
  if (!retry) throw new CoreError("not_found", `Task ${request.taskId} has no queued retry`);
  if (request.nowMs < retry.dueAtMs) return { kind: "not_due", retry };
  if (!request.task) {
    releaseRetry(state, request.taskId, false);
    return { kind: "released", reason: "missing", cleanupWorkspaceIds: [] };
  }

  const eligibility = evaluateEligibility(request.task, policy);
  if (eligibility.reasons.includes("terminal_state")) {
    return {
      kind: "released",
      reason: "terminal",
      cleanupWorkspaceIds: releaseRetry(state, request.taskId, true),
    };
  }
  if (!eligibility.eligible) {
    releaseRetry(state, request.taskId, false);
    return { kind: "released", reason: "unroutable", cleanupWorkspaceIds: [] };
  }
  if (!request.nextAttempt) {
    throw new CoreError("invalid_transition", "An eligible retry requires its next Attempt");
  }

  const decision = reserve(
    state,
    policy,
    {
      ...request.nextAttempt,
      task: request.task,
      startReason: retry.kind === "continuation" ? "continuation" : "retry",
      idempotencyKey: request.idempotencyKey,
    },
    request.task,
    request.nextAttempt.workspace,
    true,
  );
  if (decision.kind === "reserved") return decision;

  const transient = decision.reasons.every((reason) =>
    ["global_concurrency_exhausted", "state_concurrency_exhausted", "workspace_owned"].includes(
      reason,
    ),
  );
  if (!transient) {
    throw new CoreError(
      "invalid_transition",
      `Eligible retry was rejected: ${decision.reasons.join(", ")}`,
    );
  }
  const attempt = retry.attempt + 1;
  const requeued: RetryEntry = {
    ...retry,
    attempt,
    dueAtMs: request.nowMs + retryDelayMs(retry.kind, attempt, policy.maxRetryBackoffMs),
    error: `Waiting for scheduler capacity: ${decision.reasons.join(", ")}`,
  };
  state.retries.set(request.taskId, requeued);
  return { kind: "requeued", retry: requeued };
}

export function dueRetries(state: SchedulerState, nowMs: number): RetryEntry[] {
  return structuredClone(
    [...state.retries.values()]
      .filter((retry) => retry.dueAtMs <= nowMs)
      .sort(
        (left, right) => left.dueAtMs - right.dueAtMs || left.taskId.localeCompare(right.taskId),
      ),
  );
}

function releaseRetry(state: SchedulerState, taskId: string, cleanupWorkspace: boolean): string[] {
  state.retries.delete(taskId);
  state.claims.delete(taskId);
  if (!cleanupWorkspace) return [];

  const cleanupWorkspaceIds: string[] = [];
  for (const [path, workspace] of state.workspaces) {
    if (workspace.taskId !== taskId) continue;
    const released = WorkspaceReferenceSchema.parse({
      ...workspace,
      state: "released",
      ownerAttemptId: null,
    });
    state.workspaces.set(path, released);
    cleanupWorkspaceIds.push(released.id);
  }
  return cleanupWorkspaceIds;
}
