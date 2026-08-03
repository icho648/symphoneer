import { type AttemptSnapshot, type TaskSummary, TaskSummarySchema } from "@symphoneer/contracts";
import { canonicalizeWorkspaceReference } from "../workspace/index.ts";
import { attachTurn, finishAttempt } from "./attempt/index.ts";
import { reserve } from "./dispatch/index.ts";
import { type ReconcileResult, reconcile } from "./reconcile.ts";
import { ReplayCache } from "./replay-cache.ts";
import { dueRetries, transitionRetry } from "./retry/index.ts";
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
  readonly #policy: CorePolicy;
  readonly #state = createSchedulerState();
  readonly #replay = new ReplayCache();

  constructor(policy: CorePolicy) {
    this.#policy = policy;
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
    error?: string;
    idempotencyKey: string;
  }): { attempt: AttemptSnapshot; retry: RetryEntry | null } {
    const normalized = { ...request, attemptId: request.attemptId.trim() };
    return this.#replay.run(
      request.idempotencyKey,
      { operation: "finishAttempt", ...normalized },
      () => finishAttempt(this.#state, this.#policy, normalized),
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
