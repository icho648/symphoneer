import type {
  AttemptSnapshot,
  RuntimeAttemptDetail,
  RuntimeSnapshot,
  TaskSummary,
} from "@symphoneer/contracts";
import { type Dictionary, interpolate, type Locale } from "../../i18n/index.ts";

import { AttemptDetail, AttemptRow } from "./attempt-detail";

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
  onCommand,
  selectedAttempts,
  selectedTask,
  snapshot,
  locale,
}: {
  dictionary: Dictionary;
  detail: RuntimeAttemptDetail | null;
  latestAttempt: AttemptSnapshot | null;
  onCommand: (command: CommandIntent) => void;
  selectedAttempts: AttemptSnapshot[];
  selectedTask: TaskSummary | null;
  snapshot: RuntimeSnapshot | null;
  locale: Locale;
}) {
  return (
    <section
      className="mt-4 overflow-hidden rounded-[10px] border border-line bg-panel"
      id="selected-task"
      aria-labelledby="detail-title"
    >
      {selectedTask ? (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 max-[700px]:flex-col max-[700px]:items-start">
            <div className="min-w-0">
              <p className="mb-1 text-[11px] font-medium text-faint">
                {interpolate(dictionary.detail.selectedTask, {
                  identifier: selectedTask.identifier,
                })}
              </p>
              <h2
                className="truncate text-[17px] font-semibold tracking-[-0.02em]"
                id="detail-title"
              >
                {selectedTask.title}
              </h2>
            </div>
            <a
              className="macos-btn macos-btn-primary shrink-0"
              href={selectedTask.source.url}
              target="_blank"
              rel="noreferrer"
            >
              {dictionary.detail.openGitHub}
            </a>
          </div>
          <div className="grid grid-cols-1 divide-y divide-line min-[701px]:grid-cols-2 min-[701px]:divide-x min-[701px]:divide-y-0">
            <section className="min-w-0 px-4 py-3.5" aria-labelledby="attempts-title">
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <h3 className="text-[13px] font-semibold" id="attempts-title">
                  {dictionary.detail.attempts}
                </h3>
                <span className="font-mono text-[11px] text-faint">{selectedAttempts.length}</span>
              </div>
              {selectedAttempts.length === 0 ? (
                <div className="grid gap-3">
                  <p className="mb-0 text-[12px] leading-relaxed text-faint">
                    {dictionary.detail.noAttempt}
                  </p>
                  <button
                    className="macos-btn macos-btn-primary justify-self-start"
                    type="button"
                    onClick={() => onCommand({ kind: "start_team_run", task: selectedTask })}
                  >
                    {dictionary.workflow.start}
                  </button>
                </div>
              ) : (
                <div className="overflow-hidden rounded-[8px] border border-line">
                  {selectedAttempts.map((attempt) => (
                    <AttemptRow
                      attempt={attempt}
                      active={attempt.id === latestAttempt?.id}
                      dictionary={dictionary}
                      key={attempt.id}
                    />
                  ))}
                </div>
              )}
              {detail && latestAttempt && (
                <div className="flex flex-wrap gap-2 pt-3">
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
            </section>

            <VerificationPanel
              dictionary={dictionary}
              latestAttempt={latestAttempt}
              snapshot={snapshot}
            />
          </div>
          {detail && (
            <AttemptDetail
              detail={detail}
              dictionary={dictionary}
              locale={locale}
              onCommand={onCommand}
            />
          )}
        </>
      ) : (
        <div className="px-6 py-16 text-center">
          <span
            className="mb-3 inline-grid size-12 place-items-center rounded-full bg-panel-raised text-[18px] text-muted"
            aria-hidden="true"
          >
            ⌘
          </span>
          <h2 className="mb-1 text-[17px] font-semibold tracking-[-0.02em]" id="detail-title">
            {dictionary.detail.noTask}
          </h2>
          <p className="mb-0 text-[13px] text-muted">{dictionary.detail.empty}</p>
        </div>
      )}
    </section>
  );
}

function VerificationPanel({
  dictionary,
  latestAttempt,
  snapshot,
}: {
  dictionary: Dictionary;
  latestAttempt: AttemptSnapshot | null;
  snapshot: RuntimeSnapshot | null;
}) {
  const verifications =
    snapshot?.verifications.filter((item) => item.attemptId === latestAttempt?.id) ?? [];

  return (
    <section className="min-w-0 px-4 py-3.5" id="verification" aria-labelledby="verification-title">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold" id="verification-title">
          {dictionary.detail.verification}
        </h3>
        <span className="text-[11px] font-medium text-signal">{dictionary.detail.independent}</span>
      </div>
      {verifications.length ? (
        <div className="overflow-hidden rounded-[8px] border border-line">
          {verifications.map((item) => (
            <div
              className="flex items-center justify-between gap-3 border-b border-line px-3 py-2.5 text-[12px] text-muted last:border-b-0"
              key={item.id}
            >
              <span className={`macos-pill ${verificationStatusClass(item.status)}`}>
                {dictionary.statuses[item.status] ?? item.status}
              </span>
              <span className="truncate">{item.checkId}</span>
              <code className="shrink-0 font-mono text-[11px] text-faint">
                {item.exitCode === null ? "—" : `exit ${item.exitCode}`}
              </code>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[12px] leading-relaxed text-faint">{dictionary.detail.notVerified}</p>
      )}
    </section>
  );
}

function verificationStatusClass(status: string): string {
  if (status === "passed") return "bg-success/15 text-success";
  if (status === "failed" || status === "timed_out") return "bg-danger/15 text-danger";
  return "bg-panel-raised text-muted";
}
