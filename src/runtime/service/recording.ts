import type { DomainEventEnvelope } from "@symphoneer/contracts";
import {
  type ActivityOccurrence,
  type AttemptSnapshot,
  AttemptSnapshotSchema,
  type BlockedTask,
  BlockedTaskSchema,
  CONTRACT_SCHEMA_VERSION,
  type ExecutionActivity,
  ExecutionActivitySchema,
  type ExecutionSession,
  ExecutionSessionSchema,
  type Intervention,
  InterventionSchema,
  type ReviewDecision,
  ReviewDecisionSchema,
  type RuntimeEvent,
  type TaskSummary,
  TaskSummarySchema,
  type VerificationResult,
  VerificationResultSchema,
  type WorkflowStatus,
  WorkflowStatusSchema,
  type WorkspaceReference,
  WorkspaceReferenceSchema,
} from "@symphoneer/contracts";
import { RuntimeError } from "../errors.ts";
import type { EventLog } from "./event-log.ts";
import { attemptEventType, workspaceEventType } from "./helpers.ts";

export async function recordTask(
  log: EventLog,
  taskInput: TaskSummary,
  idempotencyKey?: string,
): Promise<RuntimeEvent> {
  const task = TaskSummarySchema.parse(taskInput);
  const event = await log.append({
    type: "task.upserted",
    source: "adapter",
    aggregate: { kind: "task", id: task.id },
    taskId: task.id,
    payload: { task },
    idempotencyKey: idempotencyKey ?? `task:${task.id}:${task.updatedAt ?? ""}`,
  });
  const current = log.projection.getTask(task.id);
  if (current?.workflowStatus === "in_progress" && task.labels.includes("symphoneer:review")) {
    await recordTaskStatus(log, task.id, "in_review", null, {
      source: "adapter",
      idempotencyKey: `workflow-status:tracker:${task.id}:in-review:${task.updatedAt ?? ""}`,
    });
  }
  return event;
}

export async function recordTaskStatus(
  log: EventLog,
  taskId: string,
  workflowStatus: WorkflowStatus,
  blocked: BlockedTask | null = null,
  options: {
    source?: DomainEventEnvelope["source"];
    idempotencyKey?: string;
    commit?: boolean;
  } = {},
): Promise<RuntimeEvent | null> {
  const task = log.projection.getTask(taskId);
  if (!task) throw new RuntimeError("not_found", `Task ${taskId} was not found`);
  const status = WorkflowStatusSchema.parse(workflowStatus);
  const marker = BlockedTaskSchema.nullable().parse(blocked);
  if (task.workflowStatus === status && JSON.stringify(task.blocked) === JSON.stringify(marker)) {
    return null;
  }
  const event = {
    type: "task.status.changed",
    source: options.source ?? "runtime",
    aggregate: { kind: "task", id: taskId },
    taskId,
    payload: { workflowStatus: status, blocked: marker },
    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
  } as const;
  return options.commit ? log.commit(event) : log.append(event);
}

export async function recordAttempt(
  log: EventLog,
  attemptInput: AttemptSnapshot,
  options: { workspace?: WorkspaceReference; idempotencyKey?: string; commit?: boolean } = {},
): Promise<RuntimeEvent> {
  const attempt = AttemptSnapshotSchema.parse(attemptInput);
  const workspace = options.workspace
    ? WorkspaceReferenceSchema.parse(options.workspace)
    : undefined;
  const event = await (options.commit ? log.commit : log.append).call(log, {
    type: attemptEventType(attempt),
    source: "symphony-core",
    aggregate: { kind: "attempt", id: attempt.id },
    taskId: attempt.taskId,
    attemptId: attempt.id,
    payload: { attempt, ...(workspace ? { workspace } : {}) },
    idempotencyKey: options.idempotencyKey ?? `attempt:${attempt.id}:${attempt.updatedAt}`,
  });
  const task = log.projection.getTask(attempt.taskId);
  if (task) {
    if (
      attempt.finishedAt == null &&
      (task.workflowStatus === "backlog" || task.workflowStatus === "in_review")
    ) {
      await recordTaskStatus(log, task.id, "in_progress", null, {
        source: "symphony-core",
        idempotencyKey: `workflow-status:attempt:${attempt.id}:in-progress:${attempt.updatedAt}`,
        commit: options.commit ?? false,
      });
    } else if (attempt.finishedAt == null && task.blocked !== null) {
      await recordTaskStatus(log, task.id, task.workflowStatus, null, {
        source: "symphony-core",
        idempotencyKey: `workflow-status:attempt:${attempt.id}:unblocked:${attempt.updatedAt}`,
        commit: options.commit ?? false,
      });
    } else if (attempt.finishedAt != null && attempt.status !== "succeeded") {
      await recordTaskStatus(
        log,
        task.id,
        task.workflowStatus,
        {
          reason: attempt.failure ?? "Attempt failed",
          since: attempt.finishedAt,
        },
        {
          source: "symphony-core",
          idempotencyKey: `workflow-status:attempt:${attempt.id}:blocked`,
          commit: options.commit ?? false,
        },
      );
    }
  }
  return event;
}

