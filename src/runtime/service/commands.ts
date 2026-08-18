import {
  CONTRACT_SCHEMA_VERSION,
  type ExecutionSession,
  InterventionSchema,
  ReviewDecisionSchema,
  type RuntimeCommand,
  type RuntimeCommandResult,
  RuntimeCommandResultSchema,
  RuntimeCommandSchema,
  type RuntimeEvent,
  type RuntimeSnapshot,
  TaskSummarySchema,
} from "@symphoneer/contracts";
import { RuntimeError } from "../errors.ts";
import type { OrchestrationMode } from "../orchestration/mode.ts";
import type { WorkflowOrchestrator } from "../team/index.ts";
import type { TrackerSyncResult } from "../tracker/synchronizer.ts";
import type { Tracker } from "../tracker/tracker.ts";
import type { EventLog } from "./event-log.ts";
import { commandMessage, isCommandEvent } from "./helpers.ts";
import { recordAttempt, recordExecutionSession } from "./recording.ts";

export type StartRunCommand = Extract<RuntimeCommand, { kind: "start_run" }>;
export type TeamCommand = Exclude<
  RuntimeCommand,
  {
    kind:
      | "pause_attempt"
      | "retry_attempt"
      | "handoff_attempt"
      | "send_attempt_input"
      | "sync_attempt_session"
      | "return_attempt_control"
      | "delete_attempt"
      | "respond_intervention"
      | "record_review"
      | "enable_task_dispatch"
      | "refresh_tracker"
      | "start_run";
  }
>;
export type WorkflowCommand = StartRunCommand | TeamCommand;

export type TeamCommandHandler = (
  command: WorkflowCommand,
  log: EventLog,
  orchestrator: WorkflowOrchestrator,
) => Promise<RuntimeEvent>;
export type WorkflowCommandHandler = TeamCommandHandler;

export async function executeCommand(
  log: EventLog,
  commandInput: unknown,
  snapshot: () => RuntimeSnapshot,
  now: () => Date,
  workflow?: { orchestrator: WorkflowOrchestrator; handle: TeamCommandHandler },
  orchestration?: OrchestrationMode,
  tracker?: Tracker,
  refreshTracker?: () => Promise<TrackerSyncResult>,
): Promise<RuntimeCommandResult> {
  log.requireStarted();
  const parsed = RuntimeCommandSchema.safeParse(commandInput);
  if (!parsed.success) {
    throw new RuntimeError("invalid_request", "Runtime command has an invalid shape");
  }
  const command = parsed.data;
  if (command.kind === "refresh_tracker") {
    return executeRefreshTrackerCommand(log, command, snapshot, refreshTracker);
  }
  return log.withMutation(async () => {
    const previous = log.idempotent(command.idempotencyKey);
    if (previous) {
      if (!isCommandEvent(previous, command.kind)) {
        throw new RuntimeError("conflict", "Idempotency key belongs to another operation");
      }
      return commandResult(previous.sequence, commandMessage(command), snapshot());
    }
    if (
      command.expectedEventSequence !== undefined &&
      command.expectedEventSequence !== log.lastSequence
    ) {
      throw new RuntimeError("conflict", "Runtime projection changed before this command was read");
    }

    let stored: RuntimeEvent;
    if (command.kind === "enable_task_dispatch") {
      stored = await enableTaskDispatchCommand(log, command, tracker);
    } else if (command.kind === "start_run") {
      if (!workflow) throw new RuntimeError("unsupported", "Workflow commands are not enabled");
      const task = log.projection.getTask(command.task.id);
      if (!task) throw new RuntimeError("not_found", `Task ${command.task.id} was not found`);
      if (!task.dispatchable) {
        throw new RuntimeError("conflict", "Task is not eligible for execution");
      }
      const active = log.projection
        .attemptsForTask(task.id)
        .find(
          (attempt) =>
            attempt.controller === "codex" ||
            (attempt.finishedAt == null && attempt.status !== "paused"),
        );
      if (active) {
        throw new RuntimeError("conflict", `Task ${task.identifier} already has an active Attempt`);
      }
      stored = await workflow.handle({ ...command, task }, log, workflow.orchestrator);
    } else if (isTeamCommand(command)) {
      if (!workflow) throw new RuntimeError("unsupported", "Workflow commands are not enabled");
      stored = await workflow.handle(command, log, workflow.orchestrator);
    } else if (command.kind === "respond_intervention") {
      stored = await respondToIntervention(log, command, now, orchestration);
    } else if (command.kind === "record_review") {
      stored = await recordReviewCommand(log, command, now, orchestration);
    } else {
      stored = await requestAttemptCommand(log, command, now, orchestration);
    }
    return commandResult(stored.sequence, commandMessage(command), snapshot());
  });
}

