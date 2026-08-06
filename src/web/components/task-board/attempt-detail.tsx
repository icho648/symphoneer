import type { RuntimeAttemptDetail, TeamRunSnapshot } from "@symphoneer/contracts";
import { useState } from "react";
import { formatDateTime } from "@/lib/format";
import type { Dictionary, Locale } from "../../i18n/index.ts";
import type { CommandIntent } from "./task-detail";
import { WorkflowMap } from "./workflow-map";

type EvidenceTab = "overview" | "changes" | "verification" | "events" | "workspace";

export function AttemptDetail({
  activeAgentId,
  activeRunId,
  detail,
  dictionary,
  locale,
  onCommand,
}: {
  activeAgentId: string | null;
  activeRunId: string | null;
  detail: RuntimeAttemptDetail;
  dictionary: Dictionary;
  locale: Locale;
  onCommand: (command: CommandIntent) => void;
}) {
  const [activeTab, setActiveTab] = useState<EvidenceTab>("overview");
  const workflow =
    detail.teamRuns.find((run) => run.id === activeRunId) ?? latestWorkflow(detail.teamRuns);
  const tabs: EvidenceTab[] = ["overview", "changes", "verification", "events", "workspace"];

  return (
    <section className="attempt-detail-panel" aria-labelledby="attempt-detail-title">
      <div className="attempt-detail-heading">
        <div>
          <p className="eyebrow-label">{dictionary.attempt.label}</p>
          <h2 id="attempt-detail-title">{dictionary.attempt.detail}</h2>
        </div>
        <span className="font-mono text-[10px] text-faint">
          {formatDateTime(detail.attempt.updatedAt, locale)}
        </span>
      </div>

      <div className="attempt-detail-summary">
        <SummaryValue
          label={dictionary.attempt.agentState}
          value={dictionary.statuses[detail.attempt.status] ?? detail.attempt.status}
        />
        <SummaryValue
          label={dictionary.attempt.providerSession}
          value={detail.attempt.providerSession?.threadId ?? dictionary.attempt.notStarted}
        />
        <SummaryValue
          label={dictionary.attempt.humanDecisions}
          value={String(detail.reviews.length)}
        />
      </div>

      <div className="evidence-tabs" role="tablist" aria-label={dictionary.attempt.detail}>
        {tabs.map((tab) => (
          <button
            aria-selected={activeTab === tab}
            className="evidence-tab"
            id={`evidence-tab-${tab}`}
            key={tab}
            role="tab"
            type="button"
            onClick={() => setActiveTab(tab)}
          >
            {dictionary.attempt.tabs[tab]}
          </button>
        ))}
      </div>

      <div aria-labelledby={`evidence-tab-${activeTab}`} className="evidence-panel" role="tabpanel">
        {activeTab === "overview" && (
          <OverviewPanel
            activeAgentId={activeAgentId}
            detail={detail}
            dictionary={dictionary}
            locale={locale}
            onCommand={onCommand}
            workflow={workflow}
          />
        )}
        {activeTab === "changes" && <ChangesPanel detail={detail} dictionary={dictionary} />}
        {activeTab === "verification" && (
          <VerificationEvidence detail={detail} dictionary={dictionary} locale={locale} />
        )}
        {activeTab === "events" && (
          <EventsEvidence
            detail={detail}
            dictionary={dictionary}
            locale={locale}
            workflow={workflow}
          />
        )}
        {activeTab === "workspace" && <WorkspaceEvidence detail={detail} dictionary={dictionary} />}
      </div>
    </section>
  );
}

function SummaryValue({ label, value }: { label: string; value: string }) {
  return (
    <span className="attempt-detail-summary-value">
      <small>{label}</small>
      <strong className="truncate">{value}</strong>
    </span>
  );
}

