import type {
  AttemptSnapshot,
  RuntimeAttemptDetail,
  RuntimeSnapshot,
  TaskSummary,
} from "@symphoneer/contracts";
import { type Dictionary, interpolate, type Locale } from "../../i18n/index.ts";

import { AttemptDetail } from "./attempt-detail";
import { ExecutorOutput } from "./executor-output";

export type CommandIntent =
  | { kind: "pause_attempt" }
  | { kind: "retry_attempt" }
  | { kind: "start_team_run"; task: TaskSummary }
  | { kind: "approve_plan"; teamRunId: string; expectedTeamRevision: number }
  | { kind: "revise_plan"; teamRunId: string; expectedTeamRevision: number }
  | { kind: "reject_plan"; teamRunId: string; expectedTeamRevision: number }
  | {
      kind: "answer_team_input";
      teamRunId: string;
      expectedTeamRevision: number;
      response: "approve" | "request_changes" | "stop";
    }
  | {
      kind: "final_decision";
      teamRunId: string;
      expectedTeamRevision: number;
      decision: "accept" | "stop";
    }
  | { kind: "stop_team_session"; teamRunId: string; expectedTeamRevision: number };

export function TaskDetail({
  dictionary,
  detail,
  latestAttempt,
  locale,
  onBack,
  onCommand,
  selectedTask,
  snapshot,
}: {
  dictionary: Dictionary;
  detail: RuntimeAttemptDetail | null;
  latestAttempt: AttemptSnapshot;
  locale: Locale;
  onBack: () => void;
  onCommand: (command: CommandIntent) => void;
  selectedTask: TaskSummary;
  snapshot: RuntimeSnapshot | null;
}) {
  return (
    <section className="attempt-view" id="attempt-view" aria-labelledby="attempt-view-title">
      <header className="attempt-view-header">
        <div className="flex min-w-0 items-start gap-3">
          <button className="back-button" type="button" onClick={onBack}>
            <span aria-hidden="true">←</span>
            {dictionary.detail.backToTasks}
          </button>
          <span className="attempt-view-divider" aria-hidden="true" />
          <div className="min-w-0">
            <p className="eyebrow-label">
              {interpolate(dictionary.detail.selectedTask, { identifier: selectedTask.identifier })}
            </p>
            <h1
              className="truncate text-[20px] font-semibold tracking-[-0.03em]"
              id="attempt-view-title"
            >
              {selectedTask.title}
            </h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 max-[700px]:w-full max-[700px]:justify-between">
          <span className={`macos-pill ${attemptStatusClass(latestAttempt.status)}`}>
            {dictionary.statuses[latestAttempt.status] ?? latestAttempt.status}
          </span>
          <a
            className="macos-btn macos-btn-primary"
            href={selectedTask.source.url}
            target="_blank"
            rel="noreferrer"
          >
            {dictionary.detail.openGitHub}
          </a>
        </div>
      </header>

      <div className="attempt-view-grid">
        <main className="attempt-main">
          <div className="attempt-facts">
            <Fact
              label={dictionary.detail.tracker}
              value={formatTracker(selectedTask.source.kind)}
            />
            <Fact
              label={dictionary.detail.attempt}
              value={`${dictionary.detail.attempt} ${String(latestAttempt.sequence).padStart(2, "0")}`}
            />
            <Fact
              label={dictionary.detail.executor}
              value={detail ? executorLabel(detail, dictionary) : "—"}
            />
            <Fact label={dictionary.detail.workflow} value={detail?.teamRuns[0]?.workflow ?? "—"} />
          </div>
          <VerificationPanel
            dictionary={dictionary}
            latestAttempt={latestAttempt}
            snapshot={snapshot}
          />
          {detail && (
            <div className="flex flex-wrap gap-2">
              <button
                className="macos-btn"
                type="button"
                onClick={() => onCommand({ kind: "pause_attempt" })}
              >
                {dictionary.detail.requestPause}
              </button>
              <button
                className="macos-btn"
                type="button"
                onClick={() => onCommand({ kind: "retry_attempt" })}
              >
                {dictionary.detail.requestRetry}
              </button>
            </div>
          )}
          {detail ? (
            <AttemptDetail
              detail={detail}
              dictionary={dictionary}
              locale={locale}
              onCommand={onCommand}
            />
          ) : (
            <div className="attempt-loading" aria-live="polite">
              <span className="executor-empty-mark" aria-hidden="true">
                ◌
              </span>
              <p>{dictionary.board.attemptUnavailable}</p>
            </div>
          )}
        </main>
        {detail && <ExecutorOutput detail={detail} dictionary={dictionary} locale={locale} />}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span className="attempt-fact">
      <small>{label}</small>
      <strong className="truncate">{value}</strong>
    </span>
  );
}

function VerificationPanel({
  dictionary,
  latestAttempt,
  snapshot,
}: {
  dictionary: Dictionary;
  latestAttempt: AttemptSnapshot;
  snapshot: RuntimeSnapshot | null;
}) {
  const verifications =
    snapshot?.verifications.filter((item) => item.attemptId === latestAttempt.id) ?? [];
  return (
    <section className="verification-strip" id="verification" aria-labelledby="verification-title">
      <div>
        <h2 className="text-[13px] font-semibold" id="verification-title">
          {dictionary.detail.verification}
        </h2>
        <p className="mb-0 mt-0.5 text-[11px] text-faint">{dictionary.detail.independent}</p>
      </div>
      {verifications.length ? (
        <div className="flex min-w-0 items-center gap-3">
          {verifications.map((item) => (
            <span className={`macos-pill ${verificationStatusClass(item.status)}`} key={item.id}>
              {dictionary.statuses[item.status] ?? item.status}
            </span>
          ))}
          <code className="truncate font-mono text-[11px] text-muted">
            {verifications[verifications.length - 1]?.checkId}
          </code>
        </div>
      ) : (
        <span className="text-[11px] text-faint">{dictionary.detail.notVerified}</span>
      )}
    </section>
  );
}

function executorLabel(detail: RuntimeAttemptDetail, dictionary: Dictionary): string {
  const workflow = detail.teamRuns[0];
  if (!workflow) return "—";
  return workflow.provider === "fake"
    ? dictionary.workflow.fakeShort
    : dictionary.workflow.codexShort;
}

function formatTracker(kind: string): string {
  if (kind === "github") return "GitHub";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function verificationStatusClass(status: string): string {
  if (status === "passed") return "bg-success/15 text-success";
  if (status === "failed" || status === "timed_out") return "bg-danger/15 text-danger";
  return "bg-panel-raised text-muted";
}

function attemptStatusClass(status: AttemptSnapshot["status"]): string {
  if (status === "succeeded") return "bg-success/15 text-success";
  if (status === "failed" || status === "timed_out" || status === "stalled") {
    return "bg-danger/15 text-danger";
  }
  if (status === "paused") return "bg-amber/15 text-amber";
  return "bg-panel-raised text-muted";
}
