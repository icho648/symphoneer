import { useShallow } from "zustand/react/shallow";
import { selectSelectedTask, useWorkbench } from "../../stores/workbench.ts";
import { AssistantShell } from "./assistant-shell.tsx";
import { BoardChrome } from "./board-chrome.tsx";
import { TaskColumns } from "./task-columns.tsx";
import { TaskOverview } from "./task-detail.tsx";

export function TaskBoard() {
  return <TaskBoardView />;
}

function TaskBoardView() {
  const { assistantOpen, dictionary, selectedTask, taskOpen } = useWorkbench(
    useShallow((state) => ({
      assistantOpen: state.assistantOpen,
      dictionary: state.dictionary,
      selectedTask: selectSelectedTask(state),
      taskOpen: state.taskOpen,
    })),
  );
  return (
    <BoardChrome>
      <section
        className="flex min-h-0 min-w-0 flex-1 flex-col px-4 pb-4 pt-4 max-[700px]:px-3 max-[700px]:pb-3"
        id="task-board"
        aria-label={dictionary.navigation.tasks}
      >
        <div className="view-stage flex min-h-0 flex-1 flex-col">
          {selectedTask && taskOpen ? (
            <TaskOverview />
          ) : (
            <div
              className={`task-workbench ${assistantOpen ? "assistant-is-open" : "assistant-is-closed"}`}
            >
              <AssistantShell />
              <div className="task-deck">
                <TaskColumns />
              </div>
            </div>
          )}
        </div>
      </section>
    </BoardChrome>
  );
}
