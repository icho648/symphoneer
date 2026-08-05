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
import type { EventLog } from "./event-log.ts";
import { commandMessage, isCommandEvent } from "./helpers.ts";

export async function executeCommand(
  log: EventLog,
  commandInput: unknown,
  snapshot: () => RuntimeSnapshot,
  now: () => Date,
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

    const stored =
      command.kind === "respond_intervention"
        ? await respondToIntervention(log, command, now)
        : await requestAttemptCommand(log, command);
    return commandResult(stored.sequence, commandMessage(command), snapshot());
  });
}

async function requestAttemptCommand(
  log: EventLog,
  command: Exclude<RuntimeCommand, { kind: "respond_intervention" }>,
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