function OverviewPanel({
  activeAgentId,
  detail,
  dictionary,
  locale,
  onCommand,
  workflow,
}: {
  activeAgentId: string | null;
  detail: RuntimeAttemptDetail;
  dictionary: Dictionary;
  locale: Locale;
  onCommand: (command: CommandIntent) => void;
  workflow: TeamRunSnapshot | null;
}) {
  const agents = workflow
    ? detail.agentRuns.filter((agent) => agent.teamRunId === workflow.id)
    : [];
  return (
    <div className="evidence-overview">
      <WorkflowPanel
        detail={detail}
        dictionary={dictionary}
        onCommand={onCommand}
        workflow={workflow}
      />
      {agents.length > 0 && (
        <section className="evidence-block" aria-labelledby="agent-runs-title">
          <div className="evidence-block-heading">
            <h3 id="agent-runs-title">{dictionary.attempt.agents}</h3>
            <span>{agents.length}</span>
          </div>
          <div className="agent-run-table">
            {agents.map((agent) => (
              <div
                className={`agent-run-row ${agent.id === activeAgentId ? "is-current" : ""}`}
                key={agent.id}
              >
                <span className="agent-run-name">
                  <span className="agent-run-dot" aria-hidden="true" />
                  <strong>{dictionary.workflow.roles[agent.role] ?? agent.role}</strong>
                </span>
                <span className="agent-run-access">{agent.access.replace("_", "-")}</span>
                <span className="agent-run-status">
                  {dictionary.workflow.agentStatuses[agent.status] ?? agent.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
      <ReviewerOpinion dictionary={dictionary} workflow={workflow} />
      <HumanDecisionPanel detail={detail} dictionary={dictionary} locale={locale} />
    </div>
  );
}

function ReviewerOpinion({
  dictionary,
  workflow,
}: {
  dictionary: Dictionary;
  workflow: TeamRunSnapshot | null;
}) {
  return (
    <section className="evidence-block" aria-labelledby="reviewer-opinion-title">
      <div className="evidence-block-heading">
        <h3 id="reviewer-opinion-title">{dictionary.attempt.reviewerOpinion}</h3>
        <span>{workflow?.reviewRound ? `round ${workflow.reviewRound}` : "—"}</span>
      </div>
      <p className="mb-0 text-[12px] text-muted">
        {workflow?.reviewDecision
          ? (dictionary.workflow.reviewDecisions[workflow.reviewDecision] ??
            workflow.reviewDecision)
          : dictionary.attempt.noReviewerOpinion}
      </p>
    </section>
  );
}

function WorkflowPanel({
  detail,
  dictionary,
  onCommand,
  workflow,
}: {
  detail: RuntimeAttemptDetail;
  dictionary: Dictionary;
  onCommand: (command: CommandIntent) => void;
  workflow: TeamRunSnapshot | null;
}) {
  if (!workflow) {
    return (
      <section className="evidence-block" aria-live="polite">
        <div className="evidence-block-heading">
          <h3>{dictionary.workflow.label}</h3>
          <span>{dictionary.workflow.noRun}</span>
        </div>
      </section>
    );
  }
  const agents = detail.agentRuns.filter((agent) => agent.teamRunId === workflow.id);
  return (
    <section className="workflow-evidence" aria-labelledby="workflow-title">
      <div className="workflow-evidence-heading">
        <div className="min-w-0">
          <p className="eyebrow-label">{dictionary.workflow.label}</p>
          <h3 id="workflow-title">{workflow.workflow}</h3>
        </div>
        <span className="macos-pill shrink-0 bg-signal-soft text-signal">
          {workflow.provider === "fake"
            ? dictionary.workflow.fakeExecutor
            : dictionary.workflow.codexExecutor}
        </span>
      </div>
      <WorkflowMap dictionary={dictionary} workflow={workflow} />
      <div className="workflow-evidence-values">
        <WorkflowValue
          label={dictionary.workflow.status}
          value={dictionary.workflow.statuses[workflow.status] ?? workflow.status}
        />
        <WorkflowValue label={dictionary.workflow.node} value={workflow.currentNode} />
        <WorkflowValue label={dictionary.workflow.revision} value={String(workflow.revision)} />
        <WorkflowValue label={dictionary.workflow.agents} value={String(agents.length)} />
      </div>
      {workflow.pendingHumanInput && (
        <div className="workflow-human-gate" aria-live="polite">
          <p>{workflow.pendingHumanInput.prompt}</p>
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
      {!isTerminal(workflow.status) && (
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
      )}
    </section>
  );
}

function ChangesPanel({
  detail,
  dictionary,
}: {
  detail: RuntimeAttemptDetail;
  dictionary: Dictionary;
}) {
  return (
    <section className="evidence-block evidence-empty" aria-labelledby="changes-title">
      <h3 id="changes-title">{dictionary.attempt.tabs.changes}</h3>
      <p>{dictionary.attempt.noChanges}</p>
      {detail.workspace && (
        <code>
          {detail.workspace.repository} · {detail.workspace.branch}
        </code>
      )}
    </section>
  );
}

function VerificationEvidence({
  detail,
  dictionary,
  locale,
}: {
  detail: RuntimeAttemptDetail;
  dictionary: Dictionary;
  locale: Locale;
}) {
  if (detail.verifications.length === 0) {
    return (
      <section className="evidence-block evidence-empty">
        <h3>{dictionary.attempt.tabs.verification}</h3>
        <p>{dictionary.attempt.noVerification}</p>
      </section>
    );
  }
  return (
    <div className="evidence-record-list">
      {detail.verifications.map((verification) => (
        <article className="evidence-record" key={verification.id}>
          <div className="evidence-record-heading">
            <div>
              <p className="eyebrow-label">{dictionary.attempt.tabs.verification}</p>
              <h3>{verification.checkId}</h3>
            </div>
            <span className={`macos-pill ${verificationStatusClass(verification.status)}`}>
              {dictionary.statuses[verification.status] ?? verification.status}
            </span>
          </div>
          <dl className="evidence-record-grid">
            <EvidenceField label="command" value={verification.argv.join(" ")} code />
            <EvidenceField label="exit" value={String(verification.exitCode ?? "—")} code />
            <EvidenceField
              label="tool"
              value={`${verification.tool.name} ${verification.tool.version}`}
            />
            <EvidenceField label="Git HEAD" value={verification.gitHead} code />
            <EvidenceField
              label="time"
              value={
                formatDateTime(verification.startedAt, locale) +
                " → " +
                (verification.finishedAt ? formatDateTime(verification.finishedAt, locale) : "—")
              }
            />
            <EvidenceField label="artifact" value={verification.artifactRef ?? "—"} code />
          </dl>
        </article>
      ))}
    </div>
  );
}

function EventsEvidence({
  detail,
  dictionary,
  locale,
  workflow,
}: {
  detail: RuntimeAttemptDetail;
  dictionary: Dictionary;
  locale: Locale;
  workflow: TeamRunSnapshot | null;
}) {
  const events = workflow
    ? detail.teamEvents.filter((event) => event.teamRunId === workflow.id)
    : detail.teamEvents;
  if (events.length === 0) {
    return (
      <section className="evidence-block evidence-empty">
        <h3>{dictionary.attempt.tabs.events}</h3>
        <p>{dictionary.attempt.noEvents}</p>
      </section>
    );
  }
  return (
    <ol className="evidence-event-list">
      {events
        .slice()
        .reverse()
        .map((event) => (
          <li className="evidence-event-row" key={event.id}>
            <span className="evidence-event-dot" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <strong>{event.type.replaceAll("_", " ")}</strong>
                <time dateTime={event.occurredAt}>{formatDateTime(event.occurredAt, locale)}</time>
              </span>
              <span>{event.message}</span>
            </span>
          </li>
        ))}
    </ol>
  );
}

function WorkspaceEvidence({
  detail,
  dictionary,
}: {
  detail: RuntimeAttemptDetail;
  dictionary: Dictionary;
}) {
  return (
    <section className="evidence-block" aria-labelledby="workspace-title">
      <div className="evidence-block-heading">
        <h3 id="workspace-title">{dictionary.attempt.workspace}</h3>
        <span>{detail.workspace?.state ?? dictionary.attempt.notObserved}</span>
      </div>
      {detail.workspace ? (
        <dl className="workspace-evidence-grid">
          <EvidenceField label={dictionary.attempt.path} value={detail.workspace.path} code />
          <EvidenceField
            label={dictionary.attempt.repository}
            value={detail.workspace.repository}
          />
          <EvidenceField label={dictionary.attempt.branch} value={detail.workspace.branch} code />
          <EvidenceField
            label={dictionary.attempt.gitHead}
            value={detail.workspace.gitHead ?? "—"}
            code
          />
        </dl>
      ) : (
        <p className="text-[12px] text-muted">{dictionary.attempt.workspaceNotRecorded}</p>
      )}
    </section>
  );
}

function HumanDecisionPanel({
  detail,
  dictionary,
  locale,
}: {
  detail: RuntimeAttemptDetail;
  dictionary: Dictionary;
  locale: Locale;
}) {
  return (
    <section className="evidence-block" aria-labelledby="human-decisions-title">
      <div className="evidence-block-heading">
        <h3 id="human-decisions-title">{dictionary.attempt.humanDecisions}</h3>
        <span>{dictionary.attempt.authority}</span>
      </div>
      {detail.reviews.length === 0 ? (
        <p className="text-[12px] text-muted">{dictionary.attempt.noReview}</p>
      ) : (
        <div className="decision-list">
          {detail.reviews.map((review) => (
            <div className="decision-row" key={review.id}>
              <strong>{dictionary.decisions[review.decision] ?? review.decision}</strong>
              <span>
                {review.decidedBy} · {formatDateTime(review.decidedAt, locale)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EvidenceField({
  code = false,
  label,
  value,
}: {
  code?: boolean;
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={code ? "font-mono" : ""}>{value}</dd>
    </div>
  );
}

function WorkflowValue({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <small>{label}</small>
      <strong className="truncate">{value}</strong>
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

function latestWorkflow(runs: readonly TeamRunSnapshot[]): TeamRunSnapshot | null {
  return runs.reduce<TeamRunSnapshot | null>(
    (latest, run) => (!latest || run.updatedAt > latest.updatedAt ? run : latest),
    null,
  );
}

function isTerminal(status: TeamRunSnapshot["status"]): boolean {
  return status === "completed" || status === "stopped" || status === "failed";
}

function verificationStatusClass(status: string): string {
  if (status === "passed") return "bg-success/15 text-success";
  if (status === "failed" || status === "timed_out") return "bg-danger/15 text-danger";
  return "bg-panel-raised text-muted";
}
