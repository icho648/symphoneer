import type { AttemptSnapshot, DisplayState } from "@symphoneer/contracts";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "../../i18n/index.ts";
import { providerPresentation } from "../../lib/provider-presentation.ts";
import { visibleTaskLabels } from "../../lib/task-column.ts";
import {
  selectActiveAttempt,
  selectSelectedAttempts,
  selectSelectedTask,
  useWorkbench,
} from "../../stores/workbench.ts";
import { ExecutionActivityFeed } from "./execution-activity";

export function TaskOverview() {
  const { attempt, closeTask, connection, detail, dictionary, task, selectAttempt, sendCommand } =
    useWorkbench(
      useShallow((state) => ({
        attempt: selectActiveAttempt(state),
        closeTask: state.closeTask,
        connection: state.connection,
        detail: state.detail,
        dictionary: state.dictionary,
        task: selectSelectedTask(state),
        selectAttempt: state.selectAttempt,
        sendCommand: state.sendCommand,
      })),
    );
  const attempts = useWorkbench(useShallow(selectSelectedAttempts));
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const [creatingAttempt, setCreatingAttempt] = useState(false);
  if (!task) return null;
  const labels = visibleTaskLabels(task.labels);
  const hasActiveAttempt = attempts.some(
    (item) => item.controller === "codex" || (item.finishedAt == null && item.status !== "paused"),
  );
  const workflow = detail?.teamRuns.at(-1);
  const mode = workflow?.workflow ?? dictionary.taskCard.modes.single;
  const currentNode = workflow
    ? (dictionary.workflow.nodes[workflow.currentNode as keyof typeof dictionary.workflow.nodes] ??
      workflow.currentNode)
    : attempt
      ? (dictionary.statuses[attempt.status] ?? attempt.status)
      : dictionary.detail.notStarted;
  const provider = detail?.session?.provider ?? attempt?.providerSession?.provider ?? null;

  return (
    <section className="attempt-view" id="task-view" aria-labelledby="task-view-title">
      <header className="task-view-header">
        <div className="task-view-title-row">
          <button className="back-button" type="button" onClick={closeTask}>
            <span aria-hidden="true">←</span>
            {dictionary.detail.backToTasks}
          </button>
          <div className="task-view-actions">
            <div className="attempt-picker">
              <span>{dictionary.detail.attempts}</span>
              <strong>{attempts.length}</strong>
              {attempts.length > 0 ? (
                <select
                  aria-label={dictionary.detail.attempts}
                  value={attempt?.id ?? ""}
                  onChange={(event) => {
                    const selected = attempts.find((item) => item.id === event.target.value);
                    if (selected) selectAttempt(selected);
                  }}
                >
                  {!attempt && <option value="">—</option>}
                  {attempts.map((item) => (
                    <option key={item.id} value={item.id}>
                      #{String(item.sequence).padStart(2, "0")} ·{" "}
                      {dictionary.statuses[item.status] ?? item.status}
                    </option>
                  ))}
                </select>
              ) : (
                <em>{dictionary.detail.notStarted}</em>
              )}
            </div>
            {attempts.length > 0 && (
              <Button
                disabled={connection === "offline" || hasActiveAttempt || creatingAttempt}
                size="xs"
                title={hasActiveAttempt ? dictionary.detail.activity.newAttemptBlocked : undefined}
                type="button"
                variant="outline"
                onClick={() => {
                  setCreatingAttempt(true);
                  void sendCommand({ kind: "retry_attempt" }).finally(() =>
                    setCreatingAttempt(false),
                  );
                }}
              >
                <RotateCcw /> {dictionary.detail.activity.newAttempt}
              </Button>
            )}
            <a className="macos-btn" href={task.source.url} target="_blank" rel="noreferrer">
              {dictionary.detail.openGitHub}
            </a>
          </div>
        </div>

        <div className="task-orchestration-strip">
          <div className="task-orchestration-identity">
            <strong>{mode}</strong>
            <span>{currentNode}</span>
          </div>
          <OrchestrationProgress
            attempt={attempt}
            dictionary={dictionary}
            provider={provider}
            displayState={task.displayState}
          />
        </div>
      </header>

      <main className="task-detail-layout">
        <section className="task-issue-pane" aria-labelledby="task-issue-title">
          <header>
            <div>
              <p className="eyebrow-label">
                {task.identifier} · {displayStateLabel(task.displayState, dictionary)}
              </p>
              <h1 id="task-view-title">{task.title}</h1>
              <p className="task-issue-source">GitHub · {task.state}</p>
            </div>
            {labels.length > 0 && <span>{labels.join(" · ")}</span>}
          </header>
          <h2 id="task-issue-title">{dictionary.detail.issueDescription}</h2>
          <pre className={bodyExpanded ? "is-expanded" : ""}>
            {task.body || dictionary.detail.noDescription}
          </pre>
          {task.body && (
            <button
              className="task-body-toggle"
              type="button"
              onClick={() => setBodyExpanded(!bodyExpanded)}
            >
              {bodyExpanded ? dictionary.detail.collapseBody : dictionary.detail.expandBody}
            </button>
          )}
          {detail?.workspace && (
            <dl className="task-workspace-summary">
              <div>
                <dt>{dictionary.attempt.workspace}</dt>
                <dd>
                  {task.identifier} · {dictionary.attempt.label} {detail.attempt.sequence}
                </dd>
              </div>
              <div>
                <dt>{dictionary.attempt.state}</dt>
                <dd>{detail.workspace.state}</dd>
              </div>
              <div>
                <dt>{dictionary.attempt.branch}</dt>
                <dd title={detail.workspace.branch}>{detail.workspace.branch}</dd>
              </div>
            </dl>
          )}
        </section>

        <ExecutionActivityFeed />
      </main>
    </section>
  );
}

