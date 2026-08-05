import type { RuntimeHealth } from "@symphoneer/contracts";
import { formatDateTime } from "@/lib/format";
import { type Dictionary, interpolate, type Locale } from "../../i18n/index.ts";

export function RuntimeStatus({
  dictionary,
  health,
  locale,
}: {
  dictionary: Dictionary;
  health: RuntimeHealth | null;
  locale: Locale;
}) {
  const running = health?.process.status === "running";
  return (
    <section
      className="mt-3 rounded-[10px] border border-line bg-panel/70 p-3 max-[700px]:mt-2"
      aria-label={dictionary.runtime.process}
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
          {dictionary.runtime.process}
        </span>
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${running ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}
        >
          {running ? dictionary.runtime.running : dictionary.runtime.offline}
        </span>
      </div>
      {health ? (
        <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] text-muted">
          <div>
            <dt className="text-faint">{dictionary.runtime.pid}</dt>
            <dd className="font-mono text-ink">{health.process.pid}</dd>
          </div>
          <div>
            <dt className="text-faint">{dictionary.runtime.uptime}</dt>
            <dd className="font-mono text-ink">
              {formatUptime(health.process.uptimeSeconds, dictionary.runtime)}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-faint">{dictionary.runtime.started}</dt>
            <dd className="font-mono text-ink">
              {formatDateTime(health.process.startedAt, locale)}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          {dictionary.runtime.unreachable}
        </p>
      )}
    </section>
  );
}

function formatUptime(seconds: number, labels: Dictionary["runtime"]): string {
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    return interpolate(labels.hours, { value: hours, remainder: minutes % 60 });
  }
  if (minutes > 0) {
    return interpolate(labels.minutes, { value: minutes, remainder: total % 60 });
  }
  return interpolate(labels.seconds, { value: total });
}