async function executeRefreshTrackerCommand(
  log: EventLog,
  command: Extract<RuntimeCommand, { kind: "refresh_tracker" }>,
  snapshot: () => RuntimeSnapshot,
  refreshTracker?: () => Promise<TrackerSyncResult>,
): Promise<RuntimeCommandResult> {
  const previous = log.idempotent(command.idempotencyKey);
  if (previous) {
    if (!isCommandEvent(previous, command.kind)) {
      throw new RuntimeError("conflict", "Idempotency key belongs to another operation");
    }
    return commandResult(previous.sequence, commandMessage(command), snapshot());
  }
  if (
    command.expectedEventSequence !== undefined &&
    command.expectedEventSequence !== log.lastSequence
  ) {
    throw new RuntimeError("conflict", "Runtime projection changed before this command was read");
  }
  if (!refreshTracker) {
    throw new RuntimeError("unsupported", "Tracker full synchronization is not configured");
  }
  const result = await refreshTracker();
  const stored = await log.append({
    type: "runtime.command.requested",
    source: "human",
    aggregate: { kind: "task", id: "tracker:refresh" },
    idempotencyKey: command.idempotencyKey,
    payload: {
      commandKind: command.kind,
      taskCount: result.taskCount,
      pageCount: result.pageCount,
    },
  });
  return commandResult(stored.sequence, commandMessage(command), snapshot());
}

async function enableTaskDispatchCommand(
  log: EventLog,
  command: Extract<RuntimeCommand, { kind: "enable_task_dispatch" }>,
  tracker?: Tracker,
): Promise<RuntimeEvent> {
  const task = log.projection.getTask(command.taskId);
  if (!task) throw new RuntimeError("not_found", `Task ${command.taskId} was not found`);
  if (!tracker?.enableTaskDispatch) {
    throw new RuntimeError("unsupported", "Tracker dispatch updates are not configured");
  }
  const updated = TaskSummarySchema.parse(
    (await tracker.enableTaskDispatch(task.source.nativeId)).task,
  );
  if (updated.id !== task.id) {
    throw new RuntimeError("conflict", "Tracker returned a different Task after dispatch update");
  }
  await log.commit({
    type: "task.changed",
    source: "adapter",
    aggregate: { kind: "task", id: updated.id },
    taskId: updated.id,
    idempotencyKey: `enable-task-dispatch:change:${command.idempotencyKey}`,
    payload: { taskId: updated.id },
  });
  log.projection.recordTask(updated);
  return log.commit({
    type: "runtime.command.requested",
    source: "human",
    aggregate: { kind: "task", id: updated.id },
    taskId: updated.id,
    idempotencyKey: command.idempotencyKey,
    payload: { commandKind: command.kind, taskId: updated.id },
  });
}

function isTeamCommand(command: RuntimeCommand): command is WorkflowCommand {
  return (
    command.kind === "start_run" ||
    command.kind === "approve_plan" ||
    command.kind === "reject_plan" ||
    command.kind === "revise_plan" ||
    command.kind === "stop_team_session" ||
    command.kind === "resume_team_session" ||
    command.kind === "answer_team_input" ||
    command.kind === "final_decision" ||
    command.kind === "reset_team_run"
  );
}

