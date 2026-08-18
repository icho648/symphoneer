export type ProviderKind = "claude" | "codex" | "neutral";

export type ProviderPresentation = {
  iconSrc: string | null;
  kind: ProviderKind;
  supportsCodexSettings: boolean;
};

export function providerPresentation(provider: string | null): ProviderPresentation {
  if (provider === "claude-code") {
    return {
      iconSrc: "/brand/providers/claude-code.svg",
      kind: "claude",
      supportsCodexSettings: false,
    };
  }
  if (provider === "codex-app-server") {
    return {
      iconSrc: "/brand/providers/openai-blossom.svg",
      kind: "codex",
      supportsCodexSettings: true,
    };
  }
  return { iconSrc: null, kind: "neutral", supportsCodexSettings: false };
}
