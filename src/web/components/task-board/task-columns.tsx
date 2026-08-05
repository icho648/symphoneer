import type { RuntimeSnapshot, TaskSummary } from "@symphoneer/contracts";
import type { Dictionary } from "../../i18n/index.ts";

import { type BoardColumn, taskColumn } from "../../lib/task-column";

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
    <div className="grid grid-cols-1 gap-3 min-[701px]:grid-cols-2 min-[1101px]:grid-cols-4">
      {columns.map((column) => {
        const tasks = (snapshot?.tasks ?? []).filter(
          (task) => taskColumn(task, snapshot?.attempts ?? []) === column.id,
        );
        return (
          <section
            className="min-h-[200px] overflow-hidden rounded-[10px] border border-line bg-panel"
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
            <div className="grid gap-0.5 p-1.5">
              {tasks.map((task) => (
                <button
                  className="macos-task-row"
                  key={task.id}
                  type="button"
                  aria-pressed={selectedTaskId === task.id}
                  onClick={() => onSelectTask(task)}
                >
                  <span className="macos-task-id font-mono text-[11px] font-medium text-signal">
                    {task.identifier}
                  </span>
                  <strong className="text-[12px] font-semibold leading-[1.35]">{task.title}</strong>
                  <span className="macos-task-meta overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-muted">
                    {dictionary.statuses[task.state as keyof typeof dictionary.statuses] ??
                      task.state}{" "}
                    · {task.labels.length ? task.labels.join(", ") : dictionary.columns.noLabels}
                  </span>
                </button>
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