export async function recordExecutionActivity(
  log: EventLog,
  activityInput: ExecutionActivity,
  commit = false,
): Promise<RuntimeEvent> {
  const activity = ExecutionActivitySchema.parse(activityInput);
  return (commit ? log.commit : log.append).call(log, {
    type: "attempt.activity.recorded",
    source: "adapter",
    aggregate: { kind: "attempt", id: activity.attemptId },
    attemptId: activity.attemptId,
    payload: { activity },
    idempotencyKey: `activity:${activity.id}:${activity.status}:${activity.occurredAt}`,
  });
}

export function recordAgentActivity(
  log: EventLog,
  attemptId: string,
  activity: ActivityOccurrence,
  commit = false,
): Promise<RuntimeEvent> {
  return recordExecutionActivity(
    log,
    {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      id: `activity:${attemptId}:${encodeURIComponent(activity.itemId)}`,
      attemptId,
      ...activity,
    },
    commit,
  );
}

export async function recordExecutionSession(
  log: EventLog,
  sessionInput: ExecutionSession,
  commit = false,
): Promise<RuntimeEvent> {
  const session = ExecutionSessionSchema.parse(sessionInput);
  return (commit ? log.commit : log.append).call(log, {
    type: "attempt.session.recorded",
    source: "adapter",
    aggregate: { kind: "attempt", id: session.attemptId },
    attemptId: session.attemptId,
    payload: { session },
    idempotencyKey: `session:${session.attemptId}:${session.threadId}:${session.capturedAt}`,
  });
}

export async function recordWorkspace(
  log: EventLog,
  workspaceInput: WorkspaceReference,
  idempotencyKey?: string,
  commit = false,
): Promise<RuntimeEvent> {
  const workspace = WorkspaceReferenceSchema.parse(workspaceInput);
  return (commit ? log.commit : log.append).call(log, {
    type: workspaceEventType(workspace),
    source: "symphony-core",
    aggregate: { kind: "workspace", id: workspace.id },
    taskId: workspace.taskId,
    ...(workspace.ownerAttemptId ? { attemptId: workspace.ownerAttemptId } : {}),
    payload: { workspace },
    idempotencyKey: idempotencyKey ?? `workspace:${workspace.id}:${workspace.state}`,
  });
}

export async function recordVerification(
  log: EventLog,
  verificationInput: VerificationResult,
  options: { artifact?: string | Uint8Array; idempotencyKey?: string } = {},
): Promise<RuntimeEvent> {
  let verification = VerificationResultSchema.parse(
    options.artifact !== undefined && verificationInput.artifactRef === null
      ? { ...verificationInput, artifactRef: "pending-artifact" }
      : verificationInput,
  );
  if (options.artifact !== undefined) {
    const artifactRef = await log.artifacts.put(options.artifact);
    verification = VerificationResultSchema.parse({ ...verification, artifactRef });
  }
  const event = await log.append({
    type: "verification.recorded",
    source: "symphony-core",
    aggregate: { kind: "verification", id: verification.id },
    attemptId: verification.attemptId,
    payload: { verification },
    idempotencyKey:
      options.idempotencyKey ?? `verification:${verification.id}:${verification.inputFingerprint}`,
  });
  return event;
}

export async function recordReview(
  log: EventLog,
  reviewInput: ReviewDecision,
  idempotencyKey?: string,
): Promise<RuntimeEvent> {
  const review = ReviewDecisionSchema.parse(reviewInput);
  const event = await log.append({
    type: "review.decided",
    source: "human",
    aggregate: { kind: "review", id: review.id },
    attemptId: review.attemptId,
    payload: { review },
    idempotencyKey: idempotencyKey ?? `review:${review.id}`,
  });
  if (review.decision === "merge_close") {
    const attempt = log.projection.getAttempt(review.attemptId);
    const task = attempt ? log.projection.getTask(attempt.taskId) : undefined;
    if (task && task.workflowStatus === "in_review") {
      await recordTaskStatus(log, task.id, "done", null, {
        source: "human",
        idempotencyKey: `workflow-status:review:${review.id}:done`,
      });
    }
  }
  return event;
}

export async function recordIntervention(
  log: EventLog,
  interventionInput: Intervention,
  idempotencyKey?: string,
): Promise<RuntimeEvent> {
  const intervention = InterventionSchema.parse(interventionInput);
  return log.append({
    type: intervention.state === "pending" ? "intervention.requested" : "intervention.resolved",
    source: "adapter",
    aggregate: { kind: "intervention", id: intervention.id },
    attemptId: intervention.attemptId,
    payload: { intervention },
    idempotencyKey: idempotencyKey ?? `intervention:${intervention.id}:${intervention.state}`,
  });
}
