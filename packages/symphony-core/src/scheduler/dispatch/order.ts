import type { TaskSummary } from "@symphoneer/contracts";

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
