import type { AttemptSnapshot, RuntimeSnapshot, TaskSummary } from "@symphoneer/contracts";
import type { Dictionary } from "@symphoneer/i18n";

type BoardColumn = "READY" | "RUNNING" | "REVIEW" | "BLOCKED";

const activeStatuses = new Set([
  "preparing_workspace",
  "building_prompt",
  "launching_agent",
  "initializing_session",
  "streaming_turn",
  "finishing",
]);

export function TaskColumns({
  dictionary,
  onSelectTask,
  selectedTaskId,
  snapshot,
}: {
  dictionary: Dictionary;
  onSelectTask: (task: TaskSummary) => void;
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
    <div className="grid grid-cols-1 gap-[11px] min-[701px]:grid-cols-2 min-[1101px]:grid-cols-4">
      {columns.map((column) => {
        const tasks = (snapshot?.tasks ?? []).filter(
          (task) =>
            taskColumn(task, snapshot?.attempts ?? [], snapshot?.reviews ?? []) === column.id,
        );
        return (
          <section
            className="min-h-[210px] border border-line bg-panel/60 p-3.5"
            key={column.id}
            aria-labelledby={`column-${column.id}`}
          >
            <div className="flex items-start justify-between border-b border-line pb-[13px]">
              <div>
                <h2 className="text-sm tracking-[-0.015em]" id={`column-${column.id}`}>
                  {column.label}
                </h2>
                <p className="mb-0 mt-1 text-[10px] text-faint">{column.hint}</p>
              </div>
              <span className="font-mono text-[11px] text-signal">{tasks.length}</span>
            </div>
            <div className="grid gap-2 pt-2.5">
              {tasks.map((task) => (
                <button
                  className={`grid w-full cursor-pointer gap-[9px] border bg-panel-raised p-[13px] text-left transition hover:-translate-y-0.5 hover:border-signal ${selectedTaskId === task.id ? "border-signal shadow-[0_0_0_1px_rgb(104_215_197_/_12%)]" : "border-transparent"}`}
                  key={task.id}
                  type="button"
                  aria-pressed={selectedTaskId === task.id}
                  onClick={() => onSelectTask(task)}
                >
                  <span className="font-mono text-[11px] text-amber">{task.identifier}</span>
                  <strong className="text-xs leading-[1.4]">{task.title}</strong>
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-muted">
                    {dictionary.statuses[task.state as keyof typeof dictionary.statuses] ??
                      task.state}{" "}
                    · {task.labels.length ? task.labels.join(", ") : dictionary.columns.noLabels}
                  </span>
                </button>
              ))}
              {tasks.length === 0 && (
                <p className="text-[11px] leading-relaxed text-faint">{dictionary.columns.empty}</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function taskColumn(
  task: TaskSummary,
  attempts: readonly AttemptSnapshot[],
  reviews: RuntimeSnapshot["reviews"],
): BoardColumn {
  const taskAttempts = attempts.filter((attempt) => attempt.taskId === task.id);
  if (taskAttempts.some((attempt) => activeStatuses.has(attempt.status))) return "RUNNING";
  if (taskAttempts.some((attempt) => reviews.some((review) => review.attemptId === attempt.id))) {
    return "REVIEW";
  }
  return task.dispatchable ? "READY" : "BLOCKED";
}
