"use client";

import type {
  RuntimeAttemptDetail,
  RuntimeHealth,
  RuntimeSnapshot,
  TaskSummary,
} from "@symphoneer/contracts";
import { type Dictionary, interpolate, type Locale } from "@symphoneer/i18n";
import { useEffect, useMemo, useState } from "react";

import { BoardChrome } from "./board-chrome";
import { TaskColumns } from "./task-columns";
import { type AttemptCommand, TaskDetail } from "./task-detail";

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
  const [health, setHealth] = useState(initialHealth);
  const [selectedTaskId, setSelectedTaskId] = useState(initialSnapshot?.tasks[0]?.id ?? null);
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
        const body = await fetchRuntimeJson<RuntimeHealth>("/api/runtime/health");
        if (!disposed) {
          setHealth(body);
          setConnection("online");
        }
      } catch (error) {
        if (!disposed) {
          setHealth(null);
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
        setHealth(null);
        setConnection("offline");
      }
    };
    return () => {
      disposed = true;
      stream.close();
    };
  }, [dictionary.board, initialSnapshot?.runtime.lastEventSequence]);

  const selectedTask = snapshot?.tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedAttempts = useMemo(
    () =>
      snapshot?.attempts
        .filter((attempt) => attempt.taskId === selectedTaskId)
        .sort((a, b) => b.sequence - a.sequence) ?? [],
    [selectedTaskId, snapshot],
  );
  const latestAttempt = selectedAttempts[0] ?? null;

  useEffect(() => {
    if (!latestAttempt) {
      setDetail(null);
      return;
    }
    let disposed = false;
    void fetch(`/api/runtime/attempts/${encodeURIComponent(latestAttempt.id)}`, {
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
  }, [dictionary.board, latestAttempt]);

  const selectTask = (task: TaskSummary) => {
    setSelectedTaskId(task.id);
    setNotice(interpolate(dictionary.board.selectedTask, { identifier: task.identifier }));
  };

  const sendCommand = async (kind: AttemptCommand) => {
    if (!snapshot || !detail) return;
    try {
      const response = await fetch("/api/runtime/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          attemptId: detail.attempt.id,
          expectedAttemptUpdatedAt: detail.attempt.updatedAt,
          expectedEventSequence: snapshot.runtime.lastEventSequence,
          idempotencyKey: `web:${kind}:${crypto.randomUUID()}`,
        }),
      });
      const body = (await response.json()) as { message?: string; snapshot?: RuntimeSnapshot };
      if (!response.ok) throw new Error(dictionary.board.commandRejected);
      if (body.snapshot) setSnapshot(body.snapshot);
      setNotice(dictionary.board.commandAccepted);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : dictionary.board.commandFailed);
    }
  };

  return (
    <BoardChrome
      connection={connection}
      dictionary={dictionary}
      health={health}
      locale={locale}
      snapshot={snapshot}
    >
      <section
        className="min-w-0 px-[38px] pb-20 pt-[38px] max-[1100px]:px-6 max-[700px]:px-3.5 max-[700px]:pb-[50px] max-[700px]:pt-[26px]"
        id="task-board"
        aria-labelledby="board-title"
      >
        <div className="mb-[30px] flex items-center justify-between gap-6 max-[700px]:flex-col max-[700px]:items-start">
          <div>
            <p className="mb-[9px] font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
              {dictionary.board.eyebrow}
            </p>
            <h1
              className="mb-0 max-w-[560px] font-display text-[clamp(28px,4vw,48px)] font-semibold leading-[1.05] tracking-[-0.045em]"
              id="board-title"
            >
              {dictionary.board.title}
            </h1>
          </div>
          <span
            className="max-w-60 text-right font-mono text-[11px] leading-relaxed text-muted max-[700px]:max-w-none max-[700px]:text-left"
            aria-live="polite"
          >
            {notice}
          </span>
        </div>

        <TaskColumns
          onSelectTask={selectTask}
          selectedTaskId={selectedTaskId}
          snapshot={snapshot}
          dictionary={dictionary}
        />
        <TaskDetail
          detail={detail}
          latestAttempt={latestAttempt}
          onCommand={sendCommand}
          selectedAttempts={selectedAttempts}
          selectedTask={selectedTask}
          snapshot={snapshot}
          dictionary={dictionary}
          locale={locale}
        />
      </section>
    </BoardChrome>
  );
}
