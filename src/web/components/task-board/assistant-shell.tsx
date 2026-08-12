import type {
  AssistantSession,
  AssistantSessionSummary,
  AssistantStatus,
} from "@symphoneer/assistant-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { createBrowserAssistantClient } from "../../runtime-provider.tsx";
import { selectActiveAttempt, selectSelectedTask, useWorkbench } from "../../stores/workbench.ts";
import { AssistantSessionRuntime } from "../assistant/session-runtime.tsx";

export function AssistantShell() {
  const { dictionary, locale, open, selectedAttempt, selectedTask, snapshot, toggleAssistant } =
    useWorkbench(
      useShallow((state) => ({
        selectedAttempt: selectActiveAttempt(state),
        open: state.assistantOpen,
        dictionary: state.dictionary,
        locale: state.locale,
        selectedTask: selectSelectedTask(state),
        snapshot: state.snapshot,
        toggleAssistant: state.toggleAssistant,
      })),
    );
  const client = useMemo(() => createBrowserAssistantClient(), []);
  const [detail, setDetail] = useState<AssistantSession | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AssistantSessionSummary[]>([]);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const creating = useRef(false);
  const assistant = dictionary.board.assistant;
  const projectionVersion = snapshot?.projectionVersion ?? 1;
  const lastEventSequence = snapshot?.runtime.lastEventSequence ?? 0;

  const refreshSessions = useCallback(async () => {
    const next = await client.listSessions();
    setSessions(next);
    setSessionId((current) =>
      current && next.some((session) => session.id === current) ? current : (next[0]?.id ?? null),
    );
  }, [client]);

  const createSession = useCallback(async () => {
    if (creating.current) return;
    creating.current = true;
    setError("");
    try {
      const created = await client.createSession({
        createdBy: "web",
        locale,
        ...(selectedTask?.projectId ? { projectId: selectedTask.projectId } : {}),
        ...(selectedTask ? { taskId: selectedTask.id } : {}),
        ...(selectedAttempt ? { attemptId: selectedAttempt.id } : {}),
      });
      setSessionId(created.id);
      await refreshSessions();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : assistant.unavailable);
    } finally {
      creating.current = false;
    }
  }, [assistant.unavailable, client, locale, refreshSessions, selectedAttempt, selectedTask]);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const nextStatus = await client.status();
        if (disposed) return;
        setStatus(nextStatus);
        if (nextStatus.state === "ready") await refreshSessions();
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : assistant.unavailable);
      } finally {
        if (!disposed) setLoaded(true);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [assistant.unavailable, client, refreshSessions]);

  useEffect(() => {
    if (loaded && status?.state === "ready" && snapshot && sessions.length === 0 && !sessionId) {
      void createSession();
    }
  }, [createSession, loaded, sessionId, sessions.length, snapshot, status]);

  useEffect(() => {
    let disposed = false;
    if (!sessionId) {
      setDetail(null);
      return;
    }
    setDetail(null);
    setError("");
    void client
      .openSession(sessionId)
      .then((session) => {
        if (!disposed) setDetail(session);
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : assistant.unavailable);
      });
    return () => {
      disposed = true;
    };
  }, [assistant.unavailable, client, sessionId]);

  const renameSession = async () => {
    if (!sessionId) return;
    const name = window.prompt(assistant.renameSession, detail?.name ?? "");
    if (!name) return;
    try {
      await client.renameSession(sessionId, name);
      await refreshSessions();
      setDetail(await client.openSession(sessionId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : assistant.unavailable);
    }
  };
  const deleteSession = async () => {
    if (!sessionId || !window.confirm(assistant.deleteConfirm)) return;
    try {
      await client.deleteSession(sessionId);
      setDetail(null);
      await refreshSessions();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : assistant.unavailable);
    }
  };
  const statusText = readStatus(status, assistant);
  const sessionTask = selectedTask?.id === detail?.metadata.taskId ? selectedTask : null;
  const sessionAttempt =
    selectedAttempt?.id === detail?.metadata.attemptId ? selectedAttempt : null;

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
          title={`${dictionary.navigation.projection} v${projectionVersion} · ${dictionary.navigation.events} ${lastEventSequence}`}
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
          <span
            className={`assistant-status-dot ${status?.state === "ready" ? "" : "is-offline"}`}
            aria-hidden="true"
          />
          <span>{error || statusText}</span>
          <span className="assistant-status-note">
            {status?.state === "ready" ? `${status.provider}/${status.model}` : assistant.optional}
          </span>
        </div>

        {status?.state === "ready" ? (
          <div className="assistant-session-controls">
            <select
              aria-label={assistant.history}
              value={sessionId ?? ""}
              onChange={(event) => setSessionId(event.target.value || null)}
            >
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.name ?? new Date(session.updatedAt).toLocaleString(locale)}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => void createSession()}>
              {assistant.newSession}
            </button>
            <button disabled={!sessionId} type="button" onClick={() => void renameSession()}>
              {assistant.renameSession}
            </button>
            <button disabled={!sessionId} type="button" onClick={() => void deleteSession()}>
              {assistant.deleteSession}
            </button>
          </div>
        ) : null}

        {status?.state === "ready" && detail ? (
          <AssistantSessionRuntime
            key={detail.id}
            client={client}
            dictionary={dictionary}
            onRunFinished={refreshSessions}
            selectedAttempt={sessionAttempt}
            selectedTask={sessionTask}
            session={detail}
          />
        ) : (
          <div className="assistant-unavailable">
            <p>{loaded ? error || statusText : assistant.loading}</p>
            <textarea disabled placeholder={assistant.inputPlaceholder} rows={2} />
          </div>
        )}
      </aside>
    </div>
  );
}

function readStatus(
  status: AssistantStatus | null,
  assistant: {
    loading: string;
    ready: string;
    unavailable: string;
    invalidConfig: string;
    providerFailure: string;
  },
): string {
  if (!status) return assistant.loading;
  if (status.state === "ready") return assistant.ready;
  if (status.state === "invalid_config") return assistant.invalidConfig;
  if (status.state === "provider_failure") return assistant.providerFailure;
  return assistant.unavailable;
}

function NavGlyph({ name }: { name: "tasks" | "activity" }) {
  const paths = { tasks: "M4 6h16M4 12h16M4 18h10", activity: "M12 5v14M5 12h14" } as const;
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
