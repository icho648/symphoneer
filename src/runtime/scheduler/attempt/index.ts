import {
  type AttemptSnapshot,
  AttemptSnapshotSchema,
  type TaskSummary,
  type WorkspaceReference,
  WorkspaceReferenceSchema,
} from "@symphoneer/contracts";
import { evaluateEligibility } from "../eligibility.ts";
import { retryDelayMs } from "../retry/backoff.ts";
import type { SchedulerState } from "../state.ts";
import {
  CoreError,
  type CorePolicy,
  type RetryEntry,
  type TerminalAttemptStatus,
} from "../types.ts";

export { attachTurn } from "./turn.ts";

export function pauseAttempt(
  state: SchedulerState,
  request: {
    attemptId: string;
    pausedAt: string;
    workspace: WorkspaceReference;
    controller?: AttemptSnapshot["controller"];
  },
): { attempt: AttemptSnapshot; workspace: WorkspaceReference } {
  const attempt = state.attempts.get(request.attemptId);
  if (!attempt) throw new CoreError("not_found", `Attempt ${request.attemptId} does not exist`);
  const running = state.running.get(attempt.taskId);
  if (!running || running.attemptId !== attempt.id || attempt.providerSession == null) {
    throw new CoreError("invalid_transition", `Attempt ${attempt.id} cannot be paused`);
  }
  const pausedAt = AttemptSnapshotSchema.shape.updatedAt.parse(request.pausedAt);
  if (Date.parse(pausedAt) < Date.parse(attempt.updatedAt)) {
    throw new CoreError("invalid_transition", "Pause cannot precede the current Attempt state");
  }
  const paused = AttemptSnapshotSchema.parse({
    ...attempt,
    controller: request.controller ?? attempt.controller,
    status: "paused",
    activeTurn: null,
    updatedAt: pausedAt,
  });
  const workspace = retainedWorkspace(running.workspace, request.workspace);
  state.pausedThreads.set(attempt.providerSession.threadId, attempt.id);
  if (attempt.activeTurn) {
    state.activeTurns.delete(attempt.activeTurn.turnId);
    state.activeThreads.delete(attempt.activeTurn.threadId);
  }
  state.attempts.set(paused.id, paused);
  state.workspaces.set(workspace.path, workspace);
  state.pausedFailureRetries.set(paused.id, running.failureRetryAttempt);
  state.running.delete(attempt.taskId);
  state.workspaceOwners.delete(workspace.path);
  return { attempt: paused, workspace };
}

export function deleteAttempt(state: SchedulerState, attemptId: string): boolean {
  const attempt = state.attempts.get(attemptId);
  if (!attempt) return false;
  if (state.running.get(attempt.taskId)?.attemptId === attempt.id) {
    throw new CoreError(
      "invalid_transition",
      `Attempt ${attempt.id} must be paused before deletion`,
    );
  }
  if (state.claims.get(attempt.taskId) === attempt.id) {
    state.claims.delete(attempt.taskId);
    state.retries.delete(attempt.taskId);
  }
  for (const [path, ownerAttemptId] of state.workspaceOwners) {
    if (ownerAttemptId === attempt.id) state.workspaceOwners.delete(path);
  }
  for (const [turnId, turn] of state.activeTurns) {
    if (turn.attemptId === attempt.id) state.activeTurns.delete(turnId);
  }
  for (const [threadId, ownerAttemptId] of state.activeThreads) {
    if (ownerAttemptId === attempt.id) state.activeThreads.delete(threadId);
  }
  for (const [threadId, ownerAttemptId] of state.pausedThreads) {
    if (ownerAttemptId === attempt.id) state.pausedThreads.delete(threadId);
  }
  state.pausedFailureRetries.delete(attempt.id);
  state.attempts.delete(attempt.id);
  return true;
}

export function resumePausedAttempt(
  state: SchedulerState,
  policy: CorePolicy,
  request: {
    attemptId: string;
    task: TaskSummary;
    workspace: WorkspaceReference;
    resumedAt: string;
    takeControl?: boolean;
  },
): AttemptSnapshot {
  const attempt = state.attempts.get(request.attemptId);
  if (!attempt) throw new CoreError("not_found", `Attempt ${request.attemptId} does not exist`);
  const knownWorkspace = [...state.workspaces.values()].find(
    (workspace) => workspace.id === attempt.workspaceId,
  );
  if (
    attempt.status !== "paused" ||
    state.claims.get(attempt.taskId) !== attempt.id ||
    state.running.has(attempt.taskId) ||
    !knownWorkspace ||
    request.task.id !== attempt.taskId ||
    request.workspace.ownerAttemptId !== attempt.id ||
    request.workspace.state !== "ready" ||
    !sameStableWorkspaceIdentity(knownWorkspace, request.workspace)
  ) {
    throw new CoreError("invalid_transition", `Attempt ${attempt.id} cannot resume`);
  }
  if (attempt.controller === "codex" && request.takeControl !== true) {
    throw new CoreError(
      "invalid_transition",
      `Attempt ${attempt.id} requires explicit control return`,
    );
  }
  const eligibility = evaluateEligibility(request.task, policy);
  if (!eligibility.eligible) {
    throw new CoreError("invalid_transition", `Task ${request.task.id} is no longer eligible`);
  }
  if (state.running.size >= policy.maxConcurrentAgents) {
    throw new CoreError("conflict", "Global Agent concurrency is exhausted");
  }
  const taskState = request.task.state.trim().toLowerCase();
  const stateLimit = policy.maxConcurrentAgentsByState[taskState];
  if (
    stateLimit != null &&
    [...state.running.values()].filter(
      (entry) => entry.task.state.trim().toLowerCase() === taskState,
    ).length >= stateLimit
  ) {
    throw new CoreError("conflict", `Agent concurrency for ${request.task.state} is exhausted`);
  }
  const resumedAt = AttemptSnapshotSchema.shape.updatedAt.parse(request.resumedAt);
  if (Date.parse(resumedAt) < Date.parse(attempt.updatedAt)) {
    throw new CoreError("invalid_transition", "Resume cannot precede the paused Attempt state");
  }
  const resumed = AttemptSnapshotSchema.parse({
    ...attempt,
    controller: "symphoneer",
    status: "launching_agent",
    updatedAt: resumedAt,
  });
  const threadId = attempt.providerSession?.threadId;
  releasePausedThread(state, attempt);
  if (threadId) state.activeThreads.set(threadId, resumed.id);
  state.attempts.set(resumed.id, resumed);
  state.running.set(attempt.taskId, {
    task: request.task,
    attemptId: resumed.id,
    workspace: request.workspace,
    failureRetryAttempt: state.pausedFailureRetries.get(attempt.id) ?? 0,
  });
  state.pausedFailureRetries.delete(attempt.id);
  state.workspaces.set(request.workspace.path, request.workspace);
  state.workspaceOwners.set(request.workspace.path, resumed.id);
  return resumed;
}

