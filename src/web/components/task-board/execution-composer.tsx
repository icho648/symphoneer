import type { CodexReasoningEffort, CodexSandbox } from "@symphoneer/contracts";
import {
  ChevronDown,
  ExternalLink,
  MessageSquarePlus,
  MoreHorizontal,
  Pause,
  Play,
  SendHorizontal,
  Tag,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CommandIntent } from "../../stores/runtime-commands.ts";
import { selectActiveAttempt, selectSelectedTask, useWorkbench } from "../../stores/workbench.ts";

export function ExecutionComposer() {
  const {
    attempt,
    codexModels,
    connection,
    detail,
    dictionary,
    loadCodexModels,
    task,
    sendCommand,
    startWorkflow,
  } = useWorkbench(
    useShallow((state) => ({
      attempt: selectActiveAttempt(state),
      codexModels: state.codexModels,
      connection: state.connection,
      detail: state.detail,
      dictionary: state.dictionary,
      loadCodexModels: state.loadCodexModels,
      task: selectSelectedTask(state),
      sendCommand: state.sendCommand,
      startWorkflow: state.startWorkflow,
    })),
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [model, setModel] = useState("");
  const [sandbox, setSandbox] = useState<CodexSandbox | "">("");
  const [effort, setEffort] = useState<CodexReasoningEffort | "">("");
  const taskId = task?.id;
  const projectId = task?.projectId;
  useEffect(() => {
    if (taskId) void loadCodexModels(projectId);
  }, [loadCodexModels, projectId, taskId]);
  if (!task) return null;
  const intervention = detail?.interventions.find((item) => item.state === "pending") ?? null;
  const inputRequired = intervention?.kind === "input";
  const threadId = attempt?.providerSession?.threadId;
  const pausable = attempt != null && attempt.finishedAt == null && attempt.status !== "paused";
  const canStart =
    !attempt &&
    task.dispatchable &&
    (task.workflowStatus === "backlog" || task.workflowStatus === "ready");
  const canApplySettings = intervention == null && attempt?.activeTurn == null;
  const showSettings = canStart || Boolean(threadId);
  const selectedModelName = codexModels.some((item) => item.model === model) ? model : "";
  const selectedModel =
    codexModels.find((item) => item.model === selectedModelName) ??
    codexModels.find((item) => item.isDefault) ??
    codexModels[0];
  const selectedEffort = selectedModel?.supportedReasoningEfforts.some(
    (item) => item.reasoningEffort === effort,
  )
    ? effort
    : "";
  const selectedSettings = canApplySettings
    ? {
        ...(selectedModelName ? { model: selectedModelName } : {}),
        ...(sandbox ? { sandbox } : {}),
        ...(selectedEffort ? { effort: selectedEffort } : {}),
      }
    : {};
  const hasInput = Boolean(inputRequired || threadId);
  const canSend = connection === "online" && !busy && hasInput;
  const showComposer = showSettings || hasInput;
  const panelOpen = showComposer && (composerOpen || inputRequired);

  const run = async (command: CommandIntent) => {
    setBusy(true);
    try {
      await sendCommand(command);
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    const prompt = message.trim();
    if (!prompt || !canSend) return;
    setMessage("");
    await run(
      intervention?.kind === "input"
        ? {
            kind: "respond_intervention",
            interventionId: intervention.id,
            decision: "answered",
            response: prompt,
          }
        : { kind: "send_attempt_input", prompt, ...selectedSettings },
    );
  };

  return (
    <form
      className="task-execution-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="task-execution-toolbar">
        {intervention?.kind === "approval" && (
          <>
            <Button
              disabled={busy}
              size="xs"
              type="button"
              onClick={() =>
                void run({
                  kind: "respond_intervention",
                  interventionId: intervention.id,
                  decision: "approved",
                })
              }
            >
              {dictionary.detail.activity.approve}
            </Button>
            <Button
              disabled={busy}
              size="xs"
              type="button"
              variant="outline"
              onClick={() =>
                void run({
                  kind: "respond_intervention",
                  interventionId: intervention.id,
                  decision: "rejected",
                })
              }
            >
              {dictionary.detail.activity.reject}
            </Button>
          </>
        )}
        {!attempt &&
          !task.dispatchable &&
          (task.workflowStatus === "backlog" || task.workflowStatus === "ready") && (
            <Button
              disabled={connection === "offline" || busy}
              size="xs"
              title={dictionary.detail.activity.enableDispatchHint}
              type="button"
              onClick={() => void run({ kind: "enable_task_dispatch" })}
            >
              <Tag /> {dictionary.detail.activity.enableDispatch}
            </Button>
          )}
        {showComposer && !inputRequired && (
          <Button
            aria-controls="task-execution-panel"
            aria-expanded={panelOpen}
            size="xs"
            type="button"
            variant="ghost"
            onClick={() => setComposerOpen((open) => !open)}
          >
            <MessageSquarePlus />
            {panelOpen
              ? dictionary.detail.activity.collapseComposer
              : canStart
                ? dictionary.detail.activity.executionSettings
                : dictionary.detail.activity.addInstruction}
            <ChevronDown className="task-execution-chevron" data-open={panelOpen} />
          </Button>
        )}
        {canStart && (
          <Button
            disabled={connection === "offline"}
            size="xs"
            type="button"
            onClick={() => startWorkflow(task, selectedSettings)}
          >
            <Play />
            {dictionary.workflow.start}
          </Button>
        )}
        {task.workflowStatus === "in_review" && (
          <Button
            disabled={connection === "offline" || busy || !detail}
            size="xs"
            type="button"
            onClick={() =>
              void run({
                kind: "record_review",
                evidenceIds: detail?.verifications.map((verification) => verification.id) ?? [],
              })
            }
          >
            {dictionary.taskCard.markDone}
          </Button>
        )}
        {pausable && (
          <Button
            disabled={busy}
            size="xs"
            title={dictionary.detail.requestPause}
            type="button"
            variant="outline"
            onClick={() => void run({ kind: "pause_attempt" })}
          >
            <Pause /> {dictionary.detail.requestPause}
          </Button>
        )}
        {threadId && (
          <Button
            disabled={busy}
            size="xs"
            type="button"
            variant="outline"
            onClick={() => void run({ kind: "handoff_attempt" })}
          >
            <ExternalLink /> {dictionary.detail.continueInCodex}
          </Button>
        )}
        {attempt && (
          <details className="task-more-menu">
            <summary aria-label={dictionary.detail.moreActions}>
              <MoreHorizontal />
            </summary>
            <button type="button" onClick={() => void run({ kind: "delete_attempt" })}>
              <Trash2 /> {dictionary.detail.deleteAttempt}
            </button>
          </details>
        )}
      </div>
      <div
        aria-hidden={!panelOpen}
        className="task-execution-panel"
        data-open={panelOpen}
        id="task-execution-panel"
        inert={!panelOpen}
      >
        <div className="task-execution-panel-inner">
          {hasInput && (
            <Textarea
              aria-label={dictionary.detail.activity.input}
              className="task-execution-input"
              disabled={!canSend}
              placeholder={
                inputRequired
                  ? dictionary.detail.activity.interventionPlaceholder
                  : dictionary.detail.activity.composerPlaceholder
              }
              rows={2}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
          )}
          <div className="task-execution-composer-actions">
            {showSettings && !inputRequired && (
              <>
                <label className="task-codex-setting">
                  <span>{dictionary.detail.activity.permission}</span>
                  <select
                    aria-label={dictionary.detail.activity.permission}
                    disabled={!canApplySettings || busy || connection === "offline"}
                    value={sandbox}
                    onChange={(event) => setSandbox(event.target.value as CodexSandbox | "")}
                  >
                    <option value="">{dictionary.detail.activity.projectDefault}</option>
                    <option value="read-only">{dictionary.detail.activity.readOnly}</option>
                    <option value="workspace-write">
                      {dictionary.detail.activity.workspaceWrite}
                    </option>
                    <option value="danger-full-access">
                      {dictionary.detail.activity.fullAccess}
                    </option>
                  </select>
                </label>
                <label className="task-codex-setting">
                  <span>{dictionary.detail.activity.model}</span>
                  <select
                    aria-label={dictionary.detail.activity.model}
                    disabled={
                      !canApplySettings ||
                      busy ||
                      connection === "offline" ||
                      codexModels.length === 0
                    }
                    value={selectedModelName}
                    onChange={(event) => {
                      setModel(event.target.value);
                      setEffort("");
                    }}
                  >
                    <option value="">{dictionary.detail.activity.codexDefault}</option>
                    {codexModels.map((item) => (
                      <option key={item.id} value={item.model}>
                        {item.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="task-codex-setting">
                  <span>{dictionary.detail.activity.effort}</span>
                  <select
                    aria-label={dictionary.detail.activity.effort}
                    disabled={
                      !canApplySettings || busy || connection === "offline" || selectedModel == null
                    }
                    value={selectedEffort}
                    onChange={(event) => setEffort(event.target.value as CodexReasoningEffort | "")}
                  >
                    <option value="">{dictionary.detail.activity.modelDefault}</option>
                    {selectedModel?.supportedReasoningEfforts.map((item) => (
                      <option key={item.reasoningEffort} value={item.reasoningEffort}>
                        {item.reasoningEffort}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {hasInput && (
              <Button
                className="ml-auto"
                disabled={!canSend || !message.trim()}
                size="icon-sm"
                title={dictionary.detail.activity.send}
                type="submit"
              >
                <SendHorizontal />
              </Button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
