import assert from "node:assert/strict";
import test from "node:test";

import { providerPresentation } from "../../src/web/lib/provider-presentation.ts";

test("Claude Code and Codex expose distinct provider presentation contracts", () => {
  const claude = providerPresentation("claude-code");
  const codex = providerPresentation("codex-app-server");

  assert.deepEqual(claude, {
    iconSrc: "/brand/providers/claude-code.svg",
    kind: "claude",
    supportsCodexSettings: false,
  });
  assert.deepEqual(codex, {
    iconSrc: "/brand/providers/openai-blossom.svg",
    kind: "codex",
    supportsCodexSettings: true,
  });
  assert.notEqual(claude.iconSrc, codex.iconSrc);
  assert.notEqual(claude.kind, codex.kind);
});

test("unknown providers stay neutral instead of inheriting Codex identity", () => {
  assert.deepEqual(providerPresentation(null), {
    iconSrc: null,
    kind: "neutral",
    supportsCodexSettings: false,
  });
  assert.deepEqual(providerPresentation("fake"), {
    iconSrc: null,
    kind: "neutral",
    supportsCodexSettings: false,
  });
});
