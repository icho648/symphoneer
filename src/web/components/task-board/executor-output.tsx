import type { RuntimeAttemptDetail, TeamProcessEvent } from "@symphoneer/contracts";
import { formatDateTime } from "@/lib/format";
import type { Dictionary, Locale } from "../../i18n/index.ts";

export function ExecutorOutput({
  activeAgentId,
  activeRunId,
  detail,
  dictionary,
  locale,
}: {
  activeAgentId: string | null;
  activeRunId: string | null;
  detail: RuntimeAttemptDetail;
  dictionary: Dictionary;
  locale: Locale;
}) {
  const workflow = detail.teamRuns.find((run) => run.id === activeRunId) ?? latestWorkflow(detail);
  const agents = workflow
    ? detail.agentRuns
        .filter((agent) => agent.teamRunId === workflow.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    : [];
  const currentAgent = agents.find((agent) => agent.id === activeAgentId) ?? agents[0] ?? null;
  const events = workflow
    ? detail.teamEvents
        .filter((event) => event.teamRunId === workflow.id)
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
        .slice(-12)
    : [];

  return (
    <aside className="executor-output" aria-labelledby="executor-output-title">
      <div className="executor-output-header">
        <div className="min-w-0">
          <p className="eyebrow-label">{dictionary.workflow.outputEyebrow}</p>
          <h3 className="text-[15px] font-semibold" id="executor-output-title">
            {dictionary.workflow.outputTitle}
          </h3>
        </div>
        <span
          className={`executor-live-dot ${currentAgent ? "is-live" : ""}`}
          role="status"
          aria-label={currentAgent ? dictionary.workflow.live : dictionary.workflow.idle}
        />
      </div>

      {workflow && (
        <div className="executor-context">
          <div>
            <span className="executor-context-label">{dictionary.workflow.executor}</span>
            <strong>
              {workflow.provider === "fake"
                ? dictionary.workflow.fakeShort
                : dictionary.workflow.codexShort}
            </strong>
          </div>
          <div>
            <span className="executor-context-label">{dictionary.workflow.workflowName}</span>
            <strong className="truncate">{workflow.workflow}</strong>
          </div>
        </div>
      )}

      {currentAgent && (
        <div className="executor-current">
          <div className="flex min-w-0 items-center gap-2">
            <span className="executor-role-dot" aria-hidden="true" />
            <div className="min-w-0">
              <span className="executor-context-label">{dictionary.workflow.currentExecutor}</span>
              <strong className="block truncate">
                {dictionary.workflow.roles[currentAgent.role] ?? currentAgent.role}
              </strong>
            </div>
          </div>
          <span className="macos-pill bg-signal-soft text-signal">
            {dictionary.workflow.agentStatuses[currentAgent.status] ?? currentAgent.status}
          </span>
        </div>
      )}

      {events.length > 0 ? (
        <ol className="executor-stream" aria-live="polite">
          {events.map((event) => (
            <OutputEvent dictionary={dictionary} event={event} key={event.id} locale={locale} />
          ))}
        </ol>
      ) : (
        <div className="executor-empty" aria-live="polite">
          <span className="executor-empty-mark" aria-hidden="true">
            ◌
          </span>
          <p>{dictionary.workflow.waitingOutput}</p>
        </div>
      )}
    </aside>
  );
}

function OutputEvent({
  dictionary,
  event,
  locale,
}: {
  dictionary: Dictionary;
  event: TeamProcessEvent;
  locale: Locale;
}) {
  const detail = eventDetail(event);
  return (
    <li className="executor-event">
      <div className="executor-event-marker" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="executor-event-role">
            {dictionary.workflow.roles[event.role] ?? event.role}
          </span>
          <span className="executor-event-type">
            {dictionary.workflow.eventTypes[event.type] ?? event.type.replaceAll("_", " ")}
          </span>
          <time className="executor-event-time" dateTime={event.occurredAt}>
            {formatDateTime(event.occurredAt, locale)}
          </time>
        </div>
        <p className="executor-event-message">{event.message}</p>
        {detail && <code className="executor-event-detail">{detail}</code>}
      </div>
    </li>
  );
}

function latestWorkflow(detail: RuntimeAttemptDetail) {
  return detail.teamRuns.reduce<(typeof detail.teamRuns)[number] | null>(
    (latest, run) => (!latest || run.updatedAt > latest.updatedAt ? run : latest),
    null,
  );
}

function eventDetail(event: TeamProcessEvent): string | null {
  const details = event.details;
  if (!details) return null;
  for (const key of ["command", "tool", "reviewDecision", "requestRef"]) {
    const value = details[key];
    if (typeof value === "string") return value;
  }
  return null;
}
