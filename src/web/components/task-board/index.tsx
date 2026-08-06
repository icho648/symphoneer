import type {
  AgentRunSnapshot,
  RuntimeAttemptDetail,
  RuntimeSnapshot,
  TaskSummary,
  TeamRunSnapshot,
} from "@symphoneer/contracts";
import { useEffect, useMemo, useState } from "react";
import { type Dictionary, interpolate, type Locale } from "../../i18n/index.ts";
import { useRuntimeClient } from "../../runtime-provider.tsx";
import { AssistantShell } from "./assistant-shell.tsx";
import { BoardChrome } from "./board-chrome.tsx";
import { TaskColumns, type TaskStatusFilter } from "./task-columns.tsx";
import { type CommandIntent, TaskDetail } from "./task-detail.tsx";

export function TaskBoard({ dictionary, locale }: { dictionary: Dictionary; locale: Locale }) {
  const runtime = useRuntimeClient();
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<TaskStatusFilter>("ALL");
  const [activeAttemptId, setActiveAttemptId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [detail, setDetail] = useState<RuntimeAttemptDetail | null>(null);
  const [connection, setConnection] = useState<"online" | "offline">("offline");
  const [notice, setNotice] = useState(dictionary.board.waitingRuntime);

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const [nextHealth, nextSnapshot] = await Promise.all([
          runtime.health(),
          runtime.snapshot(),
        ]);
        if (disposed) return;
        setConnection(nextHealth.runtime.status);
        setSnapshot(nextSnapshot);
        setSelectedTaskId((current) => current ?? nextSnapshot.tasks[0]?.id ?? null);
        setNotice(dictionary.board.projectionSynchronized);
      } catch (error) {
        if (disposed) return;
        setConnection("offline");
        setNotice(error instanceof Error ? error.message : dictionary.board.runtimeUnavailable);
      }
    };

    void refresh();
    const subscription = runtime.subscribe({
      afterSequence: snapshot?.runtime.lastEventSequence ?? 0,
    });
    void (async () => {
      for await (const event of subscription.events) {
        if (disposed) break;
        if (event.kind === "error") {
          setConnection("offline");
          continue;
        }
        if (event.kind === "snapshot") {
          setSnapshot(event.snapshot);
          setConnection("online");
          setNotice(dictionary.board.projectionSynchronized);
          continue;
        }
        if (event.kind === "domain") {
          void refresh();
        }
      }
    })();

    return () => {
      disposed = true;
      subscription.close();
    };
    // Subscribe once per runtime/dictionary; refresh closes over latest notice copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictionary.board, runtime]);

  useEffect(() => {
    const syncTaskFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const taskId = params.get("task");
      if (taskId) setSelectedTaskId(taskId);
      setActiveAttemptId(params.get("attempt"));
      setActiveRunId(params.get("run"));
      setActiveAgentId(params.get("agent"));
      setActiveSessionId(params.get("session"));
    };
    syncTaskFromUrl();
    window.addEventListener("popstate", syncTaskFromUrl);
    return () => window.removeEventListener("popstate", syncTaskFromUrl);
  }, []);

  const selectedTask = snapshot?.tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedAttempts = useMemo(
    () =>
      snapshot?.attempts
        .filter((attempt) => attempt.taskId === selectedTaskId)
        .sort((a, b) => b.sequence - a.sequence) ?? [],
    [selectedTaskId, snapshot],
  );
  const selectedAttempt =
    selectedAttempts.find((attempt) => attempt.id === activeAttemptId) ?? null;

  useEffect(() => {
    if (!selectedAttempt) {
      setDetail(null);
      return;
    }
    let disposed = false;
    setDetail(null);
    void runtime
      .getAttempt(selectedAttempt.id)
      .then((body) => {
        if (!disposed) setDetail(body);
      })
      .catch(() => {
        if (!disposed) setDetail(null);
      });
    return () => {
      disposed = true;
    };
  }, [runtime, selectedAttempt]);

  const replaceUrl = (
    values: Record<"task" | "attempt" | "run" | "agent" | "session", string | null>,
  ) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""));
  };

  const openTask = (task: TaskSummary, attempt: (typeof selectedAttempts)[number] | null) => {
    setSelectedTaskId(task.id);
    setActiveAttemptId(attempt?.id ?? null);
    setActiveRunId(null);
    setActiveAgentId(null);
    setActiveSessionId(null);
    replaceUrl({
      task: task.id,
      attempt: attempt?.id ?? null,
      run: null,
      agent: null,
      session: null,
    });
    setNotice(interpolate(dictionary.board.selectedTask, { identifier: task.identifier }));
  };

  const sendCommand = async (intent: CommandIntent) => {
    if (!snapshot) return;
    if (intent.kind !== "start_team_run" && (!detail || !selectedAttempt)) return;
    if (intent.kind !== "start_team_run" && detail?.attempt.id !== selectedAttempt?.id) return;
    try {
      const command = {
        ...intent,
        ...(intent.kind === "pause_attempt" || intent.kind === "retry_attempt"
          ? {
              attemptId: detail?.attempt.id,
              expectedAttemptUpdatedAt: detail?.attempt.updatedAt,
            }
          : {}),
        expectedEventSequence: snapshot.runtime.lastEventSequence,
        idempotencyKey: `web:${intent.kind}:${crypto.randomUUID()}`,
      };
      const body = await runtime.execute(command);
      setSnapshot(body.snapshot);
      if (intent.kind === "start_team_run") {
        const attempt = body.snapshot.attempts.find((item) => item.taskId === intent.task.id);
        if (attempt) {
          setSelectedTaskId(intent.task.id);
          setActiveAttemptId(attempt.id);
          setActiveRunId(null);
          setActiveAgentId(null);
          setActiveSessionId(null);
          replaceUrl({
            task: intent.task.id,
            attempt: attempt.id,
            run: null,
            agent: null,
            session: null,
          });
        }
      }
      setNotice(dictionary.board.commandAccepted);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : dictionary.board.commandFailed);
    }
  };

  const startWorkflow = (task: TaskSummary) => {
    void sendCommand({ kind: "start_team_run", task });
  };

  const selectAttempt = (attempt: (typeof selectedAttempts)[number]) => {
    setActiveAttemptId(attempt.id);
    setActiveRunId(null);
    setActiveAgentId(null);
    setActiveSessionId(null);
    replaceUrl({
      task: selectedTaskId,
      attempt: attempt.id,
      run: null,
      agent: null,
      session: null,
    });
  };

  const selectRun = (run: TeamRunSnapshot) => {
    setActiveRunId(run.id);
    setActiveAgentId(null);
    setActiveSessionId(null);
    replaceUrl({
      task: selectedTaskId,
      attempt: activeAttemptId,
      run: run.id,
      agent: null,
      session: null,
    });
  };

  const selectAgent = (agent: AgentRunSnapshot) => {
    setActiveAgentId(agent.id);
    setActiveSessionId(agent.providerSession?.threadId ?? null);
    replaceUrl({
      task: selectedTaskId,
      attempt: activeAttemptId,
      run: agent.teamRunId,
      agent: agent.id,
      session: agent.providerSession?.threadId ?? null,
    });
  };

  const selectSession = (threadId: string) => {
    setActiveSessionId(threadId);
    replaceUrl({
      task: selectedTaskId,
      attempt: activeAttemptId,
      run: activeRunId,
      agent: activeAgentId,
      session: threadId,
    });
  };

  return (
    <BoardChrome
      connection={connection}
      dictionary={dictionary}
      locale={locale}
      snapshot={snapshot}
    >
      <section
        className="flex min-h-0 min-w-0 flex-1 flex-col px-4 pb-4 pt-4 max-[700px]:px-3 max-[700px]:pb-3"
        id="task-board"
        aria-labelledby="board-title"
      >
        {selectedTask && selectedAttempt ? (
          <div className="view-stage flex min-h-0 flex-1" key={selectedAttempt.id}>
            <TaskDetail
              activeAgentId={activeAgentId}
              activeRunId={activeRunId}
              activeSessionId={activeSessionId}
              attempts={selectedAttempts}
              detail={detail}
              latestAttempt={selectedAttempt}
              onBack={() => openTask(selectedTask, null)}
              onCommand={sendCommand}
              onSelectAgent={selectAgent}
              onSelectAttempt={selectAttempt}
              onSelectRun={selectRun}
              onSelectSession={selectSession}
              selectedTask={selectedTask}
              snapshot={snapshot}
              dictionary={dictionary}
              locale={locale}
            />
          </div>
        ) : (
          <div className="view-stage flex min-h-0 flex-1 flex-col" key="task-lists">
            <div
              className={`task-workbench ${assistantOpen ? "assistant-is-open" : "assistant-is-closed"}`}
            >
              {assistantOpen && (
                <AssistantShell
                  dictionary={dictionary}
                  onClose={() => setAssistantOpen(false)}
                  selectedAttempt={selectedAttempt}
                  selectedTask={selectedTask}
                />
              )}
              <div className="task-deck">
                <div className="task-deck-heading">
                  <div>
                    <p className="eyebrow-label">{dictionary.board.eyebrow}</p>
                    <h1
                      className="mb-0 text-[22px] font-semibold tracking-[-0.03em]"
                      id="board-title"
                    >
                      {dictionary.board.title}
                    </h1>
                    <p className="mb-0 mt-1 text-[12px] text-muted">
                      {dictionary.board.levelOneHint}
                    </p>
                  </div>
                  <div className="task-deck-heading-actions">
                    <span
                      className="max-w-72 truncate rounded-full bg-panel px-2.5 py-1 text-[11px] text-muted shadow-[0_0_0_0.5px_var(--line)] max-[700px]:max-w-none"
                      aria-live="polite"
                    >
                      {notice}
                    </span>
                    <button
                      aria-controls="assistant-slot"
                      aria-expanded={assistantOpen}
                      className="assistant-toggle"
                      type="button"
                      onClick={() => setAssistantOpen((open) => !open)}
                    >
                      <span aria-hidden="true">✦</span>
                      {assistantOpen
                        ? dictionary.board.assistant.close
                        : dictionary.board.assistant.open}
                    </button>
                  </div>
                </div>
                <TaskColumns
                  connection={connection}
                  onOpenTask={openTask}
                  onStartWorkflow={startWorkflow}
                  filter={taskFilter}
                  onFilterChange={setTaskFilter}
                  selectedTaskId={selectedTaskId}
                  snapshot={snapshot}
                  dictionary={dictionary}
                />
              </div>
            </div>
          </div>
        )}
      </section>
    </BoardChrome>
  );
}
