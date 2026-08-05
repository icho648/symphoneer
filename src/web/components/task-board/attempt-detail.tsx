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
      className={`flex items-center justify-between gap-3 border-b border-line px-3 py-2.5 text-[12px] last:border-b-0 ${active ? "bg-signal-soft" : ""}`}
    >
      <div className="grid min-w-0 gap-0.5">
        <strong className="truncate font-semibold">
          {dictionary.attempt.label} {String(attempt.sequence).padStart(2, "0")}
        </strong>
        <span className="truncate text-[11px] text-muted">
          {dictionary.startReasons[attempt.startReason] ?? attempt.startReason}
        </span>
      </div>
      <span className={`macos-pill shrink-0 ${attemptStatusClass(attempt.status)}`}>
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
      className="border-t border-line bg-panel-raised/50 px-4 py-3.5"
      aria-labelledby="attempt-detail-title"
    >
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

function attemptStatusClass(status: AttemptSnapshot["status"]): string {
  if (status === "succeeded") return "bg-success/15 text-success";
  if (status === "failed" || status === "timed_out" || status === "stalled") {
    return "bg-danger/15 text-danger";
  }
  if (status === "paused") return "bg-amber/15 text-amber";
  return "bg-panel-raised text-muted";
}
