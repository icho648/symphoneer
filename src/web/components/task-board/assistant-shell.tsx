import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react";
import { useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { selectActiveAttempt, selectSelectedTask, useWorkbench } from "../../stores/workbench.ts";
import { createAssistantUiChatModelAdapter } from "../assistant/assistant-ui-adapter.ts";
import {
  createDemoAssistantAdapter,
  type DemoAssistantContext,
} from "../assistant/demo-adapter.ts";
import { DeliveryAssistantThread } from "../assistant/thread.tsx";

export function AssistantShell() {
  const { dictionary, open, selectedAttempt, selectedTask, snapshot, toggleAssistant } =
    useWorkbench(
      useShallow((state) => ({
        selectedAttempt: selectActiveAttempt(state),
        open: state.assistantOpen,
        dictionary: state.dictionary,
        selectedTask: selectSelectedTask(state),
        snapshot: state.snapshot,
        toggleAssistant: state.toggleAssistant,
      })),
    );
  const assistant = dictionary.board.assistant;
  const projectionVersion = snapshot?.projectionVersion ?? 1;
  const lastEventSequence = snapshot?.runtime.lastEventSequence ?? 0;
  const contextRef = useRef<DemoAssistantContext>({
    dictionary,
    selectedAttempt,
    selectedTask,
  });
  contextRef.current = { dictionary, selectedAttempt, selectedTask };

  const assistantAdapter = useMemo(() => createDemoAssistantAdapter(() => contextRef.current), []);
  const chatModelAdapter = useMemo(
    () => createAssistantUiChatModelAdapter(assistantAdapter),
    [assistantAdapter],
  );
  const runtime = useLocalRuntime(chatModelAdapter);

  return (
    <div className={`assistant-column ${open ? "is-open" : "is-collapsed"}`}>
      <nav className="assistant-rail-nav" aria-label={dictionary.navigation.label}>
        <a
          className="macos-nav-item"
          href="#task-board"
          title={dictionary.navigation.tasks}
          aria-current="page"
        >
          <NavGlyph name="tasks" />
          <span className="macos-nav-label truncate">{dictionary.navigation.tasks}</span>
          <span className="macos-nav-meta font-mono text-[11px] text-faint">
            {snapshot?.tasks.length ?? 0}
          </span>
        </a>
        <a className="macos-nav-item" href="#selected-task" title={dictionary.navigation.activity}>
          <NavGlyph name="activity" />
          <span className="macos-nav-label truncate">{dictionary.navigation.activity}</span>
        </a>
        <div
          className="assistant-rail-meta"
          title={
            dictionary.navigation.projection +
            " v" +
            projectionVersion +
            " · " +
            dictionary.navigation.events +
            " " +
            lastEventSequence
          }
        >
          <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />
          <code className="assistant-rail-version font-mono text-signal">v{projectionVersion}</code>
        </div>
        <button
          aria-expanded={open}
          aria-label={open ? assistant.close : assistant.open}
          className="assistant-rail-toggle"
          title={open ? assistant.close : assistant.open}
          type="button"
          onClick={toggleAssistant}
        >
          <span aria-hidden="true">{open ? "‹" : "✦"}</span>
        </button>
      </nav>

      <aside className="assistant-slot" id="assistant-slot" aria-labelledby="assistant-slot-title">
        <header className="assistant-slot-header">
          <div className="assistant-identity">
            <span className="assistant-mark" aria-hidden="true">
              ✦
            </span>
            <div className="min-w-0">
              <p className="assistant-slot-eyebrow">{assistant.eyebrow}</p>
              <h2 id="assistant-slot-title">{assistant.title}</h2>
            </div>
          </div>
        </header>

        <div className="assistant-slot-status">
          <span className="assistant-status-dot" aria-hidden="true" />
          <span>{assistant.ready}</span>
          <span className="assistant-status-note">{assistant.optional}</span>
        </div>

        <AssistantRuntimeProvider runtime={runtime}>
          <div className="flex min-h-0 flex-1 flex-col">
            <DeliveryAssistantThread
              dictionary={dictionary}
              selectedAttempt={selectedAttempt}
              selectedTask={selectedTask}
            />
          </div>
        </AssistantRuntimeProvider>
      </aside>
    </div>
  );
}

function NavGlyph({ name }: { name: "tasks" | "activity" }) {
  const paths = {
    tasks: "M4 6h16M4 12h16M4 18h10",
    activity: "M12 5v14M5 12h14",
  } as const;

  return (
    <svg
      aria-hidden="true"
      className="size-3.5 shrink-0 opacity-80"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d={paths[name]} />
    </svg>
  );
}
