import type {
  AttemptSnapshot,
  RuntimeAttemptDetail,
  RuntimeSnapshot,
  TaskSummary,
} from "@symphoneer/contracts";
import { type Dictionary, interpolate, type Locale } from "@symphoneer/i18n";

import { AttemptDetail, AttemptRow } from "./attempt-detail";

export type AttemptCommand = "pause_attempt" | "retry_attempt";

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
  onCommand: (kind: AttemptCommand) => void;
  selectedAttempts: AttemptSnapshot[];
  selectedTask: TaskSummary | null;
  snapshot: RuntimeSnapshot | null;
  locale: Locale;
}) {
  return (
    <section
      className="mt-7 border border-line bg-panel/70 shadow-[0_18px_50px_rgb(0_0_0_/_18%)]"
      id="selected-task"
      aria-labelledby="detail-title"
    >
      {selectedTask ? (
        <>
          <div className="flex items-center justify-between gap-4 border-b border-line p-6 max-[700px]:flex-col max-[700px]:items-start">
            <div>
              <p className="mb-[9px] font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
                {interpolate(dictionary.detail.selectedTask, {
                  identifier: selectedTask.identifier,
                })}
              </p>
              <h2 className="font-display text-2xl font-semibold leading-tight" id="detail-title">
                {selectedTask.title}
              </h2>
            </div>
            <a
              className="whitespace-nowrap border border-line px-3 py-2 text-[11px] text-signal transition hover:border-signal hover:bg-signal/10"
              href={selectedTask.source.url}
              target="_blank"
              rel="noreferrer"
            >
              {dictionary.detail.openGitHub}
            </a>
          </div>
          <div className="grid grid-cols-1 gap-px bg-line min-[701px]:grid-cols-2">
            <section className="min-w-0 bg-panel px-6 py-5" aria-labelledby="attempts-title">
              <div className="mb-3.5 flex items-center justify-between gap-3">
                <h3 className="text-[13px]" id="attempts-title">
                  {dictionary.detail.attempts}
                </h3>
                <span className="font-mono text-[10px] text-faint">{selectedAttempts.length}</span>
              </div>
              {selectedAttempts.length === 0 ? (
                <p className="text-[11px] leading-relaxed text-faint">
                  {dictionary.detail.noAttempt}
                </p>
              ) : (
                selectedAttempts.map((attempt) => (
                  <AttemptRow
                    attempt={attempt}
                    active={attempt.id === latestAttempt?.id}
                    dictionary={dictionary}
                    key={attempt.id}
                  />
                ))
              )}
              {detail && latestAttempt && (
                <div className="flex flex-wrap gap-2 pt-[15px]">
                  <button
                    className="cursor-pointer border border-line bg-transparent px-2.5 py-2 text-[11px] transition hover:border-signal hover:bg-signal/10"
                    type="button"
                    onClick={() => onCommand("pause_attempt")}
                  >
                    {dictionary.detail.requestPause}
                  </button>
                  <button
                    className="cursor-pointer border border-line bg-transparent px-2.5 py-2 text-[11px] transition hover:border-signal hover:bg-signal/10"
                    type="button"
                    onClick={() => onCommand("retry_attempt")}
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
          {detail && <AttemptDetail detail={detail} dictionary={dictionary} locale={locale} />}
        </>
      ) : (
        <div className="px-6 py-[70px] text-center">
          <span
            className="mb-[15px] block font-display text-[42px] leading-none text-signal"
            aria-hidden="true"
          >
            ∅
          </span>
          <h2 className="mb-2 font-display text-[22px] font-semibold" id="detail-title">
            {dictionary.detail.noTask}
          </h2>
          <p className="mb-0 text-xs text-muted">{dictionary.detail.empty}</p>
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
    <section
      className="min-w-0 bg-panel px-6 py-5"
      id="verification"
      aria-labelledby="verification-title"
    >
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <h3 className="text-[13px]" id="verification-title">
          {dictionary.detail.verification}
        </h3>
        <span className="text-[10px] text-signal">{dictionary.detail.independent}</span>
      </div>
      {verifications.length ? (
        verifications.map((item) => (
          <div
            className="flex items-center justify-between gap-3 border-b border-line py-[11px] text-[11px] text-muted"
            key={item.id}
          >
            <span
              className={`border px-1.5 py-1 font-mono text-[9px] uppercase ${verificationStatusClass(item.status)}`}
            >
              {dictionary.statuses[item.status] ?? item.status}
            </span>
            <span>{item.checkId}</span>
            <code className="font-mono text-[10px] text-faint">
              {item.exitCode === null ? "—" : `exit ${item.exitCode}`}
            </code>
          </div>
        ))
      ) : (
        <p className="text-[11px] leading-relaxed text-faint">{dictionary.detail.notVerified}</p>
      )}
    </section>
  );
}

function verificationStatusClass(status: string): string {
  if (status === "passed") return "border-signal-soft text-signal";
  if (status === "failed" || status === "timed_out") return "border-danger text-danger";
  return "border-line text-muted";
}
