import type {
  AttemptOutcome,
  AttemptSnapshot,
  DisplayState,
  ExecutionState,
  IssuePhase,
  RuntimeTask,
  TaskSummary,
} from "@symphoneer/contracts";

export function deriveRuntimeTask(
  task: TaskSummary,
  executionState: ExecutionState,
  attempts: readonly AttemptSnapshot[],
): RuntimeTask {
  const issuePhase = deriveIssuePhase(task);
  const latest = attempts.toSorted(
    (left, right) =>
      right.sequence - left.sequence || right.startedAt.localeCompare(left.startedAt),
  )[0];
  return {
    ...task,
    issuePhase,
    blocked: task.labels.includes("symphoneer:blocked"),
    executionState,
    displayState: deriveDisplayState(issuePhase, executionState),
    lastAttemptOutcome: latestOutcome(latest),
  };
}

function deriveIssuePhase(task: TaskSummary): IssuePhase {
  if (task.state.toLowerCase() === "closed") return "closed";
  if (task.labels.includes("symphoneer:review")) return "review";
  if (task.labels.includes("symphoneer:ready")) return "ready";
  return "backlog";
}

function deriveDisplayState(issuePhase: IssuePhase, executionState: ExecutionState): DisplayState {
  if (issuePhase === "closed") return "done";
  if (executionState !== "idle") return "in_progress";
  if (issuePhase === "review") return "in_review";
  return issuePhase;
}

function latestOutcome(attempt: AttemptSnapshot | undefined): AttemptOutcome | null {
  if (!attempt?.finishedAt) return null;
  if (attempt.status === "succeeded") return "succeeded";
  if (attempt.status === "interrupted" || attempt.status === "canceled_by_reconciliation") {
    return "interrupted";
  }
  return "failed";
}
