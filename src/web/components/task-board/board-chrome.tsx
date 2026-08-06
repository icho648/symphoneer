import type { RuntimeHealth, RuntimeSnapshot } from "@symphoneer/contracts";
import type { ReactNode } from "react";
import type { Dictionary, Locale } from "../../i18n/index.ts";

import { LocaleSwitcher } from "../locale-switcher";
import { ThemeSwitcher } from "../theme-switcher";
import { RuntimeStatus } from "./runtime-status";

type ConnectionStatus = RuntimeSnapshot["runtime"]["status"];

export function BoardChrome({
  children,
  connection,
  dictionary,
  health,
  locale,
  snapshot,
}: {
  children: ReactNode;
  connection: ConnectionStatus;
  dictionary: Dictionary;
  health: RuntimeHealth | null;
  locale: Locale;
  snapshot: RuntimeSnapshot | null;
}) {
  const online = connection === "online";

  return (
    <div className="flex min-h-screen w-full flex-col overflow-hidden bg-window">
      <header className="flex min-h-[52px] shrink-0 items-center justify-between gap-3 border-b border-line bg-toolbar px-4 backdrop-blur-2xl max-[700px]:px-3">
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

      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)] max-[1100px]:grid-cols-[188px_minmax(0,1fr)] max-[700px]:grid-cols-1">
        <aside
          className="flex flex-col border-r border-line bg-sidebar px-2.5 py-3 backdrop-blur-2xl max-[700px]:border-b max-[700px]:border-r-0"
          aria-label={dictionary.navigation.label}
        >
          <div className="px-2.5 pb-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-faint max-[700px]:hidden">
            {dictionary.navigation.localControlPlane}
          </div>
          <nav className="grid gap-0.5 max-[700px]:grid-flow-col max-[700px]:auto-cols-fr">
            <a className="macos-nav-item" href="#task-board" aria-current="page">
              <SidebarGlyph name="tasks" />
              <span className="truncate">{dictionary.navigation.tasks}</span>
              <span className="macos-nav-meta ml-auto font-mono text-[11px] text-faint">
                {snapshot?.tasks.length ?? 0}
              </span>
            </a>
            <a className="macos-nav-item" href="#selected-task">
              <SidebarGlyph name="activity" />
              <span className="truncate">{dictionary.navigation.activity}</span>
            </a>
            <a className="macos-nav-item" href="#verification">
              <SidebarGlyph name="evidence" />
              <span className="truncate">{dictionary.navigation.evidence}</span>
            </a>
          </nav>

          <RuntimeStatus dictionary={dictionary} health={health} locale={locale} />

          <div className="mt-auto hidden gap-1 px-2.5 py-2 text-[11px] text-muted min-[701px]:grid">
            <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
              {dictionary.navigation.projection}
            </div>
            <code className="font-mono text-[11px] text-signal">
              v{snapshot?.projectionVersion ?? 1}
            </code>
            <span>
              {dictionary.navigation.events} {snapshot?.runtime.lastEventSequence ?? 0}
            </span>
          </div>
        </aside>

        <div className="min-w-0 overflow-auto bg-window">{children}</div>
      </div>
    </div>
  );
}

function SidebarGlyph({ name }: { name: "tasks" | "activity" | "evidence" }) {
  const paths = {
    tasks: "M4 6h16M4 12h16M4 18h10",
    activity: "M12 5v14M5 12h14",
    evidence: "M5 12.5l4 4 10-10",
  } as const;

  return (
    <svg
      aria-hidden="true"
      className="size-3.5 shrink-0 opacity-80"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d={paths[name]} />
    </svg>
  );
}
