import type { AttemptSnapshot, TaskSummary, TeamRunSnapshot } from "@symphoneer/contracts";
import { CircleAlert, FolderOpen, MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { type Dictionary, interpolate } from "../../i18n/index.ts";

import {
  blockedReasonSummary,
  compareExecutionPriority,
  type TaskCardAction,
  taskBelongsToProject,
  taskCardAction,
  taskNeedsAttention,
  visibleTaskLabels,
} from "../../lib/task-column";
import { useWorkbench } from "../../stores/workbench.ts";
import { Button } from "../ui/button";

export function TaskColumns() {
  const {
    addProject,
    connection,
    deleteProject,
    dictionary,
    notice,
    projects,
    selectedTaskId,
    snapshot,
  } = useWorkbench(
    useShallow((state) => ({
      addProject: state.addProject,
      connection: state.connection,
      deleteProject: state.deleteProject,
      dictionary: state.dictionary,
      notice: state.notice,
      projects: state.projects,
      selectedTaskId: state.selectedTaskId,
      snapshot: state.snapshot,
    })),
  );
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [expandedCompleted, setExpandedCompleted] = useState<Record<string, boolean>>({});
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [selectingProject, setSelectingProject] = useState(false);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const tasks = snapshot?.tasks ?? [];
  const attempts = snapshot?.attempts ?? [];
  const visibleTasks = tasks
    .filter((task) => !attentionOnly || taskNeedsAttention(task))
    .sort(compareExecutionPriority);
  const activeCount = tasks.filter((task) => task.workflowStatus !== "done").length;
  const attentionCount = tasks.filter(taskNeedsAttention).length;

  return (
    <div className="task-overview-body">
      {connection === "offline" && (
        <div className="task-alert task-alert-danger" role="alert">
          <span className="task-alert-mark" aria-hidden="true">
            !
          </span>
          <span>{dictionary.board.runtimeUnavailable}</span>
        </div>
      )}

      <div className="task-overview-panel">
        <div className="task-overview-toolbar">
          <span className="task-queue-summary">
            {interpolate(dictionary.board.queue.summary, {
              total: tasks.length,
              active: activeCount,
              attention: attentionCount,
            })}
          </span>
          <div className="task-overview-toolbar-meta">
            <span className="task-overview-notice" aria-live="polite">
              {notice}
            </span>
            <Button
              aria-pressed={attentionOnly}
              size="sm"
              type="button"
              variant={attentionOnly ? "secondary" : "ghost"}
              onClick={() => setAttentionOnly((value) => !value)}
            >
              <CircleAlert aria-hidden="true" />
              {dictionary.board.queue.attention}
              {attentionCount > 0 && <span>{attentionCount}</span>}
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-testid="project-select-button"
              disabled={selectingProject}
              onClick={async () => {
                if (selectingProject) return;
                setSelectingProject(true);
                try {
                  await addProject();
                } finally {
                  setSelectingProject(false);
                }
              }}
            >
              <FolderOpen aria-hidden="true" />
              {selectingProject
                ? dictionary.board.config.selectingPath
                : dictionary.board.selectProject}
            </Button>
          </div>
        </div>

        <div className="project-group-list">
          {projects.map((project) => {
            const projectTasks = tasks.filter((task) => taskBelongsToProject(task, project));
            const projectVisibleTasks = visibleTasks.filter((task) =>
              taskBelongsToProject(task, project),
            );
            const projectActiveTasks = projectVisibleTasks.filter(
              (task) => task.workflowStatus !== "done",
            );
            const projectCompletedTasks = projectVisibleTasks.filter(
              (task) => task.workflowStatus === "done",
            );
            const expanded = expandedProjects[project.id] ?? true;
            const completedOpen = expandedCompleted[project.id] ?? false;
            const issuesId = `project-group-issues-${project.id}`;
            const titleId = `project-group-title-${project.id}`;
            return (
              <section className="project-group" key={project.id} aria-labelledby={titleId}>
                <div className="project-group-header">
                  <button
                    aria-label={
                      expanded
                        ? dictionary.board.projectGroup.collapse
                        : dictionary.board.projectGroup.expand
                    }
                    aria-controls={issuesId}
                    aria-expanded={expanded}
                    className="project-group-toggle"
                    type="button"
                    onClick={() =>
                      setExpandedProjects((current) => ({
                        ...current,
                        [project.id]: !expanded,
                      }))
                    }
                  >
                    <span className="project-group-chevron" aria-hidden="true">
                      {expanded ? "⌄" : "›"}
                    </span>
                    <span className="project-group-heading">
                      <strong id={titleId} title={project.projectRoot ?? undefined}>
                        {project.repository}
                      </strong>
                    </span>
                    <span className="project-group-count">
                      {!attentionOnly
                        ? projectTasks.length
                        : `${projectVisibleTasks.length}/${projectTasks.length}`}{" "}
                      {dictionary.board.projectGroup.issues}
                    </span>
                  </button>
                  <details className="project-group-menu">
                    <summary
                      aria-label={dictionary.board.projectGroup.more}
                      title={dictionary.board.projectGroup.more}
                    >
                      <MoreHorizontal aria-hidden="true" />
                    </summary>
                    <div className="project-group-menu-content">
                      <span className="project-group-menu-path">
                        {project.projectRoot || dictionary.board.config.projectPathPlaceholder}
                      </span>
                      <Button
                        className="project-group-delete"
                        disabled={deletingProjectId === project.id}
                        size="sm"
                        type="button"
                        variant="ghost"
                        onClick={(event) => {
                          event.currentTarget.closest("details")?.removeAttribute("open");
                          if (deletingProjectId) return;
                          setDeletingProjectId(project.id);
                          void deleteProject(project).finally(() => setDeletingProjectId(null));
                        }}
                      >
                        <Trash2 aria-hidden="true" />
                        {dictionary.board.projectGroup.delete}
                      </Button>
                    </div>
                  </details>
                </div>
                {expanded && (
                  <div className="project-group-issues" id={issuesId} role="tabpanel">
                    <div className="task-table-header" aria-hidden="true">
                      <span>{dictionary.board.projectGroup.issue}</span>
                      <span>{dictionary.board.projectGroup.title}</span>
                      <span>{dictionary.taskCard.workflowStatus}</span>
                      <span>{dictionary.board.projectGroup.action}</span>
                    </div>
                    <div className="task-card-grid">
                      {projectActiveTasks.map((task) => (
                        <TaskCard
                          attempt={latestAttempt(task, attempts)}
                          key={task.id}
                          selected={selectedTaskId === task.id}
                          task={task}
                        />
                      ))}
                      {projectCompletedTasks.length > 0 && (
                        <button
                          aria-expanded={completedOpen}
                          className="project-completed-toggle"
                          type="button"
                          onClick={() =>
                            setExpandedCompleted((current) => ({
                              ...current,
                              [project.id]: !completedOpen,
                            }))
                          }
                        >
                          <span aria-hidden="true">{completedOpen ? "⌄" : "›"}</span>
                          {interpolate(dictionary.board.queue.completed, {
                            count: projectCompletedTasks.length,
                          })}
                        </button>
                      )}
                      {completedOpen &&
                        projectCompletedTasks.map((task) => (
                          <TaskCard
                            attempt={latestAttempt(task, attempts)}
                            key={task.id}
                            selected={selectedTaskId === task.id}
                            task={task}
                          />
                        ))}
                      {projectVisibleTasks.length === 0 && (
                        <div className="task-overview-empty">
                          <span className="task-overview-empty-mark" aria-hidden="true">
                            ◌
                          </span>
                          <p>{dictionary.board.queue.noMatches}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
          {projects.length === 0 && (
            <div className="task-overview-empty">
              <span className="task-overview-empty-mark" aria-hidden="true">
                ◌
              </span>
              <p>{dictionary.board.projectGroup.noProjects}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function statusLabel(task: TaskSummary, dictionary: Dictionary): string {
  const labels = {
    backlog: dictionary.columns.backlog.label,
    in_progress: dictionary.columns.inProgress.label,
    in_review: dictionary.columns.inReview.label,
    done: dictionary.columns.done.label,
  } as const;
  return labels[task.workflowStatus];
}

function TaskCard({
  attempt,
  selected,
  task,
}: {
  attempt: AttemptSnapshot | null;
  selected: boolean;
  task: TaskSummary;
}) {
  const {
    connection,
    dictionary,
    openReview,
    openTask,
    sendCommand,
    setTaskStatus,
    snapshot,
    startWorkflow,
  } = useWorkbench(
    useShallow((state) => ({
      connection: state.connection,
      dictionary: state.dictionary,
      openReview: state.openReview,
      openTask: state.openTask,
      sendCommand: state.sendCommand,
      setTaskStatus: state.setTaskStatus,
      snapshot: state.snapshot,
      startWorkflow: state.startWorkflow,
    })),
  );
  const workflow = attempt
    ? latestWorkflow(snapshot?.teamRuns.filter((run) => run.attemptId === attempt.id) ?? [])
    : null;
  const warnings = [
    attempt?.failure ?? null,
    workflow?.pendingHumanInput ? dictionary.taskCard.humanAction : null,
  ].filter((value): value is string => value != null);
  const labels = visibleTaskLabels(task.labels);

  return (
    <article className={`task-card-wrap ${selected ? "is-selected" : ""}`}>
      <button
        aria-pressed={selected}
        className="task-card"
        type="button"
        onClick={() => openTask(task, attempt)}
      >
        <span className="task-card-source">
          <strong>{task.identifier}</strong>
          {task.priority != null && <span className="task-card-priority">P{task.priority}</span>}
        </span>
        <span className="task-card-heading">
          <strong className="task-card-title">{task.title}</strong>
          <span className="task-card-meta">
            {labels.length > 0 && <span className="task-card-labels">{labels.join(" · ")}</span>}
            {task.blocked && (
              <span className="task-card-alert" title={task.blocked.reason}>
                <span aria-hidden="true">!</span>
                {interpolateBlocked(
                  dictionary.taskCard.blockedReason,
                  blockedReasonSummary(task.blocked.reason),
                )}
              </span>
            )}
            {warnings.length > 0 && !task.blocked && (
              <span className="task-card-alert" title={warnings.join(" · ")}>
                <span aria-hidden="true">!</span>
                {warnings[0]}
              </span>
            )}
          </span>
        </span>
        <span className={`task-card-summary is-${task.workflowStatus}`}>
          <strong>{statusLabel(task, dictionary)}</strong>
          {attempt && (
            <small>
              {dictionary.detail.attempt} {String(attempt.sequence).padStart(2, "0")}
            </small>
          )}
        </span>
      </button>
      <div className="task-card-actions">
        <TaskCardNextAction
          action={taskCardAction(task, attempt)}
          connection={connection}
          dictionary={dictionary}
          onMarkReady={() => void sendCommand({ kind: "enable_task_dispatch", task })}
          onOpenReview={() => void openReview(task)}
          onRecheck={() => void setTaskStatus(task, task.workflowStatus)}
          onStart={() => startWorkflow(task)}
        />
      </div>
    </article>
  );
}

function TaskCardNextAction({
  action,
  connection,
  dictionary,
  onMarkReady,
  onOpenReview,
  onRecheck,
  onStart,
}: {
  action: TaskCardAction | null;
  connection: "online" | "offline";
  dictionary: Dictionary;
  onMarkReady: () => void;
  onOpenReview: () => void;
  onRecheck: () => void;
  onStart: () => void;
}) {
  if (action?.kind === "recheck") {
    return (
      <Button
        className="task-card-action"
        size="xs"
        title={dictionary.taskCard.recheckBlockedHint}
        type="button"
        variant="outline"
        onClick={onRecheck}
      >
        {dictionary.taskCard.clearBlocked}
      </Button>
    );
  }
  if (action?.kind === "mark_ready") {
    return (
      <Button
        className="task-card-action"
        disabled={connection === "offline"}
        size="xs"
        title={dictionary.taskCard.markReadyHint}
        type="button"
        variant="outline"
        onClick={onMarkReady}
      >
        {dictionary.taskCard.markReady}
      </Button>
    );
  }
  if (action?.kind === "start") {
    return (
      <Button
        className="task-card-action task-card-start"
        disabled={connection === "offline"}
        size="xs"
        type="button"
        onClick={onStart}
      >
        {dictionary.workflow.start}
      </Button>
    );
  }
  if (action?.kind === "open_review") {
    return (
      <Button
        className="task-card-action"
        size="xs"
        title={dictionary.taskCard.openReviewHint}
        type="button"
        variant="outline"
        onClick={onOpenReview}
      >
        {dictionary.taskCard.openReview}
      </Button>
    );
  }
  return null;
}

function latestAttempt(
  task: TaskSummary,
  attempts: readonly AttemptSnapshot[],
): AttemptSnapshot | null {
  return (
    attempts
      .filter((attempt) => attempt.taskId === task.id)
      .sort((a, b) => b.sequence - a.sequence)[0] ?? null
  );
}

function latestWorkflow(runs: TeamRunSnapshot[]): TeamRunSnapshot | null {
  return runs.reduce<TeamRunSnapshot | null>(
    (latest, run) => (!latest || run.updatedAt > latest.updatedAt ? run : latest),
    null,
  );
}

function interpolateBlocked(template: string, reason: string): string {
  return template.replace("{reason}", reason);
}
