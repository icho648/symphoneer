import {
  type ActivityOccurrence,
  type AttemptSnapshot,
  AttemptSnapshotSchema,
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
  type WorkspaceReference,
  WorkspaceReferenceSchema,
} from "@symphoneer/contracts";
import type { EventLog } from "./event-log.ts";
import { workspaceEventType } from "./helpers.ts";

export async function recordTask(
  log: EventLog,
  taskInput: TaskSummary,
  idempotencyKey?: string,
  commit = false,
): Promise<RuntimeEvent> {
  const task = TaskSummarySchema.parse(taskInput);
  const event = await (commit ? log.commit : log.append).call(log, {
    type: "task.changed",
    source: "adapter",
    aggregate: { kind: "task", id: task.id },
    taskId: task.id,
    payload: { taskId: task.id },
    idempotencyKey: `task-change:${idempotencyKey ?? `${task.id}:${task.updatedAt ?? ""}`}`,
  });
  log.projection.recordTask(task);
  return event;
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
  await log.attempts.upsert(attempt);
  const event = await (options.commit ? log.commit : log.append).call(log, {
    type: "attempt.changed",
    source: "symphony-core",
    aggregate: { kind: "attempt", id: attempt.id },
    taskId: attempt.taskId,
    attemptId: attempt.id,
    payload: { attemptId: attempt.id },
    idempotencyKey: `attempt-change:${options.idempotencyKey ?? `${attempt.id}:${attempt.updatedAt}`}`,
  });
  log.projection.recordAttempt(attempt);
  if (workspace) log.projection.recordWorkspace(workspace);
  return event;
}

export async function recordExecutionActivity(
  log: EventLog,
  activityInput: ExecutionActivity,
  commit = false,
): Promise<RuntimeEvent> {
  const activity = ExecutionActivitySchema.parse(activityInput);
  const event = await (commit ? log.commit : log.append).call(log, {
    type: "attempt.activity.changed",
    source: "adapter",
    aggregate: { kind: "attempt", id: activity.attemptId },
    attemptId: activity.attemptId,
    payload: { activityId: activity.id },
    idempotencyKey: `activity-change:${activity.id}:${activity.status}:${activity.occurredAt}`,
  });
  log.projection.recordActivity(activity);
  return event;
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
  const event = await (commit ? log.commit : log.append).call(log, {
    type: "attempt.session.changed",
    source: "adapter",
    aggregate: { kind: "attempt", id: session.attemptId },
    attemptId: session.attemptId,
    payload: { attemptId: session.attemptId },
    idempotencyKey: `session-change:${session.attemptId}:${session.threadId}:${session.capturedAt}`,
  });
  log.projection.recordSession(session);
  return event;
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
