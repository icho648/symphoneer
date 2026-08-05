import type {
  AttemptSnapshot,
  DomainEventEnvelope,
  RuntimeCommand,
  RuntimeEvent,
  WorkspaceReference,
} from "@symphoneer/contracts";
import type { DomainEventType } from "../events.ts";
import { eventPayload } from "../events.ts";

export function attemptEventType(
  attempt: AttemptSnapshot,
): Extract<DomainEventType, `attempt.${string}`> {
  if (attempt.status === "paused") return "attempt.paused";
  if (attempt.finishedAt !== undefined && attempt.finishedAt !== null) return "attempt.finished";
  if (attempt.activeTurn !== undefined && attempt.activeTurn !== null)
    return "attempt.turn_attached";
  return "attempt.recorded";
}

export function workspaceEventType(
  workspace: WorkspaceReference,
): Extract<DomainEventType, `workspace.${string}`> {
  if (workspace.state === "retained") return "workspace.retained";
  if (workspace.state === "released") return "workspace.released";
  return "workspace.recorded";
}

export function commandMessage(command: RuntimeCommand): string {
  if (command.kind === "pause_attempt") {
    return "Pause requested; the Runtime coordinator must interrupt the active Provider before recording a paused Attempt.";
  }
  if (command.kind === "retry_attempt") {
    return "Retry requested; the Runtime coordinator will decide the next Attempt from current state.";
  }
  return "Intervention decision recorded without persisting the response text.";
}

export function isCommandEvent(event: RuntimeEvent, kind: RuntimeCommand["kind"]): boolean {
  const payload = eventPayload(event.event);
  return payload.commandKind === kind;
}

export function asJsonPayload(value: unknown): DomainEventEnvelope["payload"] {
  return JSON.parse(JSON.stringify(value)) as DomainEventEnvelope["payload"];
}