async function requestAttemptCommand(
  log: EventLog,
  command: Extract<
    RuntimeCommand,
    {
      kind:
        | "pause_attempt"
        | "retry_attempt"
        | "handoff_attempt"
        | "send_attempt_input"
        | "sync_attempt_session"
        | "return_attempt_control"
        | "delete_attempt";
    }
  >,
  now: () => Date,
  orchestration?: OrchestrationMode,
): Promise<RuntimeEvent> {
  const attempt = log.projection.getAttempt(command.attemptId);
  if (!attempt) throw new RuntimeError("not_found", `Attempt ${command.attemptId} was not found`);
  if (command.expectedAttemptUpdatedAt && attempt.updatedAt !== command.expectedAttemptUpdatedAt) {
    throw new RuntimeError("conflict", "Attempt changed before this command was read");
  }
  if (
    command.kind === "pause_attempt" &&
    attempt.finishedAt !== undefined &&
    attempt.finishedAt !== null
  ) {
    throw new RuntimeError("conflict", "Terminal Attempts cannot receive this command");
  }
  if (command.kind === "pause_attempt") {
    await orchestration?.pause?.({ attempt, log });
  } else if (command.kind === "retry_attempt") {
    const active = log.projection
      .attemptsForTask(attempt.taskId)
      .find(
        (candidate) =>
          candidate.id !== attempt.id &&
          (candidate.controller === "codex" ||
            (candidate.finishedAt == null && candidate.status !== "paused")),
      );
    if (attempt.controller === "codex" || active) {
      throw new RuntimeError("conflict", "Task already has an active Attempt controller");
    }
    await orchestration?.retry?.({ attempt, log });
  } else if (command.kind === "send_attempt_input") {
    if (attempt.controller === "codex") {
      throw new RuntimeError(
        "conflict",
        "Codex controls this Attempt; use Return to Automation before sending input",
      );
    }
    if (!orchestration?.input) {
      throw new RuntimeError("unsupported", "Codex input is not configured");
    }
    await orchestration.input({
      attempt: log.projection.getAttempt(attempt.id) ?? attempt,
      prompt: command.prompt,
      ...(command.model ? { model: command.model } : {}),
      ...(command.sandbox ? { sandbox: command.sandbox } : {}),
      ...(command.effort ? { effort: command.effort } : {}),
      log,
    });
  } else if (command.kind === "handoff_attempt") {
    if (!attempt.providerSession) {
      throw new RuntimeError("conflict", "Attempt has no Codex session to hand off");
    }
    if (!orchestration?.handoff) {
      throw new RuntimeError("unsupported", "Codex handoff is not configured");
    }
    await orchestration.handoff({ attempt, log });
    await setAttemptController(log, attempt.id, "codex", now);
  } else if (command.kind === "sync_attempt_session") {
    await syncAttemptSession(log, attempt, orchestration);
  } else if (command.kind === "return_attempt_control") {
    if (attempt.controller !== "codex") {
      throw new RuntimeError("conflict", "Attempt is already controlled by Symphoneer");
    }
    const session = await syncAttemptSession(log, attempt, orchestration);
    if (session?.turns.at(-1)?.status === "inProgress") {
      throw new RuntimeError("conflict", "Codex is still processing this Attempt");
    }
    if (!orchestration?.returnControl) {
      throw new RuntimeError("unsupported", "Return to Automation is not configured");
    }
    await orchestration.returnControl({ attempt, log });
    await setAttemptController(log, attempt.id, "symphoneer", now);
  } else if (command.kind === "delete_attempt") {
    if (!orchestration?.delete) {
      throw new RuntimeError("unsupported", "Attempt Workspace deletion is not configured");
    }
    await orchestration.delete({ attempt, log });
    const deleted = await log.commit({
      type: "attempt.deleted",
      source: "human",
      aggregate: { kind: "attempt", id: attempt.id },
      taskId: attempt.taskId,
      attemptId: attempt.id,
      idempotencyKey: command.idempotencyKey,
      payload: {
        commandKind: command.kind,
        attemptId: attempt.id,
        taskId: attempt.taskId,
      },
    });
    await log.attempts.delete(attempt.id);
    return deleted;
  }
  return log.commit({
    type: "runtime.command.requested",
    source: "human",
    aggregate: { kind: "attempt", id: attempt.id },
    taskId: attempt.taskId,
    attemptId: attempt.id,
    idempotencyKey: command.idempotencyKey,
    payload: {
      commandKind: command.kind,
      attemptId: attempt.id,
      taskId: attempt.taskId,
    },
  });
}

async function syncAttemptSession(
  log: EventLog,
  attempt: Parameters<NonNullable<OrchestrationMode["sync"]>>[0]["attempt"],
  orchestration?: OrchestrationMode,
): Promise<ExecutionSession | null> {
  if (!orchestration?.sync) {
    throw new RuntimeError("unsupported", "Codex session synchronization is not configured");
  }
  const session = await orchestration.sync({ attempt, log });
  if (session) await recordExecutionSession(log, session, true);
  return session;
}

