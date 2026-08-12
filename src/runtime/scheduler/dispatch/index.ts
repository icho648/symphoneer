import {
  AttemptSnapshotSchema,
  CONTRACT_SCHEMA_VERSION,
  type TaskSummary,
  type WorkspaceReference,
} from "@symphoneer/contracts";

import { evaluateEligibility, normalizeTrackerValue } from "../eligibility.ts";
import type { SchedulerState } from "../state.ts";
import {
  CoreError,
  type CorePolicy,
  type ReserveAttemptRequest,
  type ReserveDecision,
} from "../types.ts";

export { sortTasksForDispatch } from "./order.ts";

export function reserve(
  state: SchedulerState,
  policy: CorePolicy,
  request: ReserveAttemptRequest,
  task: TaskSummary,
  workspace: WorkspaceReference,
  consumeQueuedRetry: boolean,
): ReserveDecision {
  const attemptId = request.attemptId.trim();
  if (workspace.taskId !== task.id) {
    throw new CoreError("conflict", `Workspace ${workspace.id} belongs to another Task`);
  }
  if (workspace.ownerAttemptId !== attemptId) {
    throw new CoreError("conflict", `Workspace ${workspace.id} does not belong to ${attemptId}`);
  }
  if (state.attempts.has(attemptId)) {
    throw new CoreError("conflict", `Attempt ${attemptId} already exists`);
  }
  const expectedSequence = nextSequence(state, task.id);
  if (request.sequence !== expectedSequence) {
    throw new CoreError(
      "conflict",
      `Attempt ${attemptId} must use sequence ${expectedSequence}, got ${request.sequence}`,
    );
  }

  const eligibility = evaluateEligibility(task, policy);
  const reasons = [...eligibility.reasons];
  const queuedRetry = consumeQueuedRetry ? state.retries.get(task.id) : undefined;
  if (
    queuedRetry &&
    request.startReason !== (queuedRetry.kind === "continuation" ? "continuation" : "retry")
  ) {
    throw new CoreError("invalid_transition", "Attempt start reason does not match queued retry");
  }
  if (state.claims.has(task.id) && !queuedRetry) reasons.push("already_claimed");
  if (reasons.length > 0) return { kind: "rejected", reasons };

  if (state.running.size >= policy.maxConcurrentAgents) {
    reasons.push("global_concurrency_exhausted");
  } else {
    const taskState = normalizeTrackerValue(task.state);
    const stateLimit = policy.maxConcurrentAgentsByState[taskState];
    const stateRunning = [...state.running.values()].filter(
      (entry) => normalizeTrackerValue(entry.task.state) === taskState,
    ).length;
    if (stateLimit != null && stateRunning >= stateLimit) {
      reasons.push("state_concurrency_exhausted");
    }
  }
  const knownWorkspace = state.workspaces.get(workspace.path);
  const workspaceIdAtAnotherPath = [...state.workspaces.entries()].some(
    ([path, known]) => known.id === workspace.id && path !== workspace.path,
  );
  const knownTaskWorkspace = [...state.workspaces.values()].find(
    (known) => known.taskId === workspace.taskId,
  );
  const changedWorkspaceIdentity =
    workspaceIdAtAnotherPath ||
    (knownTaskWorkspace != null &&
      (knownTaskWorkspace.repository !== workspace.repository ||
        knownTaskWorkspace.host !== workspace.host)) ||
    (knownWorkspace != null &&
      (knownWorkspace.id !== workspace.id ||
        knownWorkspace.taskId !== workspace.taskId ||
        knownWorkspace.repository !== workspace.repository ||
        knownWorkspace.branch !== workspace.branch ||
        knownWorkspace.host !== workspace.host));
  if (changedWorkspaceIdentity) reasons.push("workspace_identity_mismatch");
  if (state.workspaceOwners.has(workspace.path)) reasons.push("workspace_owned");
  if (reasons.length > 0) return { kind: "rejected", reasons };

  const attempt = AttemptSnapshotSchema.parse({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: attemptId,
    taskId: task.id,
    sequence: request.sequence,
    startReason: request.startReason,
    status: "preparing_workspace",
    workspaceId: workspace.id,
    activeTurn: null,
    providerSession: null,
    startedAt: request.startedAt,
    updatedAt: request.startedAt,
    finishedAt: null,
    failure: null,
  });
  state.attempts.set(attempt.id, attempt);
  state.running.set(task.id, {
    task,
    attemptId: attempt.id,
    workspace,
    failureRetryAttempt: queuedRetry?.kind === "failure" ? queuedRetry.attempt : 0,
  });
  state.claims.set(task.id, attempt.id);
  state.workspaceOwners.set(workspace.path, attempt.id);
  state.workspaces.set(workspace.path, workspace);
  state.retries.delete(task.id);
  return { kind: "reserved", attempt };
}

function nextSequence(state: SchedulerState, taskId: string): number {
  let latest = 0;
  for (const attempt of state.attempts.values()) {
    if (attempt.taskId === taskId) latest = Math.max(latest, attempt.sequence);
  }
  return latest + 1;
}
