import {
  type AttemptSnapshot,
  AttemptSnapshotSchema,
  type WorkspaceReference,
  WorkspaceReferenceSchema,
} from "@symphoneer/contracts";

import { retryDelayMs } from "../retry/backoff.ts";
import type { SchedulerState } from "../state.ts";
import {
  CoreError,
  type CorePolicy,
  type RetryEntry,
  type TerminalAttemptStatus,
} from "../types.ts";

export { attachTurn } from "./turn.ts";

export function finishAttempt(
  state: SchedulerState,
  policy: CorePolicy,
  request: {
    attemptId: string;
    status: TerminalAttemptStatus;
    finishedAt: string;
    error?: string;
  },
): { attempt: AttemptSnapshot; retry: RetryEntry | null } {
  const attempt = state.attempts.get(request.attemptId);
  if (!attempt) throw new CoreError("not_found", `Attempt ${request.attemptId} does not exist`);
  if (attempt.finishedAt != null) {
    return { attempt, retry: null };
  }
  const running = state.running.get(attempt.taskId);
  if (!running || running.attemptId !== attempt.id) {
    throw new CoreError("invalid_transition", `Attempt ${attempt.id} is not active`);
  }

  const finished = terminateRunning(
    state,
    attempt.taskId,
    request.status,
    request.finishedAt,
    request.error ?? null,
    "retained",
  ).attempt;

  let retry: RetryEntry | null = null;
  if (request.status === "canceled_by_reconciliation") {
    state.claims.delete(finished.taskId);
    state.retries.delete(finished.taskId);
  } else {
    const kind = request.status === "succeeded" ? "continuation" : "failure";
    const attemptNumber = kind === "continuation" ? 1 : running.failureRetryAttempt + 1;
    retry = {
      taskId: finished.taskId,
      identifier: running.task.identifier,
      attempt: attemptNumber,
      kind,
      dueAtMs:
        Date.parse(request.finishedAt) +
        retryDelayMs(kind, attemptNumber, policy.maxRetryBackoffMs),
      error: request.error ?? null,
    };
    state.retries.set(finished.taskId, retry);
    state.claims.set(finished.taskId, finished.id);
  }

  return { attempt: finished, retry };
}

export function terminateRunning(
  state: SchedulerState,
  taskId: string,
  status: TerminalAttemptStatus,
  finishedAt: string,
  failure: string | null,
  workspaceState: "retained" | "released",
): { attempt: AttemptSnapshot; workspace: WorkspaceReference } {
  const running = state.running.get(taskId);
  if (!running) throw new CoreError("not_found", `Task ${taskId} is not running`);
  const attempt = state.attempts.get(running.attemptId);
  if (!attempt) throw new CoreError("not_found", `Attempt ${running.attemptId} does not exist`);
  const finished = AttemptSnapshotSchema.parse({
    ...attempt,
    status,
    activeTurn: null,
    updatedAt: finishedAt,
    finishedAt,
    failure,
  });
  const workspace = WorkspaceReferenceSchema.parse({
    ...running.workspace,
    state: workspaceState,
    ownerAttemptId: null,
  });
  if (attempt.activeTurn) {
    state.activeTurns.delete(attempt.activeTurn.turnId);
    state.activeThreads.delete(attempt.activeTurn.threadId);
  }
  state.attempts.set(finished.id, finished);
  state.workspaces.set(workspace.path, workspace);
  state.running.delete(taskId);
  state.workspaceOwners.delete(workspace.path);
  return { attempt: finished, workspace };
}
