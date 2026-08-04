import type { AttemptSnapshot, TaskSummary } from "@symphoneer/contracts";

export type BoardColumn = "READY" | "RUNNING" | "REVIEW" | "BLOCKED";

const activeStatuses = new Set([
  "preparing_workspace",
  "building_prompt",
  "launching_agent",
  "initializing_session",
  "streaming_turn",
  "finishing",
]);

export function taskColumn(task: TaskSummary, attempts: readonly AttemptSnapshot[]): BoardColumn {
  const taskAttempts = attempts.filter((attempt) => attempt.taskId === task.id);
  if (taskAttempts.some((attempt) => activeStatuses.has(attempt.status))) return "RUNNING";
  if (task.labels.includes("symphoneer:review")) return "REVIEW";
  return task.dispatchable ? "READY" : "BLOCKED";
}
