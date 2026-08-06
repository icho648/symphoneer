"use client";

import type {
  AgentRunSnapshot,
  RuntimeAttemptDetail,
  RuntimeHealth,
  RuntimeSnapshot,
  TaskSummary,
  TeamRunSnapshot,
} from "@symphoneer/contracts";
import { useEffect, useMemo, useState } from "react";
import { type Dictionary, interpolate, type Locale } from "../../i18n/index.ts";

import { BoardChrome } from "./board-chrome";
import { TaskColumns, type TaskStatusFilter } from "./task-columns";
import { type CommandIntent, TaskDetail } from "./task-detail";

export function TaskBoard({
  dictionary,
  initialHealth,
  initialSnapshot,
  locale,
}: {
  dictionary: Dictionary;
  initialHealth: RuntimeHealth | null;
  initialSnapshot: RuntimeSnapshot | null;
  locale: Locale;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [selectedTaskId, setSelectedTaskId] = useState(initialSnapshot?.tasks[0]?.id ?? null);
  const [taskFilter, setTaskFilter] = useState<TaskStatusFilter>("ALL");
  const [activeAttemptId, setActiveAttemptId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RuntimeAttemptDetail | null>(null);
  const [connection, setConnection] = useState(
    initialHealth?.runtime.status ?? initialSnapshot?.runtime.status ?? "offline",
  );
  const [notice, setNotice] = useState(dictionary.board.waitingRuntime);

  useEffect(() => {
    let disposed = false;
    const fetchRuntimeJson = async <T,>(path: string): Promise<T> => {
      const response = await fetch(path, { cache: "no-store" });
      const body = (await response.json()) as T;
      if (!response.ok) throw new Error(dictionary.board.runtimeUnavailable);
      return body;
    };
    const refreshHealth = async () => {
      try {
        await fetchRuntimeJson<RuntimeHealth>("/api/runtime/health");
        if (!disposed) {
          setConnection("online");
        }
      } catch (error) {
        if (!disposed) {
          setConnection("offline");
          setNotice(error instanceof Error ? error.message : dictionary.board.runtimeUnavailable);
        }
      }
    };
    const refreshSnapshot = async () => {
      try {
        const body = await fetchRuntimeJson<RuntimeSnapshot>("/api/runtime/snapshot");
        if (!disposed) {
          setSnapshot(body);
          setNotice(dictionary.board.projectionSynchronized);
        }
      } catch (error) {
        if (!disposed)
          setNotice(error instanceof Error ? error.message : dictionary.board.runtimeUnavailable);
      }
    };
    const refresh = () => {
      void refreshHealth();
      void refreshSnapshot();
    };
    refresh();
    const stream = new EventSource(
      `/api/runtime/events?after=${initialSnapshot?.runtime.lastEventSequence ?? 0}`,
    );
    stream.addEventListener("snapshot", refresh);
    stream.addEventListener("domain", refresh);
    stream.onerror = () => {
      if (!disposed) {
        setConnection("offline");
      }
    };
    return () => {
      disposed = true;
      stream.close();
    };
  }, [dictionary.board, initialSnapshot?.runtime.lastEventSequence]);

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
    void fetch(`/api/runtime/attempts/${encodeURIComponent(selectedAttempt.id)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const body = (await response.json()) as RuntimeAttemptDetail & { message?: string };
        if (!response.ok) throw new Error(dictionary.board.attemptUnavailable);
        return body;
      })
      .then((body) => {
        if (!disposed) setDetail(body);
      })
      .catch(() => {
        if (!disposed) setDetail(null);
      });
    return () => {
      disposed = true;
    };
  }, [dictionary.board, selectedAttempt]);

  const openTask = (task: TaskSummary, attempt: (typeof selectedAttempts)[number] | null) => {
    setSelectedTaskId(task.id);
    setActiveAttemptId(attempt?.id ?? null);
    setActiveRunId(null);
    setActiveAgentId(null);
    setActiveSessionId(null);
    window.history.replaceState(
      null,
      "",
      `?task=${encodeURIComponent(task.id)}${attempt ? `&attempt=${encodeURIComponent(attempt.id)}` : ""}`,
    );
    replaceUrl({
      task: task.id,
      attempt: attempt?.id ?? null,
      run: null,
      agent: null,
      session: null,
    });
    setNotice(interpolate(dictionary.board.selectedTask, { identifier: task.identifier }));
  };

  const startWorkflow = (task: TaskSummary) => {
    void sendCommand({ kind: "start_team_run", task });
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
      const response = await fetch("/api/runtime/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      const body = (await response.json()) as { message?: string; snapshot?: RuntimeSnapshot };
      if (!response.ok) throw new Error(dictionary.board.commandRejected);
      if (body.snapshot) setSnapshot(body.snapshot);
      if (intent.kind === "start_team_run") {
        const attempt = body.snapshot?.attempts.find((item) => item.taskId === intent.task.id);
        if (attempt) {
          setSelectedTaskId(intent.task.id);
          setActiveAttemptId(attempt.id);
          setActiveRunId(null);
          setActiveAgentId(null);
          setActiveSessionId(null);
          window.history.replaceState(
            null,
            "",
            `?task=${encodeURIComponent(intent.task.id)}&attempt=${encodeURIComponent(attempt.id)}`,
          );
        }
      }
      setNotice(dictionary.board.commandAccepted);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : dictionary.board.commandFailed);
    }
  };

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
            <div className="mb-3 flex items-end justify-between gap-4 max-[700px]:flex-col max-[700px]:items-start">
              <div>
                <p className="eyebrow-label">{dictionary.board.eyebrow}</p>
                <h1 className="mb-0 text-[22px] font-semibold tracking-[-0.03em]" id="board-title">
                  {dictionary.board.title}
                </h1>
                <p className="mb-0 mt-1 text-[12px] text-muted">{dictionary.board.levelOneHint}</p>
              </div>
              <span
                className="max-w-72 truncate rounded-full bg-panel px-2.5 py-1 text-[11px] text-muted shadow-[0_0_0_0.5px_var(--line)] max-[700px]:max-w-none"
                aria-live="polite"
              >
                {notice}
              </span>
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
        )}
      </section>
    </BoardChrome>
  );
}
