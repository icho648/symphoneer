import {
  CONTRACT_SCHEMA_VERSION,
  InterventionSchema,
  type RuntimeCommand,
  type RuntimeCommandResult,
  RuntimeCommandResultSchema,
  RuntimeCommandSchema,
  type RuntimeEvent,
  type RuntimeSnapshot,
} from "@symphoneer/contracts";
import { RuntimeError } from "../errors.ts";
import type { WorkflowOrchestrator } from "../team/index.ts";
import type { EventLog } from "./event-log.ts";
import { commandMessage, isCommandEvent } from "./helpers.ts";

export type TeamCommand = Exclude<
  RuntimeCommand,
  { kind: "pause_attempt" | "retry_attempt" | "respond_intervention" }
>;

export type TeamCommandHandler = (
  command: TeamCommand,
  log: EventLog,
  orchestrator: WorkflowOrchestrator,
) => Promise<RuntimeEvent>;
export type WorkflowCommand = TeamCommand;
export type WorkflowCommandHandler = TeamCommandHandler;

export async function executeCommand(
  log: EventLog,
  commandInput: unknown,
  snapshot: () => RuntimeSnapshot,
  now: () => Date,
  workflow?: { orchestrator: WorkflowOrchestrator; handle: TeamCommandHandler },
): Promise<RuntimeCommandResult> {
  log.requireStarted();
  const parsed = RuntimeCommandSchema.safeParse(commandInput);
  if (!parsed.success) {
    throw new RuntimeError("invalid_request", "Runtime command has an invalid shape");
  }
  const command = parsed.data;
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
    if (isTeamCommand(command)) {
      if (!workflow) throw new RuntimeError("unsupported", "Workflow commands are not enabled");
      stored = await workflow.handle(command, log, workflow.orchestrator);
    } else if (command.kind === "respond_intervention") {
      stored = await respondToIntervention(log, command, now);
    } else {
      stored = await requestAttemptCommand(log, command);
    }
    return commandResult(stored.sequence, commandMessage(command), snapshot());
  });
}

function isTeamCommand(command: RuntimeCommand): command is TeamCommand {
  return (
    command.kind === "start_team_run" ||
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
  command: Exclude<RuntimeCommand, TeamCommand | { kind: "respond_intervention" }>,
): Promise<RuntimeEvent> {
  const attempt = log.projection.getAttempt(command.attemptId);
  if (!attempt) throw new RuntimeError("not_found", `Attempt ${command.attemptId} was not found`);
  if (command.expectedAttemptUpdatedAt && attempt.updatedAt !== command.expectedAttemptUpdatedAt) {
    throw new RuntimeError("conflict", "Attempt changed before this command was read");
  }
  if (
    command.kind !== "retry_attempt" &&
    attempt.finishedAt !== undefined &&
    attempt.finishedAt !== null
  ) {
    throw new RuntimeError("conflict", "Terminal Attempts cannot receive this command");
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

async function respondToIntervention(
  log: EventLog,
  command: Extract<RuntimeCommand, { kind: "respond_intervention" }>,
  now: () => Date,
): Promise<RuntimeEvent> {
  const current = log.projection.getIntervention(command.interventionId);
  if (!current) {
    throw new RuntimeError("not_found", `Intervention ${command.interventionId} was not found`);
  }
  if (current.state !== "pending") {
    throw new RuntimeError("conflict", "Intervention is already resolved");
  }
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
