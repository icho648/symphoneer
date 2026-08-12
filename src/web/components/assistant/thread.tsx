import {
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import type { AssistantClient } from "@symphoneer/assistant-client";
import type { AttemptSnapshot, TaskSummary } from "@symphoneer/contracts";
import { createContext, useContext, useMemo, useState } from "react";
import type { Dictionary } from "../../i18n/index.ts";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "../ai-elements/tool.tsx";

type RuntimeToolContextValue = {
  assistant: Dictionary["board"]["assistant"];
  client: AssistantClient;
  sessionId: string;
};

const RuntimeToolContext = createContext<RuntimeToolContextValue | null>(null);
const toolComponents = { tools: { Fallback: RuntimeToolFallback } };

export function DeliveryAssistantThread({
  client,
  dictionary,
  selectedAttempt,
  selectedTask,
  sessionId,
}: {
  client: AssistantClient;
  dictionary: Dictionary;
  selectedAttempt: AttemptSnapshot | null;
  selectedTask: TaskSummary | null;
  sessionId: string;
}) {
  const assistant = dictionary.board.assistant;
  const taskState = selectedTask?.state ?? assistant.noTask;

  return (
    <ThreadPrimitive.Root className="assistant-thread-root">
      <ThreadPrimitive.Viewport className="assistant-thread-viewport">
        <AuiIf condition={(state) => state.thread.isEmpty}>
          <div className="assistant-empty">
            <article className="assistant-message assistant-message-assistant">
              <div className="assistant-message-meta">
                <span className="assistant-message-avatar" aria-hidden="true">
                  ✦
                </span>
                <strong>{assistant.label}</strong>
              </div>
              <p>{assistant.welcome}</p>
            </article>

            <article className="assistant-context-card">
              <p className="assistant-card-eyebrow">{assistant.context}</p>
              <strong>{selectedTask?.title ?? assistant.noTask}</strong>
              <span>
                {selectedTask ? `${selectedTask.identifier} · ${taskState}` : assistant.noTask}
              </span>
              <dl className="assistant-context-facts">
                <div>
                  <dt>{assistant.task}</dt>
                  <dd>{selectedTask?.identifier ?? "—"}</dd>
                </div>
                <div>
                  <dt>{assistant.attempt}</dt>
                  <dd>
                    {selectedAttempt
                      ? `${assistant.attempt} ${String(selectedAttempt.sequence).padStart(2, "0")}`
                      : "—"}
                  </dd>
                </div>
              </dl>
            </article>

            <div className="assistant-suggestions-heading">{assistant.suggestionsLabel}</div>
            <div className="assistant-suggestions">
              <ThreadPrimitive.Suggestion
                className="assistant-suggestion"
                prompt={assistant.suggestions.explain}
                send
              />
              <ThreadPrimitive.Suggestion
                className="assistant-suggestion"
                prompt={assistant.suggestions.attention}
                send
              />
              <ThreadPrimitive.Suggestion
                className="assistant-suggestion"
                prompt={assistant.suggestions.summary}
                send
              />
            </div>
          </div>
        </AuiIf>

        <ThreadPrimitive.Messages>
          {({ message }) =>
            message.role === "user" ? (
              <UserMessage />
            ) : (
              <AssistantMessage assistant={assistant} client={client} sessionId={sessionId} />
            )
          }
        </ThreadPrimitive.Messages>

        <ThreadPrimitive.ViewportFooter className="assistant-thread-footer">
          <ComposerPrimitive.Root className="assistant-compose-root">
            <ComposerPrimitive.Input
              className="assistant-compose-input"
              placeholder={assistant.inputPlaceholder}
              rows={2}
            />
            <div className="assistant-compose-actions">
              <AuiIf condition={(state) => state.thread.isRunning}>
                <ComposerPrimitive.Cancel className="assistant-compose-cancel" aria-label="Stop">
                  ■
                </ComposerPrimitive.Cancel>
              </AuiIf>
              <AuiIf condition={(state) => !state.thread.isRunning}>
                <ComposerPrimitive.Send
                  className="assistant-compose-send"
                  aria-label={assistant.inputPlaceholder}
                >
                  ↑
                </ComposerPrimitive.Send>
              </AuiIf>
            </div>
          </ComposerPrimitive.Root>
          <p className="assistant-compose-hint">{assistant.hint}</p>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="assistant-aui-user">
      <div className="assistant-aui-bubble assistant-aui-bubble-user">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage({
  assistant,
  client,
  sessionId,
}: {
  assistant: Dictionary["board"]["assistant"];
  client: AssistantClient;
  sessionId: string;
}) {
  const toolContext = useMemo(
    () => ({ assistant, client, sessionId }),
    [assistant, client, sessionId],
  );
  return (
    <MessagePrimitive.Root className="assistant-aui-assistant">
      <div className="assistant-message-meta">
        <span className="assistant-message-avatar" aria-hidden="true">
          ✦
        </span>
        <strong>{assistant.label}</strong>
      </div>
      <div className="assistant-aui-bubble assistant-aui-bubble-assistant">
        <RuntimeToolContext.Provider value={toolContext}>
          <MessagePrimitive.Parts components={toolComponents} />
        </RuntimeToolContext.Provider>
      </div>
    </MessagePrimitive.Root>
  );
}

function RuntimeToolFallback(props: ToolCallMessagePartProps) {
  const context = useContext(RuntimeToolContext);
  if (!context) throw new Error("Runtime tool context is missing");
  return <RuntimeToolPart {...props} {...context} />;
}

function RuntimeToolPart({
  approval,
  args,
  assistant,
  client,
  isError,
  result,
  sessionId,
  toolName,
}: ToolCallMessagePartProps & {
  assistant: Dictionary["board"]["assistant"];
  client: AssistantClient;
  sessionId: string;
}) {
  const [decision, setDecision] = useState<"idle" | "submitted" | "failed">("idle");
  const state =
    result !== undefined
      ? isError
        ? "output-error"
        : "output-available"
      : approval && decision === "idle"
        ? "approval-requested"
        : approval
          ? "approval-responded"
          : "input-available";
  const decide = async (approved: boolean) => {
    if (!approval || decision !== "idle") return;
    setDecision("submitted");
    try {
      await client.respondApproval(sessionId, approval.id, approved);
    } catch {
      setDecision("failed");
    }
  };

  return (
    <Tool defaultOpen={Boolean(approval || isError)}>
      <ToolHeader state={state} toolName={toolName} type="dynamic-tool" />
      <ToolContent>
        <ToolInput input={args} />
        {approval && result === undefined ? (
          <div className="assistant-tool-approval">
            <button disabled={decision !== "idle"} type="button" onClick={() => void decide(false)}>
              {assistant.reject}
            </button>
            <button disabled={decision !== "idle"} type="button" onClick={() => void decide(true)}>
              {assistant.approve}
            </button>
            {decision === "failed" ? <span>{assistant.approvalFailed}</span> : null}
          </div>
        ) : null}
        <ToolOutput
          errorText={isError ? stringifyResult(result) : undefined}
          output={isError ? undefined : result}
        />
      </ToolContent>
    </Tool>
  );
}

function stringifyResult(result: unknown): string {
  return typeof result === "string" ? result : (JSON.stringify(result, null, 2) ?? "");
}
