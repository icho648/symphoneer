import { AuiIf, ComposerPrimitive, MessagePrimitive, ThreadPrimitive } from "@assistant-ui/react";
import type { AttemptSnapshot, TaskSummary } from "@symphoneer/contracts";
import type { Dictionary } from "../../i18n/index.ts";

export function DeliveryAssistantThread({
  dictionary,
  selectedAttempt,
  selectedTask,
}: {
  dictionary: Dictionary;
  selectedAttempt: AttemptSnapshot | null;
  selectedTask: TaskSummary | null;
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
            message.role === "user" ? <UserMessage /> : <AssistantMessage label={assistant.label} />
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
          <p className="assistant-compose-hint">{assistant.demoHint}</p>
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

function AssistantMessage({ label }: { label: string }) {
  return (
    <MessagePrimitive.Root className="assistant-aui-assistant">
      <div className="assistant-message-meta">
        <span className="assistant-message-avatar" aria-hidden="true">
          ✦
        </span>
        <strong>{label}</strong>
      </div>
      <div className="assistant-aui-bubble assistant-aui-bubble-assistant">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}
