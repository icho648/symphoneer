import type { AttemptSnapshot, TaskSummary } from "@symphoneer/contracts";
import type { Dictionary } from "../../i18n/index.ts";

export function AssistantShell({
  dictionary,
  onClose,
  selectedAttempt,
  selectedTask,
}: {
  dictionary: Dictionary;
  onClose: () => void;
  selectedAttempt: AttemptSnapshot | null;
  selectedTask: TaskSummary | null;
}) {
  const assistant = dictionary.board.assistant;
  const taskState = selectedTask?.state ?? assistant.noTask;

  return (
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
          aria-label={assistant.close}
          className="assistant-close"
          title={assistant.close}
          type="button"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <div className="assistant-slot-status">
        <span className="assistant-status-dot" aria-hidden="true" />
        <span>{assistant.ready}</span>
        <span className="assistant-status-note">{assistant.optional}</span>
      </div>

      <div className="assistant-thread" role="log" aria-live="polite">
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
        <fieldset className="assistant-suggestions">
          <legend className="sr-only">{assistant.suggestionsLabel}</legend>
          <button className="assistant-suggestion" disabled type="button">
            {assistant.suggestions.explain}
          </button>
          <button className="assistant-suggestion" disabled type="button">
            {assistant.suggestions.attention}
          </button>
          <button className="assistant-suggestion" disabled type="button">
            {assistant.suggestions.summary}
          </button>
        </fieldset>
      </div>

      <footer className="assistant-compose">
        <div className="assistant-input-shell" aria-disabled="true">
          <textarea
            aria-label={assistant.inputPlaceholder}
            disabled
            placeholder={assistant.inputPlaceholder}
            rows={2}
          />
          <button aria-label={assistant.disabledHint} disabled type="button">
            <span aria-hidden="true">↑</span>
          </button>
        </div>
        <p>{assistant.disabledHint}</p>
      </footer>
    </aside>
  );
}