function OrchestrationProgress({
  attempt,
  dictionary,
  provider,
  displayState,
}: {
  attempt: AttemptSnapshot | null;
  dictionary: Dictionary;
  provider: string | null;
  displayState: DisplayState;
}) {
  const states = orchestrationStates(attempt, displayState);
  const providerKind = providerPresentation(provider).kind;
  const labels = [
    dictionary.detail.executionSteps.workspace,
    providerKind === "claude"
      ? dictionary.detail.executionSteps.claude
      : providerKind === "codex"
        ? dictionary.detail.executionSteps.codex
        : dictionary.detail.executionSteps.agent,
    dictionary.detail.executionSteps.review,
  ];
  return (
    <ol className="task-orchestration-progress">
      {labels.map((label, index) => (
        <li className={`is-${states[index]}`} key={label}>
          <span aria-hidden="true" />
          <strong>{label}</strong>
        </li>
      ))}
    </ol>
  );
}

function orchestrationStates(
  attempt: AttemptSnapshot | null,
  displayState: DisplayState,
): Array<"waiting" | "active" | "done" | "failed"> {
  if (!attempt) return ["waiting", "waiting", "waiting"];
  if (displayState === "in_review") return ["done", "done", "active"];
  if (displayState === "done") return ["done", "done", "done"];
  if (attempt.status === "preparing_workspace") return ["active", "waiting", "waiting"];
  if (["failed", "timed_out", "stalled", "canceled_by_reconciliation"].includes(attempt.status))
    return ["done", "failed", "waiting"];
  if (attempt.status === "succeeded") return ["done", "done", "active"];
  if (attempt.status === "paused") return ["done", "waiting", "waiting"];
  return ["done", "active", "waiting"];
}

function displayStateLabel(status: DisplayState, dictionary: Dictionary): string {
  return {
    backlog: dictionary.columns.backlog.label,
    ready: dictionary.taskCard.markReady,
    in_progress: dictionary.columns.inProgress.label,
    in_review: dictionary.columns.inReview.label,
    done: dictionary.columns.done.label,
  }[status];
}
