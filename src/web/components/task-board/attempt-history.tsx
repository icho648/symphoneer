import type {
  AgentRunSnapshot,
  AttemptSnapshot,
  RuntimeAttemptDetail,
  TeamRunSnapshot,
} from "@symphoneer/contracts";
import type { Dictionary, Locale } from "../../i18n/index.ts";
import { formatDateTime } from "../../lib/format.ts";

export function AttemptHistory({
  activeAgentId,
  activeRunId,
  attempts,
  currentAttemptId,
  detail,
  dictionary,
  locale,
  onSelectAgent,
  onSelectAttempt,
  onSelectRun,
  onSelectSession,
  onToggle,
  open,
}: {
  activeAgentId: string | null;
  activeRunId: string | null;
  attempts: readonly AttemptSnapshot[];
  currentAttemptId: string;
  detail: RuntimeAttemptDetail | null;
  dictionary: Dictionary;
  locale: Locale;
  onSelectAgent: (agent: AgentRunSnapshot) => void;
  onSelectAttempt: (attempt: AttemptSnapshot) => void;
  onSelectRun: (run: TeamRunSnapshot) => void;
  onSelectSession: (threadId: string) => void;
  onToggle: () => void;
  open: boolean;
}) {
  const currentRun = activeRunId
    ? detail?.teamRuns.find((run) => run.id === activeRunId)
    : latestRun(detail?.teamRuns ?? []);
  const currentAgent = activeAgentId
    ? detail?.agentRuns.find((agent) => agent.id === activeAgentId)
    : currentRun
      ? latestAgent(detail?.agentRuns ?? [], currentRun.id)
      : null;

  return (
    <aside className={`attempt-history ${open ? "is-open" : ""}`}>
      <button
        aria-expanded={open}
        className="attempt-history-toggle"
        title={open ? dictionary.attempt.closeHistory : dictionary.attempt.openHistory}
        type="button"
        onClick={onToggle}
      >
        <span className="attempt-history-toggle-mark" aria-hidden="true">
          ≡
        </span>
        {open && <span>{dictionary.attempt.history}</span>}
      </button>

      {open && (
        <div className="attempt-history-panel">
          <div className="attempt-history-heading">
            <div>
              <p className="eyebrow-label">{dictionary.attempt.label}</p>
              <h2>{dictionary.attempt.history}</h2>
            </div>
            <span className="font-mono text-[10px] text-faint">
              {attempts.length.toString().padStart(2, "0")}
            </span>
          </div>

          <section className="attempt-history-section" aria-labelledby="attempt-history-attempts">
            <h3 id="attempt-history-attempts">{dictionary.detail.attempts}</h3>
            <div className="attempt-history-list">
              {attempts.map((attempt) => (
                <button
                  aria-pressed={attempt.id === currentAttemptId}
                  className="attempt-history-row"
                  key={attempt.id}
                  type="button"
                  onClick={() => onSelectAttempt(attempt)}
                >
                  <span className="attempt-history-row-main">
                    <strong>
                      {dictionary.detail.attempt} {String(attempt.sequence).padStart(2, "0")}
                    </strong>
                    <small>{formatDateTime(attempt.updatedAt, locale)}</small>
                  </span>
                  <span className="attempt-history-row-status">
                    {dictionary.statuses[attempt.status] ?? attempt.status}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {detail && (
            <>
              <section className="attempt-history-section" aria-labelledby="attempt-history-runs">
                <h3 id="attempt-history-runs">{dictionary.attempt.runs}</h3>
                <div className="attempt-history-list">
                  {detail.teamRuns.map((run) => (
                    <button
                      aria-pressed={run.id === currentRun?.id}
                      className="attempt-history-row"
                      key={run.id}
                      type="button"
                      onClick={() => onSelectRun(run)}
                    >
                      <span className="attempt-history-row-main">
                        <strong>{run.workflow}</strong>
                        <small>{dictionary.workflow.statuses[run.status] ?? run.status}</small>
                      </span>
                      <span className="attempt-history-row-status">r{run.revision}</span>
                    </button>
                  ))}
                </div>
              </section>

              {currentRun && (
                <section
                  className="attempt-history-section"
                  aria-labelledby="attempt-history-agents"
                >
                  <h3 id="attempt-history-agents">{dictionary.attempt.agents}</h3>
                  <div className="attempt-history-list">
                    {detail.agentRuns
                      .filter((agent) => agent.teamRunId === currentRun.id)
                      .map((agent) => (
                        <button
                          aria-pressed={agent.id === currentAgent?.id}
                          className="attempt-history-row"
                          key={agent.id}
                          type="button"
                          onClick={() => onSelectAgent(agent)}
                        >
                          <span className="attempt-history-row-main">
                            <strong>{dictionary.workflow.roles[agent.role] ?? agent.role}</strong>
                            <small>{agent.access.replace("_", "-")}</small>
                          </span>
                          <span className="attempt-history-row-status">
                            {dictionary.workflow.agentStatuses[agent.status] ?? agent.status}
                          </span>
                        </button>
                      ))}
                  </div>
                </section>
              )}

              <section
                className="attempt-history-section"
                aria-labelledby="attempt-history-session"
              >
                <h3 id="attempt-history-session">{dictionary.attempt.session}</h3>
                {detail.attempt.providerSession ? (
                  <button
                    className="attempt-history-session"
                    type="button"
                    onClick={() => onSelectSession(detail.attempt.providerSession?.threadId ?? "")}
                  >
                    <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />
                    <code>{detail.attempt.providerSession.threadId}</code>
                  </button>
                ) : (
                  <p className="attempt-history-muted">{dictionary.attempt.noSession}</p>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </aside>
  );
}

function latestRun(runs: readonly TeamRunSnapshot[]): TeamRunSnapshot | null {
  return (
    runs.reduce<TeamRunSnapshot | null>(
      (latest, run) => (!latest || run.updatedAt > latest.updatedAt ? run : latest),
      null,
    ) ?? null
  );
}

function latestAgent(
  agents: readonly AgentRunSnapshot[],
  teamRunId: string,
): AgentRunSnapshot | null {
  return (
    agents
      .filter((agent) => agent.teamRunId === teamRunId)
      .reduce<AgentRunSnapshot | null>(
        (latest, agent) => (!latest || agent.updatedAt > latest.updatedAt ? agent : latest),
        null,
      ) ?? null
  );
}
