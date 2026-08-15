import type { AttemptSnapshot, RuntimeProject, TaskSummary } from "@symphoneer/contracts";

export function taskBelongsToProject(task: TaskSummary, project: RuntimeProject): boolean {
  return task.projectId === project.id;
}

export function taskNeedsAttention(task: TaskSummary): boolean {
  return task.blocked !== null || task.workflowStatus === "in_review";
}

export function taskCanStart(task: TaskSummary, attempt: AttemptSnapshot | null): boolean {
  return attempt === null && task.workflowStatus === "backlog" && task.dispatchable;
}

export function compareExecutionPriority(left: TaskSummary, right: TaskSummary): number {
  const rank = (task: TaskSummary): number => {
    if (task.blocked) return 0;
    return {
      in_review: 1,
      in_progress: 2,
      backlog: 3,
      done: 4,
    }[task.workflowStatus];
  };
  return rank(left) - rank(right) || left.identifier.localeCompare(right.identifier);
}
