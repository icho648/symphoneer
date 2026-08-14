import { useShallow } from "zustand/react/shallow";
import { useWorkbench } from "../../stores/workbench.ts";

import { LocaleSwitcher } from "../locale-switcher";
import { ThemeSwitcher } from "../theme-switcher";

export function BoardChrome() {
  const { connection, dictionary, locale } = useWorkbench(
    useShallow((state) => ({
      connection: state.connection,
      dictionary: state.dictionary,
      locale: state.locale,
    })),
  );
  const online = connection === "online";

  return (
    <header className="board-chrome">
      <div className="board-chrome-brand">
        <img alt="" aria-hidden="true" height={24} src="/brand/symphoneer-icon.png" width={24} />
        <strong>{dictionary.brand.name}</strong>
        <span className={`board-chrome-status ${online ? "" : "is-offline"}`} role="status">
          <span aria-hidden="true" />
          {online ? dictionary.runtime.online : dictionary.runtime.offline}
        </span>
      </div>
      <div className="board-chrome-controls">
        <LocaleSwitcher dictionary={dictionary} locale={locale} />
        <ThemeSwitcher labels={dictionary.controls} />
        {!online ? (
          <button
            aria-label={dictionary.runtime.reconnect}
            className="board-chrome-reconnect"
            title={dictionary.runtime.reconnect}
            type="button"
            onClick={() => window.location.reload()}
          >
            <span aria-hidden="true">↻</span>
          </button>
        ) : null}
      </div>
    </header>
  );
}
