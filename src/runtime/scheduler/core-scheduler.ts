import {
  type AttemptSnapshot,
  AttemptSnapshotSchema,
  type TaskSummary,
  TaskSummarySchema,
  type WorkspaceReference,
} from "@symphoneer/contracts";
import { canonicalizeWorkspaceReference } from "../workspace/index.ts";
import {
  attachTurn,
  deleteAttempt,
  finishAttempt,
  pauseAttempt,
  resumePausedAttempt,
} from "./attempt/index.ts";
import { reserve } from "./dispatch/index.ts";
import { type ReconcileResult, reconcile } from "./reconcile.ts";
import { ReplayCache } from "./replay-cache.ts";
import { dueRetries, retryDelayMs, transitionRetry } from "./retry/index.ts";
import { snapshot } from "./snapshot.ts";
import { createSchedulerState } from "./state.ts";
import {
  CoreError,
  type CorePolicy,
  type ReserveAttemptRequest,
  type ReserveDecision,
  type RetryEntry,
  type RetryTransition,
  type TerminalAttemptStatus,
} from "./types.ts";

export class CoreScheduler {
  #policy: CorePolicy;
  readonly #state = createSchedulerState();
  readonly #replay = new ReplayCache();

  constructor(policy: CorePolicy) {
    this.#policy = policy;
  }

  updatePolicy(policy: CorePolicy): void {
    this.#policy = policy;
  }

