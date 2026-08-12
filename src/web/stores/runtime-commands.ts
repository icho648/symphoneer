import type { AttemptSnapshot, RuntimeCommand, TaskSummary } from "@symphoneer/contracts";

export type CodexRunSettings = Pick<
  Extract<RuntimeCommand, { kind: "start_run" }>,
  "effort" | "model" | "sandbox"
>;

export type CommandIntent =
  | { kind: "pause_attempt" }
  | { kind: "retry_attempt" }
  | { kind: "handoff_attempt" }
  | ({ kind: "send_attempt_input"; prompt: string } & CodexRunSettings)
  | { kind: "delete_attempt" }
  | { kind: "enable_task_dispatch" }
  | {
      kind: "respond_intervention";
      interventionId: string;
      decision: "approved" | "rejected" | "answered" | "canceled";
      response?: string;
    }
  | ({ kind: "start_run"; mode: "single-agent"; task: TaskSummary } & CodexRunSettings);

export function requiresAttempt(intent: CommandIntent): boolean {
  return [
    "pause_attempt",
    "retry_attempt",
    "handoff_attempt",
    "send_attempt_input",
    "delete_attempt",
  ].includes(intent.kind);
}

export function buildCommand(
  intent: CommandIntent,
  common: { expectedEventSequence: number; idempotencyKey: string; projectId?: string },
  attempt: AttemptSnapshot | undefined,
  task: TaskSummary | null,
): RuntimeCommand | null {
  switch (intent.kind) {
    case "delete_attempt":
      if (!attempt) return null;
      return {
        ...intent,
        ...common,
        attemptId: attempt.id,
        expectedAttemptUpdatedAt: attempt.updatedAt,
        confirmDiscard: true,
      };
    case "pause_attempt":
    case "retry_attempt":
    case "handoff_attempt":
    case "send_attempt_input":
      if (!attempt) return null;
      return {
        ...intent,
        ...common,
        attemptId: attempt.id,
        expectedAttemptUpdatedAt: attempt.updatedAt,
      };
    case "respond_intervention":
      return { ...intent, ...common, decidedBy: "local-human" };
    case "enable_task_dispatch":
      if (!task) return null;
      return { ...intent, ...common, taskId: task.id };
    default:
      return { ...intent, ...common };
  }
}
