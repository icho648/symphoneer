import type { AttemptSnapshot, RuntimeAttemptDetail } from "@symphoneer/contracts";
import { formatDateTime } from "@/lib/format";
import type { Dictionary, Locale } from "../../i18n/index.ts";

export function AttemptRow({
  attempt,
  active,
  dictionary,
}: {
  attempt: AttemptSnapshot;
  active: boolean;
  dictionary: Dictionary;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 border-b border-line py-3 text-[11px] ${active ? "border-signal bg-signal/5" : ""}`}
    >
      <div className="grid gap-1">
        <strong>
          {dictionary.attempt.label} {String(attempt.sequence).padStart(2, "0")}
        </strong>
        <span className="text-muted">
          {dictionary.startReasons[attempt.startReason] ?? attempt.startReason}
        </span>
      </div>
      <span
        className={`border px-1.5 py-1 font-mono text-[9px] uppercase ${attemptStatusClass(attempt.status)}`}
      >
        {dictionary.statuses[attempt.status] ?? attempt.status}
      </span>
    </div>
  );
}

export function AttemptDetail({
  detail,
  dictionary,
  locale,
}: {
  detail: RuntimeAttemptDetail;
  dictionary: Dictionary;
  locale: Locale;
}) {
  return (
    <section
      className="border-t border-line bg-panel px-6 py-5"
      aria-labelledby="attempt-detail-title"
    >
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <h3 className="text-[13px]" id="attempt-detail-title">
          {dictionary.attempt.detail}
        </h3>
        <span className="font-mono text-[10px] text-faint">
          {formatDateTime(detail.attempt.updatedAt, locale)}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 min-[701px]:grid-cols-3">
        <span className="grid gap-1">
          <small className="text-[10px] text-faint">{dictionary.attempt.agentState}</small>
          <strong className="text-xs">
            {dictionary.statuses[detail.attempt.status] ?? detail.attempt.status}
          </strong>
        </span>
        <span className="grid gap-1">
          <small className="text-[10px] text-faint">{dictionary.attempt.providerSession}</small>
          <strong className="overflow-hidden text-ellipsis text-xs">
            {detail.attempt.providerSession?.threadId ?? dictionary.attempt.notStarted}
          </strong>
        </span>
        <span className="grid gap-1">
          <small className="text-[10px] text-faint">{dictionary.attempt.humanDecisions}</small>
          <strong className="text-xs">{detail.reviews.length}</strong>
        </span>
      </div>
      <details className="mt-5 border border-line bg-page/30 p-3.5">
        <summary className="cursor-pointer text-xs text-signal">
          {dictionary.attempt.workspace}
        </summary>
        {detail.workspace ? (
          <dl className="mt-3.5 grid gap-2 text-[11px]">
            <div className="flex items-baseline justify-between gap-4 border-b border-line py-2">
              <dt className="text-faint">{dictionary.attempt.path}</dt>
              <dd>
                <code className="font-mono text-[10px] text-muted">{detail.workspace.path}</code>
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-line py-2">
              <dt className="text-faint">{dictionary.attempt.branch}</dt>
              <dd>
                <code className="font-mono text-[10px] text-muted">{detail.workspace.branch}</code>
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-line py-2">
              <dt className="text-faint">{dictionary.attempt.state}</dt>
              <dd className="text-muted">{detail.workspace.state}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-faint">{dictionary.attempt.gitHead}</dt>
              <dd>
                <code className="font-mono text-[10px] text-muted">
                  {detail.workspace.gitHead ?? dictionary.attempt.notObserved}
                </code>
              </dd>
            </div>
          </dl>
        ) : (
          <p className="mt-3.5 text-[11px] leading-relaxed text-muted">
            {dictionary.attempt.workspaceNotRecorded}
          </p>
        )}
      </details>
      <div className="mt-5">
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <h4 className="text-[13px]">{dictionary.attempt.humanDecisions}</h4>
          <span className="font-mono text-[10px] text-faint">{dictionary.attempt.authority}</span>
        </div>
        {detail.reviews.length === 0 ? (
          <p className="text-[11px] leading-relaxed text-muted">{dictionary.attempt.noReview}</p>
        ) : (
          detail.reviews.map((review) => (
            <div
              className="flex items-center justify-between gap-3 border-b border-line py-2.5 text-[11px]"
              key={review.id}
            >
              <strong>{dictionary.decisions[review.decision] ?? review.decision}</strong>
              <span className="text-muted">
                {review.decidedBy} · {formatDateTime(review.decidedAt, locale)}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function attemptStatusClass(status: AttemptSnapshot["status"]): string {
  if (status === "succeeded") return "border-signal-soft text-signal";
  if (status === "failed" || status === "timed_out" || status === "stalled") {
    return "border-danger text-danger";
  }
  if (status === "paused") return "border-amber text-amber";
  return "border-line text-muted";
}
