import type {
  AssistantSession,
  AssistantSessionSummary,
  AssistantStatus,
  AssistantThinkingLevel,
} from "@symphoneer/assistant-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { createBrowserAssistantClient } from "../../runtime-provider.tsx";
import { selectActiveAttempt, selectSelectedTask, useWorkbench } from "../../stores/workbench.ts";
import { AssistantSessionRuntime } from "../assistant/session-runtime.tsx";

export function AssistantShell() {
  const { dictionary, locale, open, selectedAttempt, selectedTask, toggleAssistant } = useWorkbench(
    useShallow((state) => ({
      selectedAttempt: selectActiveAttempt(state),
      open: state.assistantOpen,
      dictionary: state.dictionary,
      locale: state.locale,
      selectedTask: selectSelectedTask(state),
      toggleAssistant: state.toggleAssistant,
    })),
  );
  const client = useMemo(() => createBrowserAssistantClient(), []);
  const [detail, setDetail] = useState<AssistantSession | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AssistantSessionSummary[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const creating = useRef(false);
  const assistant = dictionary.board.assistant;
  const replaceableSessionId = detail?.messages.length === 0 ? detail.id : null;

  const refreshSessions = useCallback(async () => {
    const next = await client.listSessions();
    setSessions(next);
    setSessionsLoaded(true);
    setSessionId((current) =>
      current && next.some((session) => session.id === current) ? current : (next[0]?.id ?? null),
    );
  }, [client]);

  const createSession = useCallback(
    async (options?: { model?: string; thinkingLevel?: AssistantThinkingLevel }) => {
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
          ...options,
        });
        setDeleteArmed(false);
        setRenameDraft(null);
        setSessionId(created.id);
        await refreshSessions();
        return created;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : assistant.unavailable);
        return undefined;
      } finally {
        creating.current = false;
      }
    },
    [assistant.unavailable, client, locale, refreshSessions, selectedAttempt, selectedTask],
  );

  const configureSession = useCallback(
    async (options: { model: string; thinkingLevel: AssistantThinkingLevel }) => {
      const created = await createSession(options);
      if (!created || !replaceableSessionId) return;
      try {
        await client.deleteSession(replaceableSessionId);
        await refreshSessions();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : assistant.unavailable);
      }
    },
    [assistant.unavailable, client, createSession, refreshSessions, replaceableSessionId],
  );

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const nextStatus = await client.status();
        if (disposed) return;
        setStatus(nextStatus);
        if (nextStatus.state === "ready") {
          try {
            await refreshSessions();
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 250));
            if (!disposed) await refreshSessions();
          }
        }
      } catch {
        if (!disposed) setError(assistant.requestFailed);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [assistant.requestFailed, client, refreshSessions]);

  useEffect(() => {
    if (status?.state === "ready" && sessionsLoaded && sessions.length === 0 && !sessionId) {
      void createSession();
    }
  }, [createSession, sessionId, sessions.length, sessionsLoaded, status]);

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
    if (!sessionId || renameDraft === null) return;
    const name = renameDraft.trim();
    if (!name) return;
    try {
      await client.renameSession(sessionId, name);
      await refreshSessions();
      setDetail(await client.openSession(sessionId));
      setRenameDraft(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : assistant.unavailable);
    }
  };
  const deleteSession = async () => {
    if (!sessionId) return;
    try {
      await client.deleteSession(sessionId);
      setDetail(null);
      setDeleteArmed(false);
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
      {!open ? (
        <button
          aria-controls="assistant-slot"
          aria-expanded={open}
          aria-label={assistant.open}
          className="assistant-collapsed-toggle"
          title={assistant.open}
          type="button"
          onClick={toggleAssistant}
        >
          <span aria-hidden="true">✦</span>
        </button>
      ) : null}

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
          <button
            aria-controls="assistant-slot"
            aria-expanded={open}
            aria-label={assistant.close}
            className="assistant-header-toggle"
            title={assistant.close}
            type="button"
            onClick={toggleAssistant}
          >
            <span aria-hidden="true">‹</span>
          </button>
        </header>

        <div className="assistant-slot-status">
          <span
            className={`assistant-status-dot ${status?.state === "ready" ? "" : "is-offline"}`}
            aria-hidden="true"
          />
          <span>{error || statusText}</span>
          <span className="assistant-status-note">
            {status?.state === "ready"
              ? `${status.provider}/${detail?.model ?? status.model}`
              : assistant.optional}
          </span>
        </div>

        {status?.state === "ready" ? (
          <div className="assistant-session-controls">
            <select
              aria-label={assistant.history}
              value={sessionId ?? ""}
              onChange={(event) => {
                setDeleteArmed(false);
                setRenameDraft(null);
                setSessionId(event.target.value || null);
              }}
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
            {renameDraft === null && !deleteArmed ? (
              <>
                <button
                  disabled={!sessionId}
                  type="button"
                  onClick={() => setRenameDraft(detail?.name ?? "")}
                >
                  {assistant.renameSession}
                </button>
                <button disabled={!sessionId} type="button" onClick={() => setDeleteArmed(true)}>
                  {assistant.deleteSession}
                </button>
              </>
            ) : null}
            {renameDraft !== null ? (
              <>
                <input
                  aria-label={assistant.sessionName}
                  value={renameDraft}
                  onChange={(event) => setRenameDraft(event.target.value)}
                />
                <button
                  disabled={!renameDraft.trim()}
                  type="button"
                  onClick={() => void renameSession()}
                >
                  {assistant.save}
                </button>
                <button type="button" onClick={() => setRenameDraft(null)}>
                  {assistant.cancel}
                </button>
              </>
            ) : null}
            {deleteArmed ? (
              <>
                <span className="assistant-delete-confirm">{assistant.deleteConfirm}</span>
                <button type="button" onClick={() => void deleteSession()}>
                  {assistant.confirmDelete}
                </button>
                <button type="button" onClick={() => setDeleteArmed(false)}>
                  {assistant.cancel}
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        {status?.state === "ready" && detail ? (
          <AssistantSessionRuntime
            key={detail.id}
            client={client}
            dictionary={dictionary}
            modelOptions={status.models}
            onCreateSession={configureSession}
            onRunError={setError}
            onRunFinished={refreshSessions}
            selectedAttempt={sessionAttempt}
            selectedTask={sessionTask}
            session={detail}
          />
        ) : (
          <div className="assistant-unavailable">
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
