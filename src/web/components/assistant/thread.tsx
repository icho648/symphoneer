import {
  AttachmentPrimitive,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type ToolCallMessagePartProps,
  useAuiState,
} from "@assistant-ui/react";
import type {
  AssistantClient,
  AssistantModelOption,
  AssistantThinkingLevel,
} from "@symphoneer/assistant-client";
import type { AttemptSnapshot, TaskSummary } from "@symphoneer/contracts";
import { FileText, Paperclip, X } from "lucide-react";
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
  model,
  modelOptions,
  onCreateSession,
  selectedAttempt,
  selectedTask,
  sessionId,
  thinkingLevel,
}: {
  client: AssistantClient;
  dictionary: Dictionary;
  model: string;
  modelOptions: AssistantModelOption[];
  onCreateSession: (options: {
    model: string;
    thinkingLevel: AssistantThinkingLevel;
  }) => Promise<void>;
  selectedAttempt: AttemptSnapshot | null;
  selectedTask: TaskSummary | null;
  sessionId: string;
  thinkingLevel: AssistantThinkingLevel;
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
            ) : message.content.length > 0 ? (
              <AssistantMessage assistant={assistant} client={client} sessionId={sessionId} />
            ) : null
          }
        </ThreadPrimitive.Messages>

        <ThreadPrimitive.ViewportFooter className="assistant-thread-footer">
          <ComposerPrimitive.Root className="assistant-compose-root">
            <ComposerPrimitive.Attachments>
              {() => <AttachmentChip removable removeLabel={assistant.removeAttachment} />}
            </ComposerPrimitive.Attachments>
            <ComposerPrimitive.Input
              className="assistant-compose-input"
              placeholder={assistant.inputPlaceholder}
              rows={2}
            />
            <div className="assistant-compose-toolbar">
              <div className="assistant-compose-options">
                <ComposerPrimitive.AddAttachment
                  aria-label={assistant.addAttachment}
                  className="assistant-compose-option"
                  multiple={false}
                  title={assistant.addAttachment}
                >
                  <Paperclip aria-hidden="true" size={14} />
                </ComposerPrimitive.AddAttachment>
                <SessionConfiguration
                  assistant={assistant}
                  model={model}
                  modelOptions={modelOptions}
                  onCreateSession={onCreateSession}
                  thinkingLevel={thinkingLevel}
                />
              </div>
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
      <div className="assistant-aui-user-content">
        <MessagePrimitive.Attachments>
          {() => <AttachmentChip removable={false} />}
        </MessagePrimitive.Attachments>
        <div className="assistant-aui-bubble assistant-aui-bubble-user">
          <MessagePrimitive.Parts />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function AttachmentChip({ removable, removeLabel }: { removable: boolean; removeLabel?: string }) {
  return (
    <AttachmentPrimitive.Root className="assistant-attachment">
      <FileText aria-hidden="true" size={13} />
      <AttachmentPrimitive.Name />
      {removable ? (
        <AttachmentPrimitive.Remove aria-label={removeLabel} title={removeLabel}>
          <X aria-hidden="true" size={12} />
        </AttachmentPrimitive.Remove>
      ) : null}
    </AttachmentPrimitive.Root>
  );
}

function SessionConfiguration({
  assistant,
  model,
  modelOptions,
  onCreateSession,
  thinkingLevel,
}: {
  assistant: Dictionary["board"]["assistant"];
  model: string;
  modelOptions: AssistantModelOption[];
  onCreateSession: (options: {
    model: string;
    thinkingLevel: AssistantThinkingLevel;
  }) => Promise<void>;
  thinkingLevel: AssistantThinkingLevel;
}) {
  const running = useAuiState((state) => state.thread.isRunning);
  const current = modelOptions.find((option) => option.id === model) ?? modelOptions[0];
  const thinkingLevels = current?.thinkingLevels ?? [thinkingLevel];

  return (
    <>
      <label className="assistant-compose-select">
        <span className="sr-only">{assistant.model}</span>
        <select
          aria-label={assistant.model}
          disabled={running}
          value={model}
          onChange={(event) => {
            const selected = modelOptions.find((option) => option.id === event.target.value);
            if (!selected) return;
            const nextThinking = selected.thinkingLevels.includes(thinkingLevel)
              ? thinkingLevel
              : selected.thinkingLevels[0];
            if (nextThinking) {
              void onCreateSession({ model: selected.id, thinkingLevel: nextThinking });
            }
          }}
        >
          {modelOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
      <label className="assistant-compose-select assistant-thinking-control">
        <span className="assistant-compose-label">{assistant.thinking}</span>
        <select
          aria-label={assistant.thinking}
          disabled={running}
          value={thinkingLevel}
          onChange={(event) => {
            const selected = thinkingLevels.find((level) => level === event.target.value);
            if (selected) void onCreateSession({ model, thinkingLevel: selected });
          }}
        >
          {thinkingLevels.map((level) => (
            <option key={level} value={level}>
              {assistant.thinkingLevels[level]}
            </option>
          ))}
        </select>
      </label>
    </>
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
      : approval && decision !== "submitted"
        ? "approval-requested"
        : approval
          ? "approval-responded"
          : "input-available";
  const decide = async (approved: boolean) => {
    if (!approval || decision === "submitted") return;
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
            <button
              disabled={decision === "submitted"}
              type="button"
              onClick={() => void decide(false)}
            >
              {assistant.reject}
            </button>
            <button
              disabled={decision === "submitted"}
              type="button"
              onClick={() => void decide(true)}
            >
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
