import type { TaskSummary } from "@symphoneer/contracts";

import type { RetryEntry } from "./types.ts";

export const normalizeState = (value: string) => value.trim().toLowerCase();

export function retryDelayMs(
  kind: RetryEntry["kind"],
  attempt: number,
  maxRetryBackoffMs: number,
): number {
  if (kind === "continuation") return 1_000;
  return Math.min(10_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 52), maxRetryBackoffMs);
}

export function sortTasksForDispatch(tasks: readonly TaskSummary[]): TaskSummary[] {
  const priority = (task: TaskSummary) =>
    task.priority != null && task.priority >= 1 && task.priority <= 4
      ? task.priority
      : Number.POSITIVE_INFINITY;
  const createdAt = (task: TaskSummary) =>
    task.createdAt == null ? Number.POSITIVE_INFINITY : Date.parse(task.createdAt);

  return [...tasks].sort(
    (left, right) =>
      priority(left) - priority(right) ||
      createdAt(left) - createdAt(right) ||
      left.identifier.localeCompare(right.identifier),
  );
}
