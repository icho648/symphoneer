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
  if (command.kind === "handoff_attempt") {
    return "Attempt paused and handed off to Codex.";
  }
  if (command.kind === "send_attempt_input") return "Input sent to the active Codex session.";
  if (command.kind === "sync_attempt_session") return "Codex session history synchronized.";
  if (command.kind === "return_attempt_control") {
    return "Codex session synchronized and control returned to Symphoneer.";
  }
  if (command.kind === "delete_attempt") {
    return "Attempt and its managed Workspace deleted.";
  }
  if (command.kind === "record_review") return "Human review decision recorded.";
  if (command.kind === "set_task_status") return "Task workflow status updated.";
  if (command.kind === "enable_task_dispatch") return "Task enabled for dispatch in the Tracker.";
  if (command.kind === "refresh_tracker") return "Tracker projection refreshed.";
  if (command.kind === "start_run") return "Orchestration started.";
  if (command.kind === "approve_plan") return "Workflow plan approved.";
  if (command.kind === "reject_plan") return "Workflow plan rejected.";
  if (command.kind === "revise_plan") return "Workflow plan revision requested.";
  if (command.kind === "final_decision") return "Workflow final decision recorded.";
  if (command.kind === "reset_team_run") return "Workflow reset.";
  if (command.kind === "stop_team_session") return "Workflow stop requested.";
  if (command.kind === "resume_team_session") return "Workflow resume requested.";
  if (command.kind === "answer_team_input") return "Workflow human input recorded.";
  return "Intervention decision recorded without persisting the response text.";
}

export function isCommandEvent(event: RuntimeEvent, kind: RuntimeCommand["kind"]): boolean {
  const payload = eventPayload(event.event);
  return payload.commandKind === kind;
}

export function asJsonPayload(value: unknown): DomainEventEnvelope["payload"] {
  return JSON.parse(JSON.stringify(value)) as DomainEventEnvelope["payload"];
}
