import type { RuntimeAttemptDetail, TeamRunSnapshot } from "@symphoneer/contracts";
import { formatDateTime } from "@/lib/format";
import type { Dictionary, Locale } from "../../i18n/index.ts";
import type { CommandIntent } from "./task-detail";
import { WorkflowMap } from "./workflow-map";

export function AttemptDetail({
  detail,
  dictionary,
  locale,
  onCommand,
}: {
  detail: RuntimeAttemptDetail;
  dictionary: Dictionary;
  locale: Locale;
  onCommand: (command: CommandIntent) => void;
}) {
  return (
    <section className="attempt-detail-panel" aria-labelledby="attempt-detail-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold" id="attempt-detail-title">
          {dictionary.attempt.detail}
        </h3>
        <span className="font-mono text-[11px] text-faint">
          {formatDateTime(detail.attempt.updatedAt, locale)}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 min-[701px]:grid-cols-3">
        <span className="grid gap-1 rounded-[8px] border border-line bg-panel px-3 py-2.5">
          <small className="text-[11px] text-faint">{dictionary.attempt.agentState}</small>
          <strong className="text-[12px] font-semibold">
            {dictionary.statuses[detail.attempt.status] ?? detail.attempt.status}
          </strong>
        </span>
        <span className="grid gap-1 rounded-[8px] border border-line bg-panel px-3 py-2.5">
          <small className="text-[11px] text-faint">{dictionary.attempt.providerSession}</small>
          <strong className="overflow-hidden text-ellipsis text-[12px] font-semibold">
            {detail.attempt.providerSession?.threadId ?? dictionary.attempt.notStarted}
          </strong>
        </span>
        <span className="grid gap-1 rounded-[8px] border border-line bg-panel px-3 py-2.5">
          <small className="text-[11px] text-faint">{dictionary.attempt.humanDecisions}</small>
          <strong className="text-[12px] font-semibold">{detail.reviews.length}</strong>
        </span>
      </div>
      <WorkflowPanel detail={detail} dictionary={dictionary} onCommand={onCommand} />
      <details className="mt-3 overflow-hidden rounded-[8px] border border-line bg-panel">
        <summary className="cursor-pointer px-3 py-2.5 text-[12px] font-medium text-signal">
          {dictionary.attempt.workspace}
        </summary>
        {detail.workspace ? (
          <dl className="border-t border-line px-3 text-[12px]">
            <div className="flex items-baseline justify-between gap-4 border-b border-line py-2">
              <dt className="text-faint">{dictionary.attempt.path}</dt>
              <dd>
                <code className="font-mono text-[11px] text-muted">{detail.workspace.path}</code>
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-line py-2">
              <dt className="text-faint">{dictionary.attempt.branch}</dt>
              <dd>
                <code className="font-mono text-[11px] text-muted">{detail.workspace.branch}</code>
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-line py-2">
              <dt className="text-faint">{dictionary.attempt.state}</dt>
              <dd className="text-muted">{detail.workspace.state}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-faint">{dictionary.attempt.gitHead}</dt>
              <dd>
                <code className="font-mono text-[11px] text-muted">
                  {detail.workspace.gitHead ?? dictionary.attempt.notObserved}
                </code>
              </dd>
            </div>
          </dl>
        ) : (
          <p className="border-t border-line px-3 py-2.5 text-[12px] leading-relaxed text-muted">
            {dictionary.attempt.workspaceNotRecorded}
          </p>
        )}
      </details>
      <div className="mt-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h4 className="text-[13px] font-semibold">{dictionary.attempt.humanDecisions}</h4>
          <span className="text-[11px] text-faint">{dictionary.attempt.authority}</span>
        </div>
        {detail.reviews.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-muted">{dictionary.attempt.noReview}</p>
        ) : (
          <div className="overflow-hidden rounded-[8px] border border-line bg-panel">
            {detail.reviews.map((review) => (
              <div
                className="flex items-center justify-between gap-3 border-b border-line px-3 py-2.5 text-[12px] last:border-b-0"
                key={review.id}
              >
                <strong className="font-semibold">
                  {dictionary.decisions[review.decision] ?? review.decision}
                </strong>
                <span className="text-[11px] text-muted">
                  {review.decidedBy} · {formatDateTime(review.decidedAt, locale)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function WorkflowPanel({
  detail,
  dictionary,
  onCommand,
}: {
  detail: RuntimeAttemptDetail;
  dictionary: Dictionary;
  onCommand: (command: CommandIntent) => void;
}) {
  const workflow = latestWorkflow(detail.teamRuns);
  if (!workflow) {
    return (
      <section
        className="mt-3 rounded-[8px] border border-line bg-panel px-3 py-3"
        aria-live="polite"
      >
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-[13px] font-semibold">{dictionary.workflow.label}</h4>
          <span className="text-[11px] text-faint">{dictionary.workflow.noRun}</span>
        </div>
      </section>
    );
  }
  const agents = detail.agentRuns.filter((agent) => agent.teamRunId === workflow.id);
  const workflowEvents = detail.teamEvents.filter((event) => event.teamRunId === workflow.id);
  const events = workflowEvents.slice(-5).reverse();
  return (
    <section
      className="mt-3 rounded-[8px] border border-line bg-panel px-3 py-3"
      aria-labelledby="workflow-title"
    >
      <div className="mb-2.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-[13px] font-semibold" id="workflow-title">
            {dictionary.workflow.label}
          </h4>
          <p className="mb-0 truncate text-[11px] text-faint">{workflow.workflow}</p>
        </div>
        <span className="macos-pill shrink-0 bg-signal-soft text-signal">
          {workflow.provider === "fake"
            ? dictionary.workflow.fakeExecutor
            : dictionary.workflow.codexExecutor}
        </span>
      </div>
      <WorkflowMap dictionary={dictionary} workflow={workflow} />
      <div className="grid grid-cols-2 gap-2 min-[701px]:grid-cols-4">
        <WorkflowValue
          label={dictionary.workflow.status}
          value={dictionary.workflow.statuses[workflow.status] ?? workflow.status}
        />
        <WorkflowValue label={dictionary.workflow.node} value={workflow.currentNode} />
        <WorkflowValue label={dictionary.workflow.revision} value={String(workflow.revision)} />
        <WorkflowValue label={dictionary.workflow.agents} value={String(agents.length)} />
      </div>
      {workflow.pendingHumanInput && (
        <div
          className="mt-3 rounded-[8px] border border-signal/30 bg-signal-soft px-3 py-2.5"
          aria-live="polite"
        >
          <p className="mb-2 text-[12px] font-medium text-signal">
            {workflow.pendingHumanInput.prompt}
          </p>
          <div className="flex flex-wrap gap-2">
            {workflow.pendingHumanInput.options.map((option) => (
              <WorkflowAction
                key={option}
                option={option}
                workflow={workflow}
                onCommand={onCommand}
              />
            ))}
          </div>
        </div>
      )}
      {events.length > 0 && (
        <details className="mt-3 overflow-hidden rounded-[8px] border border-line">
          <summary className="cursor-pointer px-3 py-2 text-[12px] font-medium text-signal">
            {dictionary.workflow.events} ({workflowEvents.length})
          </summary>
          <ul className="grid gap-1 border-t border-line px-3 py-2 text-[11px] text-muted">
            {events.map((event) => (
              <li className="flex gap-2" key={event.id}>
                <span className="shrink-0 font-mono text-faint">{event.type}</span>
                <span className="truncate">{event.message}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {!isTerminal(workflow.status) && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="macos-btn"
            type="button"
            onClick={() =>
              onCommand({
                kind: "stop_team_session",
                teamRunId: workflow.id,
                expectedTeamRevision: workflow.revision,
              })
            }
          >
            {dictionary.workflow.stop}
          </button>
        </div>
      )}
    </section>
  );
}

function WorkflowValue({ label, value }: { label: string; value: string }) {
  return (
    <span className="grid gap-1 rounded-[6px] bg-panel-raised px-2 py-2">
      <small className="text-[10px] text-faint">{label}</small>
      <strong className="truncate text-[11px] font-semibold">{value}</strong>
    </span>
  );
}

function WorkflowAction({
  option,
  workflow,
  onCommand,
}: {
  option: string;
  workflow: TeamRunSnapshot;
  onCommand: (command: CommandIntent) => void;
}) {
  const pending = workflow.pendingHumanInput;
  if (!pending) return null;
  if (pending.kind === "plan_approval") {
    const kind =
      option === "approve" ? "approve_plan" : option === "revise" ? "revise_plan" : "reject_plan";
    return (
      <button
        className="macos-btn macos-btn-primary"
        type="button"
        onClick={() =>
          onCommand({ kind, teamRunId: workflow.id, expectedTeamRevision: workflow.revision })
        }
      >
        {option}
      </button>
    );
  }
  if (pending.kind === "review_input") {
    return (
      <button
        className="macos-btn macos-btn-primary"
        type="button"
        onClick={() =>
          onCommand({
            kind: "answer_team_input",
            teamRunId: workflow.id,
            expectedTeamRevision: workflow.revision,
            response: option as "approve" | "request_changes" | "stop",
          })
        }
      >
        {option}
      </button>
    );
  }
  return (
    <button
      className="macos-btn macos-btn-primary"
      type="button"
      onClick={() =>
        onCommand({
          kind: "final_decision",
          teamRunId: workflow.id,
          expectedTeamRevision: workflow.revision,
          decision: option as "accept" | "stop",
        })
      }
    >
      {option}
    </button>
  );
}

function latestWorkflow(runs: TeamRunSnapshot[]): TeamRunSnapshot | null {
  return runs.reduce<TeamRunSnapshot | null>(
    (latest, run) => (!latest || run.updatedAt > latest.updatedAt ? run : latest),
    null,
  );
}

function isTerminal(status: TeamRunSnapshot["status"]): boolean {
  return status === "completed" || status === "stopped" || status === "failed";
}
