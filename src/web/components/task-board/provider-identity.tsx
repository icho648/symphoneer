import type { Dictionary } from "../../i18n/index.ts";
import { providerPresentation } from "../../lib/provider-presentation.ts";

export function ProviderIdentity({
  compact = false,
  dictionary,
  provider,
}: {
  compact?: boolean;
  dictionary: Dictionary;
  provider: string | null;
}) {
  const presentation = providerPresentation(provider);
  const copy = dictionary.detail.providers[presentation.kind];
  return (
    <div
      className={`task-provider-identity is-${presentation.kind}${compact ? " is-compact" : ""}`}
      data-provider={presentation.kind}
    >
      <span className="task-provider-mark" aria-hidden="true">
        {presentation.iconSrc ? <img alt="" src={presentation.iconSrc} /> : <span>↯</span>}
      </span>
      <span className="task-provider-copy">
        <strong>{copy.name}</strong>
        {!compact && <small>{copy.runtime}</small>}
      </span>
    </div>
  );
}
