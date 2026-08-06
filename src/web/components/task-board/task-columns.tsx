import type {
  AttemptSnapshot,
  RuntimeSnapshot,
  TaskSummary,
  TeamRunSnapshot,
} from "@symphoneer/contracts";
import type { Dictionary } from "../../i18n/index.ts";

import { type BoardColumn, taskColumn } from "../../lib/task-column";
import { visibleNode, WorkflowMap } from "./workflow-map";

export type TaskStatusFilter = "ALL" | BoardColumn;

export function TaskColumns({
  connection,
  dictionary,
  filter,
  onFilterChange,
  onOpenTask,
  onStartWorkflow,
  selectedTaskId,
  snapshot,
}: {
  connection: RuntimeSnapshot["runtime"]["status"];
  dictionary: Dictionary;
  filter: TaskStatusFilter;
  onFilterChange: (filter: TaskStatusFilter) => void;
  onOpenTask: (task: TaskSummary, attempt: AttemptSnapshot | null) => void;
  onStartWorkflow: (task: TaskSummary) => void;
  selectedTaskId: string | null;
  snapshot: RuntimeSnapshot | null;
}) {
  const filters: Array<{ id: TaskStatusFilter; label: string }> = [
    { id: "ALL", label: dictionary.board.filters.all },
    { id: "READY", label: dictionary.columns.ready.label },
    { id: "RUNNING", label: dictionary.columns.running.label },
    { id: "REVIEW", label: dictionary.columns.review.label },
    { id: "BLOCKED", label: dictionary.columns.blocked.label },
  ];
  const tasks = snapshot?.tasks ?? [];
  const attempts = snapshot?.attempts ?? [];
  const counts = filters.reduce<Record<TaskStatusFilter, number>>(
    (result, item) => {
      result[item.id] =
        item.id === "ALL"
          ? tasks.length
          : tasks.filter((task) => taskColumn(task, attempts) === item.id).length;
      return result;
    },
    { ALL: tasks.length, READY: 0, RUNNING: 0, REVIEW: 0, BLOCKED: 0 },
  );
  const visibleTasks = tasks.filter(
    (task) => filter === "ALL" || taskColumn(task, attempts) === filter,
  );

  return (
    <div className="task-overview-body">
      <div className="task-overview-toolbar">
        <div className="task-filter" role="tablist" aria-label={dictionary.board.filters.label}>
          {filters.map((item) => (
            <button
              aria-selected={filter === item.id}
              className="task-filter-item"
              key={item.id}
              role="tab"
              type="button"
              onClick={() => onFilterChange(item.id)}
            >
              <span>{item.label}</span>
              <span className="task-filter-count">{counts[item.id]}</span>
            </button>
          ))}
        </div>
        <span className="task-overview-total">
          {visibleTasks.length} / {tasks.length} {dictionary.board.filters.tasks}
        </span>
      </div>

      {connection === "offline" && (
        <div className="task-alert task-alert-danger" role="alert">
          <span className="task-alert-mark" aria-hidden="true">
            !
          </span>
          <span>{dictionary.board.runtimeUnavailable}</span>
        </div>
      )}

      <div className="task-card-grid" role="tabpanel">
        {visibleTasks.map((task) => (
          <TaskCard
            attempt={latestAttempt(task, attempts)}
            connection={connection}
            dictionary={dictionary}
            key={task.id}
            onOpen={() => onOpenTask(task, latestAttempt(task, attempts))}
            onStart={() => onStartWorkflow(task)}
            selected={selectedTaskId === task.id}
            snapshot={snapshot}
            task={task}
          />
        ))}
        {visibleTasks.length === 0 && (
          <div className="task-overview-empty">
            <span className="task-overview-empty-mark" aria-hidden="true">
              ◌
            </span>
            <p>{dictionary.columns.empty}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function TaskCard({
  attempt,
  connection,
  dictionary,
  onOpen,
  onStart,
  selected,
  snapshot,
  task,
}: {
  attempt: AttemptSnapshot | null;
  connection: RuntimeSnapshot["runtime"]["status"];
  dictionary: Dictionary;
  onOpen: () => void;
  onStart: () => void;
  selected: boolean;
  snapshot: RuntimeSnapshot | null;
  task: TaskSummary;
}) {
  const workflow = attempt
    ? latestWorkflow(snapshot?.teamRuns.filter((run) => run.attemptId === attempt.id) ?? [])
    : null;
  const agent = workflow ? latestAgent(snapshot, workflow.id) : null;
  const verification = attempt ? latestVerification(snapshot, attempt.id) : null;
  const mode = workflow
    ? dictionary.taskCard.modes.workflow
    : task.labels.includes("symphoneer:review")
      ? dictionary.taskCard.modes.autopilot
      : dictionary.taskCard.modes.single;
  const warnings = [
    connection === "offline" ? dictionary.taskCard.runtimeOffline : null,
    !task.dispatchable ? dictionary.taskCard.dispatchBlocked : null,
    attempt?.failure ?? null,
    workflow?.pendingHumanInput ? dictionary.taskCard.humanAction : null,
  ].filter((value): value is string => value != null);

  return (
    <article className={`task-card-wrap ${selected ? "is-selected" : ""}`}>
      <button aria-pressed={selected} className="task-card" type="button" onClick={onOpen}>
        <span className="task-card-source">
          <span className="task-card-source-mark" aria-hidden="true">
            ◇
          </span>
          <span>{formatTracker(task.source.kind)}</span>
          <span className="task-card-source-separator">/</span>
          <code>{repositoryFromUrl(task.source.url)}</code>
          <span className="task-card-source-separator">/</span>
          <strong>{task.identifier}</strong>
          {task.priority != null && <span className="task-card-priority">P{task.priority}</span>}
        </span>
        <span className="task-card-heading">
          <strong className="task-card-title">{task.title}</strong>
          <span className="task-card-state">
            {dictionary.statuses[task.state as keyof typeof dictionary.statuses] ?? task.state}
          </span>
        </span>
        <span className="task-card-labels">
          {task.labels.length ? task.labels.join(" · ") : dictionary.columns.noLabels}
        </span>

        <span className="task-card-runline">
          <span>
            <small>{dictionary.taskCard.mode}</small>
            <strong>{mode}</strong>
          </span>
          <span>
            <small>{dictionary.detail.executor}</small>
            <strong>
              {workflow
                ? workflow.provider === "codex-app-server"
                  ? dictionary.workflow.codexShort
                  : dictionary.workflow.fakeShort
                : dictionary.taskCard.notStarted}
            </strong>
          </span>
          <span>
            <small>{dictionary.detail.workflow}</small>
            <strong>{workflow?.workflow ?? dictionary.taskCard.notStarted}</strong>
          </span>
        </span>

        <span className="task-card-attemptline">
          <span>
            <small>{dictionary.taskCard.latestAttempt}</small>
            <strong>
              {attempt
                ? `${dictionary.detail.attempt} ${String(attempt.sequence).padStart(2, "0")}`
                : dictionary.taskCard.notStarted}
            </strong>
          </span>
          <span>
            <small>{dictionary.taskCard.runtime}</small>
            <strong>{attempt ? formatElapsed(attempt.startedAt, attempt.finishedAt) : "—"}</strong>
          </span>
          <span>
            <small>{dictionary.taskCard.workspace}</small>
            <strong>{attempt ? workspaceState(attempt) : dictionary.taskCard.notStarted}</strong>
          </span>
        </span>

        {workflow ? (
          <div className="task-card-workflow">
            <div className="task-card-section-heading">
              <span>{dictionary.taskCard.orchestration}</span>
              <span className="task-card-current-node">
                {dictionary.taskCard.current}: {dictionary.workflow.nodes[visibleNode(workflow)]}
              </span>
            </div>
            <WorkflowMap compact dictionary={dictionary} workflow={workflow} />
          </div>
        ) : (
          <div className="task-card-workflow task-card-workflow-empty">
            <span className="task-card-section-heading">{dictionary.taskCard.orchestration}</span>
            <span>{dictionary.taskCard.noWorkflow}</span>
          </div>
        )}

        <span className="task-card-status-rows">
          <StatusRow
            label={dictionary.taskCard.agent}
            value={agent ? agentLabel(agent, dictionary) : dictionary.taskCard.notStarted}
          />
          <StatusRow
            label={dictionary.taskCard.verification}
            value={verificationLabel(verification, workflow, dictionary)}
          />
          <StatusRow
            label={dictionary.taskCard.human}
            value={workflow?.pendingHumanInput?.prompt ?? dictionary.taskCard.noAction}
            tone={workflow?.pendingHumanInput ? "attention" : ""}
          />
        </span>

        {warnings.length > 0 && (
          <span className="task-card-alerts">
            {warnings.map((warning) => (
              <span className="task-card-alert" key={warning}>
                <span aria-hidden="true">!</span>
                {warning}
              </span>
            ))}
          </span>
        )}
      </button>
      {!attempt && (
        <button className="task-card-start" type="button" onClick={onStart}>
          {dictionary.workflow.start}
        </button>
      )}
    </article>
  );
}

function StatusRow({
  label,
  tone = "",
  value,
}: {
  label: string;
  tone?: "attention" | "";
  value: string;
}) {
  return (
    <span className={`task-card-status-row ${tone ? `is-${tone}` : ""}`}>
      <span className="task-card-status-label">{label}</span>
      <span className="task-card-status-value">{value}</span>
    </span>
  );
}

function latestAttempt(
  task: TaskSummary,
  attempts: readonly AttemptSnapshot[],
): AttemptSnapshot | null {
  return (
    attempts
      .filter((attempt) => attempt.taskId === task.id)
      .sort((a, b) => b.sequence - a.sequence)[0] ?? null
  );
}

function latestWorkflow(runs: TeamRunSnapshot[]): TeamRunSnapshot | null {
  return runs.reduce<TeamRunSnapshot | null>(
    (latest, run) => (!latest || run.updatedAt > latest.updatedAt ? run : latest),
    null,
  );
}

function latestAgent(snapshot: RuntimeSnapshot | null, teamRunId: string) {
  return (
    snapshot?.agentRuns
      .filter((agent) => agent.teamRunId === teamRunId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  );
}

function latestVerification(snapshot: RuntimeSnapshot | null, attemptId: string) {
  return (
    snapshot?.verifications
      .filter((verification) => verification.attemptId === attemptId)
      .sort((a, b) =>
        (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt),
      )[0] ?? null
  );
}

function agentLabel(
  agent: NonNullable<ReturnType<typeof latestAgent>>,
  dictionary: Dictionary,
): string {
  const role = dictionary.workflow.roles[agent.role] ?? agent.role;
  const status = dictionary.workflow.agentStatuses[agent.status] ?? agent.status;
  return `${role} · ${status}`;
}

function verificationLabel(
  verification: ReturnType<typeof latestVerification>,
  workflow: TeamRunSnapshot | null,
  dictionary: Dictionary,
): string {
  const status = verification?.status ?? workflow?.verificationStatus;
  if (!status) return dictionary.statuses.not_verified;
  return dictionary.statuses[status] ?? status;
}

function workspaceState(attempt: AttemptSnapshot): string {
  return activeAttemptStatus(attempt.status) ? "active" : "retained";
}

function activeAttemptStatus(status: AttemptSnapshot["status"]): boolean {
  return [
    "preparing_workspace",
    "building_prompt",
    "launching_agent",
    "initializing_session",
    "streaming_turn",
    "paused",
    "finishing",
  ].includes(status);
}

function formatElapsed(startedAt: string, finishedAt?: string | null): string {
  const end = finishedAt ? Date.parse(finishedAt) : Date.now();
  const seconds = Math.max(0, Math.floor((end - Date.parse(startedAt)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function repositoryFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : url;
  } catch {
    return url;
  }
}

function formatTracker(kind: string): string {
  if (kind === "github") return "GitHub";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}
