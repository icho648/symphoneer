import {
  type AttemptSnapshot,
  AttemptSnapshotSchema,
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
import { attemptEventType, workspaceEventType } from "./helpers.ts";

export async function recordTask(
  log: EventLog,
  taskInput: TaskSummary,
  idempotencyKey?: string,
): Promise<RuntimeEvent> {
  const task = TaskSummarySchema.parse(taskInput);
  return log.append({
    type: "task.upserted",
    source: "adapter",
    aggregate: { kind: "task", id: task.id },
    taskId: task.id,
    payload: { task },
    idempotencyKey: idempotencyKey ?? `task:${task.id}:${task.updatedAt ?? ""}`,
  });
}

export async function recordAttempt(
  log: EventLog,
  attemptInput: AttemptSnapshot,
  options: { workspace?: WorkspaceReference; idempotencyKey?: string } = {},
): Promise<RuntimeEvent> {
  const attempt = AttemptSnapshotSchema.parse(attemptInput);
  const workspace = options.workspace
    ? WorkspaceReferenceSchema.parse(options.workspace)
    : undefined;
  return log.append({
    type: attemptEventType(attempt),
    source: "symphony-core",
    aggregate: { kind: "attempt", id: attempt.id },
    taskId: attempt.taskId,
    attemptId: attempt.id,
    payload: { attempt, ...(workspace ? { workspace } : {}) },
    idempotencyKey: options.idempotencyKey ?? `attempt:${attempt.id}:${attempt.updatedAt}`,
  });
}

export async function recordWorkspace(
  log: EventLog,
  workspaceInput: WorkspaceReference,
  idempotencyKey?: string,
): Promise<RuntimeEvent> {
  const workspace = WorkspaceReferenceSchema.parse(workspaceInput);
  return log.append({
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
  return log.append({
    type: "verification.recorded",
    source: "symphony-core",
    aggregate: { kind: "verification", id: verification.id },
    attemptId: verification.attemptId,
    payload: { verification },
    idempotencyKey:
      options.idempotencyKey ?? `verification:${verification.id}:${verification.inputFingerprint}`,
  });
}

export async function recordReview(
  log: EventLog,
  reviewInput: ReviewDecision,
  idempotencyKey?: string,
): Promise<RuntimeEvent> {
  const review = ReviewDecisionSchema.parse(reviewInput);
  return log.append({
    type: "review.decided",
    source: "human",
    aggregate: { kind: "review", id: review.id },
    attemptId: review.attemptId,
    payload: { review },
    idempotencyKey: idempotencyKey ?? `review:${review.id}`,
  });
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
