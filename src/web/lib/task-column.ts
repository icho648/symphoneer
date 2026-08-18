import type { AttemptSnapshot, RuntimeProject, RuntimeTask } from "@symphoneer/contracts";

export function taskBelongsToProject(task: RuntimeTask, project: RuntimeProject): boolean {
  return task.projectId === project.id;
}

export function taskNeedsAttention(task: RuntimeTask): boolean {
  return task.blocked || task.displayState === "in_review" || task.lastAttemptOutcome === "failed";
}

export function taskCanStart(task: RuntimeTask, attempt: AttemptSnapshot | null): boolean {
  return attempt === null && task.displayState === "ready" && task.dispatchable;
}

export type TaskCardAction =
  | { kind: "recheck" }
  | { kind: "start" }
  | { kind: "mark_ready" }
  | { kind: "open_review"; href?: string };

export function taskCardAction(
  task: RuntimeTask,
  attempt: AttemptSnapshot | null,
): TaskCardAction | null {
  if (task.blocked) return { kind: "recheck" };
  if (task.displayState === "in_review") {
    const href = taskReviewHref(task);
    return href ? { kind: "open_review", href } : { kind: "open_review" };
  }
  if (taskCanStart(task, attempt)) return { kind: "start" };
  if (attempt === null && task.issuePhase === "backlog" && !task.dispatchable) {
    return { kind: "mark_ready" };
  }
  return null;
}

export function taskReviewHref(task: RuntimeTask): string | null {
  if (/\/pull\/\d+(?:\/|$)/.test(task.source.url)) return task.source.url;
  return linkedPullRequestUrl(task.body, repositoryFromTaskUrl(task.source.url));
}

function repositoryFromTaskUrl(url: string): string | null {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\//i);
  return match ? `${match[1]}/${match[2]}` : null;
}

function linkedPullRequestUrl(
  text: string | null | undefined,
  repository: string | null,
): string | null {
  if (!text || !repository) return null;
  const matches = text.matchAll(/https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/gi);
  for (const match of matches) {
    if (`${match[1]}/${match[2]}`.toLowerCase() === repository.toLowerCase()) {
      return `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`;
    }
  }
  return null;
}

export function visibleTaskLabels(labels: readonly string[]): string[] {
  return labels.filter((label) => !label.startsWith("symphoneer:"));
}

export function blockedReasonSummary(reason: string): string {
  const headline = reason.trim().split(/\r?\n/, 1)[0]?.split(": ", 1)[0] ?? reason;
  return headline.length > 72 ? `${headline.slice(0, 71)}…` : headline;
}

export function compareExecutionPriority(left: RuntimeTask, right: RuntimeTask): number {
  const rank = (task: RuntimeTask): number => {
    if (task.blocked) return 0;
    return {
      in_review: 1,
      in_progress: 2,
      ready: 3,
      backlog: 4,
      done: 5,
    }[task.displayState];
  };
  return rank(left) - rank(right) || left.identifier.localeCompare(right.identifier);
}
