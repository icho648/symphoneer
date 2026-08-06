import type {
  AttemptSnapshot,
  RuntimeSnapshot,
  TaskSummary,
  TeamRunSnapshot,
} from "@symphoneer/contracts";
import type { Dictionary } from "../../i18n/index.ts";

import { type BoardColumn, taskColumn } from "../../lib/task-column";
import { WorkflowMap } from "./workflow-map";

export function TaskColumns({
  dictionary,
  onOpenTask,
  onStartWorkflow,
  selectedTaskId,
  snapshot,
}: {
  dictionary: Dictionary;
  onOpenTask: (task: TaskSummary, attempt: AttemptSnapshot | null) => void;
  onStartWorkflow: (task: TaskSummary) => void;
  selectedTaskId: string | null;
  snapshot: RuntimeSnapshot | null;
}) {
  const columns: Array<{ id: BoardColumn; label: string; hint: string }> = [
    { id: "READY", ...dictionary.columns.ready },
    { id: "RUNNING", ...dictionary.columns.running },
    { id: "REVIEW", ...dictionary.columns.review },
    { id: "BLOCKED", ...dictionary.columns.blocked },
  ];

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 min-[701px]:grid-cols-2 min-[1101px]:grid-cols-4">
      {columns.map((column) => {
        const tasks = (snapshot?.tasks ?? []).filter(
          (task) => taskColumn(task, snapshot?.attempts ?? []) === column.id,
        );
        return (
          <section
            className="flex min-h-[200px] min-w-0 flex-col overflow-hidden rounded-[10px] border border-line bg-panel min-[701px]:min-h-0"
            key={column.id}
            aria-labelledby={`column-${column.id}`}
          >
            <div className="flex items-start justify-between gap-2 border-b border-line px-3 py-2.5">
              <div className="min-w-0">
                <h2
                  className="truncate text-[13px] font-semibold tracking-[-0.01em]"
                  id={`column-${column.id}`}
                >
                  {column.label}
                </h2>
                <p className="mb-0 mt-0.5 truncate text-[11px] text-faint">{column.hint}</p>
              </div>
              <span className="rounded-full bg-panel-raised px-1.5 py-0.5 font-mono text-[11px] text-muted">
                {tasks.length}
              </span>
            </div>
            <div className="grid min-h-0 content-start gap-1 overflow-auto p-1.5">
              {tasks.map((task) => (
                <TaskCard
                  attempt={latestAttempt(task, snapshot?.attempts ?? [])}
                  dictionary={dictionary}
                  key={task.id}
                  onOpen={() => onOpenTask(task, latestAttempt(task, snapshot?.attempts ?? []))}
                  onStart={() => onStartWorkflow(task)}
                  selected={selectedTaskId === task.id}
                  snapshot={snapshot}
                  task={task}
                />
              ))}
              {tasks.length === 0 && (
                <p className="px-2.5 py-6 text-center text-[11px] leading-relaxed text-faint">
                  {dictionary.columns.empty}
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TaskCard({
  attempt,
  dictionary,
  onOpen,
  onStart,
  selected,
  snapshot,
  task,
}: {
  attempt: AttemptSnapshot | null;
  dictionary: Dictionary;
  onOpen: () => void;
  onStart: () => void;
  selected: boolean;
  snapshot: RuntimeSnapshot | null;
  task: TaskSummary;
}) {
  const workflow = attempt
    ? latestWorkflow(snapshot?.teamRuns.filter((run) => run.attemptId === attempt.id) ?? [])
    : null;
  return (
    <div className={`task-card-wrap ${selected ? "is-selected" : ""}`}>
      <button className="task-card" type="button" aria-pressed={selected} onClick={onOpen}>
        <span className="task-card-heading">
          <span className="task-card-id">{task.identifier}</span>
          <span className="task-card-state">
            {dictionary.statuses[task.state as keyof typeof dictionary.statuses] ?? task.state}
          </span>
        </span>
        <strong className="task-card-title">{task.title}</strong>
        <span className="task-card-labels">
          {task.labels.length ? task.labels.join(" · ") : dictionary.columns.noLabels}
        </span>
        <span className="task-card-meta-grid">
          <span>
            <small>{dictionary.detail.tracker}</small>
            <strong>{formatTracker(task.source.kind)}</strong>
          </span>
          <span>
            <small>{dictionary.detail.executor}</small>
            <strong>
              {workflow?.provider === "codex-app-server"
                ? dictionary.workflow.codexShort
                : workflow
                  ? dictionary.workflow.fakeShort
                  : "—"}
            </strong>
          </span>
          <span>
            <small>{dictionary.detail.workflow}</small>
            <strong>{workflow?.workflow ?? "—"}</strong>
          </span>
        </span>
        {workflow && <WorkflowMap compact dictionary={dictionary} workflow={workflow} />}
      </button>
      {!attempt && (
        <button className="task-card-start" type="button" onClick={onStart}>
          {dictionary.workflow.start}
        </button>
      )}
    </div>
  );
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

function formatTracker(kind: string): string {
  if (kind === "github") return "GitHub";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}