  restore(input: {
    tasks: readonly TaskSummary[];
    attempts: readonly AttemptSnapshot[];
    workspaces: readonly WorkspaceReference[];
  }): void {
    if (this.#state.attempts.size > 0) {
      throw new CoreError("conflict", "Scheduler state has already been restored");
    }
    const tasks = new Map(input.tasks.map((task) => [task.id, TaskSummarySchema.parse(task)]));
    const attempts = input.attempts
      .map((attempt) => AttemptSnapshotSchema.parse(attempt))
      .sort((left, right) => left.sequence - right.sequence);
    const workspaces = new Map(
      input.workspaces.map((workspace) => {
        const canonical = canonicalizeWorkspaceReference(workspace);
        this.#state.workspaces.set(canonical.path, canonical);
        return [canonical.id, canonical] as const;
      }),
    );
    for (const attempt of attempts) this.#state.attempts.set(attempt.id, attempt);

    const latest = new Map<string, AttemptSnapshot>();
    for (const attempt of attempts) latest.set(attempt.taskId, attempt);
    for (const attempt of latest.values()) {
      const task = tasks.get(attempt.taskId);
      const workspace = workspaces.get(attempt.workspaceId);
      if (!task || !workspace) continue;
      if (attempt.controller === "codex") {
        this.#state.claims.set(task.id, attempt.id);
        this.#restoreActive(attempt, task, workspace);
        continue;
      }
      if (attempt.status === "paused") {
        this.#state.claims.set(task.id, attempt.id);
        const threadId = attempt.providerSession?.threadId;
        if (threadId) this.#state.pausedThreads.set(threadId, attempt.id);
        continue;
      }
      if (attempt.finishedAt == null) {
        this.#state.claims.set(task.id, attempt.id);
        this.#restoreActive(attempt, task, workspace);
        continue;
      }
      if (
        !["succeeded", "failed", "timed_out", "stalled"].includes(attempt.status) ||
        workspace.state !== "retained"
      ) {
        continue;
      }
      const kind = attempt.status === "succeeded" ? "continuation" : "failure";
      const failureAttempt =
        kind === "continuation"
          ? 1
          : consecutiveFailures(attempts.filter((candidate) => candidate.taskId === task.id));
      this.#state.claims.set(task.id, attempt.id);
      this.#state.retries.set(task.id, {
        taskId: task.id,
        identifier: task.identifier,
        attempt: failureAttempt,
        kind,
        dueAtMs:
          Date.parse(attempt.finishedAt) +
          retryDelayMs(kind, failureAttempt, this.#policy.maxRetryBackoffMs),
        error: attempt.failure ?? null,
      });
    }
  }

  #restoreActive(attempt: AttemptSnapshot, task: TaskSummary, workspace: WorkspaceReference): void {
    if (attempt.finishedAt != null || attempt.status === "paused") return;
    this.#state.running.set(task.id, {
      task,
      attemptId: attempt.id,
      workspace,
      failureRetryAttempt: 0,
    });
    if (workspace.ownerAttemptId === attempt.id) {
      this.#state.workspaceOwners.set(workspace.path, attempt.id);
    }
    if (attempt.activeTurn) {
      this.#state.activeTurns.set(attempt.activeTurn.turnId, {
        attemptId: attempt.id,
        ...attempt.activeTurn,
      });
      this.#state.activeThreads.set(attempt.activeTurn.threadId, attempt.id);
    }
  }

  reserveAttempt(request: ReserveAttemptRequest): ReserveDecision {
    if (request.startReason === "retry" || request.startReason === "continuation") {
      throw new CoreError(
        "invalid_transition",
        `${request.startReason} Attempts must consume the queued retry transition`,
      );
    }
    const task = TaskSummarySchema.parse(request.task);
    const workspace = canonicalizeWorkspaceReference(request.workspace);
    const normalized = { ...request, attemptId: request.attemptId.trim(), task, workspace };
    return this.#replay.run(request.idempotencyKey, { operation: "reserve", ...normalized }, () =>
      reserve(this.#state, this.#policy, normalized, task, workspace, false),
    );
  }

  attachTurn(request: {
    attemptId: string;
    threadId: string;
    turnId: string;
    updatedAt: string;
    idempotencyKey: string;
  }): AttemptSnapshot {
    const normalized = {
      ...request,
      attemptId: request.attemptId.trim(),
      threadId: request.threadId.trim(),
      turnId: request.turnId.trim(),
    };
    if (!normalized.attemptId || !normalized.threadId || !normalized.turnId) {
      throw new CoreError("conflict", "Attempt, Thread, and Turn IDs cannot be blank");
    }
    return this.#replay.run(
      request.idempotencyKey,
      { operation: "attachTurn", ...normalized },
      () => attachTurn(this.#state, normalized),
    );
  }

  finishAttempt(request: {
    attemptId: string;
    status: TerminalAttemptStatus;
    finishedAt: string;
    workspace: WorkspaceReference;
    error?: string;
    idempotencyKey: string;
  }): { attempt: AttemptSnapshot; retry: RetryEntry | null } {
    const normalized = {
      ...request,
      attemptId: request.attemptId.trim(),
      workspace: canonicalizeWorkspaceReference(request.workspace),
    };
    return this.#replay.run(
      request.idempotencyKey,
      { operation: "finishAttempt", ...normalized },
      () => finishAttempt(this.#state, this.#policy, normalized),
    );
  }

  pauseAttempt(request: {
    attemptId: string;
    pausedAt: string;
    workspace: WorkspaceReference;
    controller?: AttemptSnapshot["controller"];
    idempotencyKey: string;
  }): {
    attempt: AttemptSnapshot;
    workspace: WorkspaceReference;
  } {
    const normalized = {
      ...request,
      attemptId: request.attemptId.trim(),
      workspace: canonicalizeWorkspaceReference(request.workspace),
    };
    return this.#replay.run(
      request.idempotencyKey,
      { operation: "pauseAttempt", ...normalized },
      () => pauseAttempt(this.#state, normalized),
    );
  }

  deleteAttempt(request: { attemptId: string; idempotencyKey: string }): boolean {
    const attemptId = request.attemptId.trim();
    if (!attemptId) throw new CoreError("conflict", "Attempt ID cannot be blank");
    return this.#replay.run(request.idempotencyKey, { operation: "deleteAttempt", attemptId }, () =>
      deleteAttempt(this.#state, attemptId),
    );
  }

  resumePausedAttempt(request: {
    attemptId: string;
    task: TaskSummary;
    workspace: WorkspaceReference;
    resumedAt: string;
    idempotencyKey: string;
    takeControl?: boolean;
  }): AttemptSnapshot {
    const normalized = {
      ...request,
      attemptId: request.attemptId.trim(),
      task: TaskSummarySchema.parse(request.task),
      workspace: canonicalizeWorkspaceReference(request.workspace),
    };
    return this.#replay.run(
      request.idempotencyKey,
      { operation: "resumePausedAttempt", ...normalized },
      () => resumePausedAttempt(this.#state, this.#policy, normalized),
    );
  }

  transitionRetry(request: {
    taskId: string;
    refreshedTask: TaskSummary | null;
    nowMs: number;
    nextAttempt?: Omit<ReserveAttemptRequest, "task" | "startReason" | "idempotencyKey">;
    idempotencyKey: string;
  }): RetryTransition {
    const taskId = request.taskId.trim();
    if (!taskId || !Number.isFinite(request.nowMs)) {
      throw new CoreError("invalid_transition", "Retry transition requires a Task ID and clock");
    }
    const task = request.refreshedTask ? TaskSummarySchema.parse(request.refreshedTask) : null;
    if (task && task.id !== taskId) {
      throw new CoreError("conflict", `Refreshed Task ${task.id} does not match ${taskId}`);
    }
    const nextAttempt = request.nextAttempt
      ? {
          ...request.nextAttempt,
          attemptId: request.nextAttempt.attemptId.trim(),
          workspace: canonicalizeWorkspaceReference(request.nextAttempt.workspace),
        }
      : undefined;
    const normalized = {
      taskId,
      task,
      nowMs: request.nowMs,
      idempotencyKey: request.idempotencyKey,
      ...(nextAttempt ? { nextAttempt } : {}),
    };
    return this.#replay.run(
      request.idempotencyKey,
      { operation: "transitionRetry", ...request, taskId, task, nextAttempt },
      () => transitionRetry(this.#state, this.#policy, normalized),
    );
  }

  dueRetries(nowMs: number): RetryEntry[] {
    return dueRetries(this.#state, nowMs);
  }

  reconcile(request: {
    tasks: readonly TaskSummary[];
    observedAt: string;
    idempotencyKey: string;
  }): ReconcileResult {
    const tasks = request.tasks.map((task) => TaskSummarySchema.parse(task));
    return this.#replay.run(
      request.idempotencyKey,
      { operation: "reconcile", ...request, tasks },
      () => reconcile(this.#state, this.#policy, tasks, request.observedAt),
    );
  }

  snapshot() {
    return snapshot(this.#state);
  }
}

function consecutiveFailures(attempts: readonly AttemptSnapshot[]): number {
  let count = 0;
  for (const attempt of [...attempts].sort((left, right) => right.sequence - left.sequence)) {
    if (!["failed", "timed_out", "stalled"].includes(attempt.status)) break;
    count += 1;
  }
  return Math.max(count, 1);
}
