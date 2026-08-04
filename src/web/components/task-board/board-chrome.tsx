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
  return (
    <>
      <header className="sticky top-0 z-10 flex min-h-[74px] items-center justify-between border-b border-line bg-page/85 px-[34px] backdrop-blur-xl max-[700px]:px-[18px]">
        <div className="flex items-center gap-3 tracking-[-0.02em]">
          <span className="grid size-8 place-items-center bg-signal font-mono text-[15px] font-extrabold leading-none text-page">
            S/
          </span>
          <span>
            <strong className="block text-[15px]">{dictionary.brand.name}</strong>
            <small className="mt-0.5 block font-mono text-[10px] uppercase leading-tight tracking-[0.12em] text-muted">
              {dictionary.brand.strapline}
            </small>
          </span>
        </div>
        <div className="flex items-center gap-[18px] max-[700px]:gap-2">
          <LocaleSwitcher dictionary={dictionary} locale={locale} />
          <ThemeSwitcher labels={dictionary.controls} />
          <span
            className={`flex items-center gap-2 font-mono text-xs uppercase tracking-[0.06em] max-[700px]:text-[0px] ${connection === "online" ? "text-signal" : "text-muted"}`}
            role="status"
          >
            <span
              className={`size-[7px] rounded-full shadow-[0_0_0_4px] ${connection === "online" ? "bg-signal shadow-signal/10" : "bg-danger shadow-danger/10"}`}
              aria-hidden="true"
            />
            {dictionary.runtime.label}{" "}
            {connection === "online" ? dictionary.runtime.online : dictionary.runtime.offline}
          </span>
          <button
            className="cursor-pointer border border-line bg-transparent px-3 py-2 text-xs text-muted transition hover:border-signal hover:bg-signal/10"
            type="button"
            onClick={() => window.location.reload()}
          >
            {dictionary.runtime.reconnect}
          </button>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-74px)] grid-cols-[206px_minmax(0,1fr)] max-[1100px]:grid-cols-[166px_minmax(0,1fr)] max-[700px]:block">
        <aside
          className="flex flex-col border-r border-line px-[18px] py-[34px] max-[700px]:flex-row max-[700px]:items-center max-[700px]:gap-3 max-[700px]:border-b max-[700px]:border-r-0 max-[700px]:px-[18px] max-[700px]:py-3"
          aria-label={dictionary.navigation.label}
        >
          <div className="px-3 pb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-faint max-[700px]:hidden">
            {dictionary.navigation.localControlPlane}
          </div>
          <nav className="grid gap-1 max-[700px]:flex max-[700px]:gap-1">
            <a
              className="flex w-full items-center gap-[11px] bg-panel px-3 py-3 text-[13px] text-ink shadow-[inset_2px_0_0_0_var(--signal)] max-[700px]:py-2.5"
              href="#task-board"
            >
              <span className="w-3.5 text-center text-faint" aria-hidden="true">
                ▦
              </span>{" "}
              {dictionary.navigation.tasks}
              <span className="ml-auto font-mono text-[11px] text-faint">
                {snapshot?.tasks.length ?? 0}
              </span>
            </a>
            <a
              className="flex w-full items-center gap-[11px] px-3 py-3 text-[13px] text-muted transition hover:bg-panel hover:text-ink max-[700px]:py-2.5"
              href="#selected-task"
            >
              <span className="w-3.5 text-center text-faint" aria-hidden="true">
                ◌
              </span>{" "}
              {dictionary.navigation.activity}
            </a>
            <a
              className="flex w-full items-center gap-[11px] px-3 py-3 text-[13px] text-muted transition hover:bg-panel hover:text-ink max-[700px]:py-2.5"
              href="#verification"
            >
              <span className="w-3.5 text-center text-faint" aria-hidden="true">
                ✓
              </span>{" "}
              {dictionary.navigation.evidence}
            </a>
          </nav>
          <RuntimeStatus dictionary={dictionary} health={health} locale={locale} />
          <div className="mt-auto grid gap-[7px] px-3 py-3.5 text-[11px] text-muted max-[700px]:hidden">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
              {dictionary.navigation.projection}
            </div>
            <code className="text-signal">v{snapshot?.projectionVersion ?? 1}</code>
            <span>
              {dictionary.navigation.events} {snapshot?.runtime.lastEventSequence ?? 0}
            </span>
          </div>
        </aside>
        {children}
      </div>
    </>
  );
}