async function setAttemptController(
  log: EventLog,
  attemptId: string,
  controller: "symphoneer" | "codex",
  now: () => Date,
): Promise<void> {
  const current = log.projection.getAttempt(attemptId);
  if (!current || current.controller === controller) return;
  const timestamp = new Date(
    Math.max(now().getTime(), Date.parse(current.updatedAt) + 1),
  ).toISOString();
  await recordAttempt(log, { ...current, controller, updatedAt: timestamp }, { commit: true });
}

async function recordReviewCommand(
  log: EventLog,
  command: Extract<RuntimeCommand, { kind: "record_review" }>,
  now: () => Date,
  orchestration?: OrchestrationMode,
): Promise<RuntimeEvent> {
  const attempt = log.projection.getAttempt(command.attemptId);
  if (!attempt) throw new RuntimeError("not_found", `Attempt ${command.attemptId} was not found`);
  if (command.expectedAttemptUpdatedAt && attempt.updatedAt !== command.expectedAttemptUpdatedAt) {
    throw new RuntimeError("conflict", "Attempt changed before this command was read");
  }
  const review = ReviewDecisionSchema.parse({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: `review:${command.idempotencyKey}`,
    attemptId: attempt.id,
    decision: command.decision,
    decidedBy: command.decidedBy,
    decidedAt: now().toISOString(),
    evidenceIds: command.evidenceIds,
    ...(command.nextAction === undefined ? {} : { nextAction: command.nextAction }),
  });
  const task = log.projection.getTask(attempt.taskId);
  if (!task) throw new RuntimeError("not_found", `Task ${attempt.taskId} was not found`);
  const latestAttempt = log.projection
    .attemptsForTask(task.id)
    .sort(
      (left, right) =>
        right.sequence - left.sequence || right.startedAt.localeCompare(left.startedAt),
    )[0];
  if (command.decision === "merge_close" && latestAttempt?.id !== attempt.id) {
    throw new RuntimeError("conflict", "Only the latest Attempt can complete its Task");
  }
  if (command.decision === "merge_close" && !task.labels.includes("symphoneer:review")) {
    throw new RuntimeError("conflict", "Only In review tasks can be marked Done");
  }
  const stored = await log.commit({
    type: "review.decided",
    source: "human",
    aggregate: { kind: "review", id: review.id },
    taskId: attempt.taskId,
    attemptId: attempt.id,
    idempotencyKey: command.idempotencyKey,
    payload: { commandKind: command.kind, review },
  });
  await orchestration?.review?.({ review, log });
  return stored;
}

async function respondToIntervention(
  log: EventLog,
  command: Extract<RuntimeCommand, { kind: "respond_intervention" }>,
  now: () => Date,
  orchestration?: OrchestrationMode,
): Promise<RuntimeEvent> {
  const current = log.projection.getIntervention(command.interventionId);
  if (!current) {
    throw new RuntimeError("not_found", `Intervention ${command.interventionId} was not found`);
  }
  if (current.state !== "pending") {
    throw new RuntimeError("conflict", "Intervention is already resolved");
  }
  await orchestration?.respond?.({
    interventionId: current.id,
    requestRef: current.requestRef,
    decision: {
      decision: command.decision,
      ...(command.response === undefined ? {} : { response: command.response }),
    },
  });
  const intervention =
    command.decision === "canceled"
      ? InterventionSchema.parse({ ...current, state: "canceled" })
      : InterventionSchema.parse({
          ...current,
          state: "resolved",
          resolution: {
            decidedBy: command.decidedBy,
            decidedAt: now().toISOString(),
            decision: command.decision,
            ...(command.response === undefined ? {} : { response: command.response }),
          },
        });
  return log.commit({
    type: "intervention.resolved",
    source: "human",
    aggregate: { kind: "intervention", id: intervention.id },
    attemptId: intervention.attemptId,
    idempotencyKey: command.idempotencyKey,
    payload: {
      commandKind: command.kind,
      intervention,
    },
  });
}

function commandResult(
  eventSequence: number,
  message: string,
  snapshot: RuntimeSnapshot,
): RuntimeCommandResult {
  return RuntimeCommandResultSchema.parse({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    accepted: true,
    eventSequence,
    message,
    snapshot,
  });
}
