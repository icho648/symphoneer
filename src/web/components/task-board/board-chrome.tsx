import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkbench } from "../../stores/workbench.ts";

import { LocaleSwitcher } from "../locale-switcher";
import { ThemeSwitcher } from "../theme-switcher";

export function BoardChrome({ children }: { children: ReactNode }) {
  const { connection, dictionary, locale, snapshot } = useWorkbench(
    useShallow((state) => ({
      connection: state.connection,
      dictionary: state.dictionary,
      locale: state.locale,
      snapshot: state.snapshot,
    })),
  );
  const online = connection === "online";

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-window">
      <header className="flex min-h-[58px] shrink-0 items-center justify-between gap-4 border-b border-line bg-toolbar px-4 backdrop-blur-2xl max-[700px]:px-3">
        <div className="flex min-w-0 items-center gap-3">
          <img
            alt=""
            aria-hidden="true"
            className="size-7 rounded-[7px] shadow-[0_0_0_0.5px_var(--line)]"
            height={28}
            src="/brand/symphoneer-icon.png"
            width={28}
          />
          <div className="min-w-0">
            <strong className="block truncate text-[13px] font-semibold tracking-[-0.01em]">
              {dictionary.brand.name}
            </strong>
            <small className="block truncate text-[11px] text-muted">
              {dictionary.brand.strapline}
            </small>
          </div>
        </div>

        <fieldset className="chrome-context">
          <legend className="sr-only">{dictionary.navigation.localControlPlane}</legend>
          <ContextChip
            label={dictionary.runtime.localRuntime}
            value={online ? dictionary.runtime.online : dictionary.runtime.offline}
            tone={online ? "success" : "danger"}
          />
          <ContextChip
            label={dictionary.runtime.remoteProjection}
            value={
              snapshot
                ? `v${snapshot.projectionVersion} · #${snapshot.runtime.lastEventSequence}`
                : "—"
            }
          />
          <ContextChip
            label={dictionary.runtime.connector}
            value={snapshot?.tasks.length ? dictionary.runtime.synced : "—"}
          />
        </fieldset>

        <div className="flex shrink-0 items-center gap-2">
          <LocaleSwitcher dictionary={dictionary} locale={locale} />
          <ThemeSwitcher labels={dictionary.controls} />
          <span
            className={`hidden items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium sm:inline-flex ${online ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}
            role="status"
          >
            <span
              className={`size-1.5 rounded-full ${online ? "bg-success" : "bg-danger"}`}
              aria-hidden="true"
            />
            {dictionary.runtime.label}{" "}
            {online ? dictionary.runtime.online : dictionary.runtime.offline}
          </span>
          <button className="macos-btn" type="button" onClick={() => window.location.reload()}>
            {dictionary.runtime.reconnect}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto bg-window">{children}</div>
    </div>
  );
}

function ContextChip({
  label,
  tone = "",
  value,
}: {
  label: string;
  tone?: "danger" | "success" | "";
  value: string;
}) {
  return (
    <span className={`chrome-context-chip ${tone ? `is-${tone}` : ""}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}