export function finishAttempt(
  state: SchedulerState,
  policy: CorePolicy,
  request: {
    attemptId: string;
    status: TerminalAttemptStatus;
    finishedAt: string;
    workspace: WorkspaceReference;
    error?: string;
  },
): { attempt: AttemptSnapshot; retry: RetryEntry | null } {
  const attempt = state.attempts.get(request.attemptId);
  if (!attempt) throw new CoreError("not_found", `Attempt ${request.attemptId} does not exist`);
  if (attempt.finishedAt != null) {
    const workspace = [...state.workspaces.values()].find(
      (candidate) => candidate.id === attempt.workspaceId,
    );
    if (!workspace)
      throw new CoreError("not_found", `Workspace ${attempt.workspaceId} does not exist`);
    if (
      [...state.attempts.values()].some(
        (candidate) =>
          candidate.workspaceId === attempt.workspaceId && candidate.sequence > attempt.sequence,
      )
    ) {
      throw new CoreError(
        "conflict",
        `Attempt ${attempt.id} has a stale Workspace observation after a newer Attempt`,
      );
    }
    const ownerAttemptId = state.workspaceOwners.get(workspace.path);
    if (ownerAttemptId && ownerAttemptId !== attempt.id) {
      throw new CoreError(
        "conflict",
        `Workspace ${workspace.id} is owned by Attempt ${ownerAttemptId}`,
      );
    }
    const refreshedWorkspace = retainedWorkspace(workspace, request.workspace);
    state.workspaces.set(refreshedWorkspace.path, refreshedWorkspace);
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
    request.workspace,
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
      ...(finished.sequence >= policy.maxAttempts ? { automatic: false as const } : {}),
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
  workspaceInput?: WorkspaceReference,
): { attempt: AttemptSnapshot; workspace: WorkspaceReference } {
  const running = state.running.get(taskId);
  if (!running) throw new CoreError("not_found", `Task ${taskId} is not running`);
  const attempt = state.attempts.get(running.attemptId);
  if (!attempt) throw new CoreError("not_found", `Attempt ${running.attemptId} does not exist`);
  const parsedFinishedAt = AttemptSnapshotSchema.shape.updatedAt.parse(finishedAt);
  if (Date.parse(parsedFinishedAt) < Date.parse(attempt.updatedAt)) {
    throw new CoreError("invalid_transition", "Finish cannot precede the current Attempt state");
  }
  const finished = AttemptSnapshotSchema.parse({
    ...attempt,
    status,
    activeTurn: null,
    updatedAt: parsedFinishedAt,
    finishedAt: parsedFinishedAt,
    failure,
  });
  const workspace = workspaceInput
    ? retainedWorkspace(running.workspace, workspaceInput)
    : WorkspaceReferenceSchema.parse({
        ...running.workspace,
        state: workspaceState,
        ownerAttemptId: null,
      });
  if (attempt.activeTurn) {
    state.activeTurns.delete(attempt.activeTurn.turnId);
    state.activeThreads.delete(attempt.activeTurn.threadId);
  }
  const threadId = attempt.providerSession?.threadId;
  if (threadId && state.activeThreads.get(threadId) === attempt.id) {
    state.activeThreads.delete(threadId);
  }
  state.attempts.set(finished.id, finished);
  state.workspaces.set(workspace.path, workspace);
  state.running.delete(taskId);
  state.workspaceOwners.delete(workspace.path);
  return { attempt: finished, workspace };
}

const sameStableWorkspaceIdentity = (
  left: WorkspaceReference,
  right: WorkspaceReference,
): boolean =>
  left.id === right.id &&
  left.taskId === right.taskId &&
  left.path === right.path &&
  left.repository === right.repository &&
  left.branch === right.branch &&
  left.host === right.host;

function retainedWorkspace(
  expected: WorkspaceReference,
  input: WorkspaceReference,
): WorkspaceReference {
  const workspace = WorkspaceReferenceSchema.parse(input);
  if (
    workspace.state !== "retained" ||
    workspace.ownerAttemptId !== null ||
    !sameStableWorkspaceIdentity(expected, workspace)
  ) {
    throw new CoreError(
      "conflict",
      `Workspace ${workspace.id} does not match the retained Attempt Workspace`,
    );
  }
  return workspace;
}

function releasePausedThread(state: SchedulerState, attempt: AttemptSnapshot): void {
  const threadId = attempt.providerSession?.threadId;
  if (threadId && state.pausedThreads.get(threadId) === attempt.id) {
    state.pausedThreads.delete(threadId);
  }
}
