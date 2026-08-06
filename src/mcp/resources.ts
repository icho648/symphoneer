import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** MCP Apps UI resource URIs (optional Host rendering). */
export const UI_RESOURCES = {
  task: "ui://symphoneer/task",
  attempt: "ui://symphoneer/attempt",
  verification: "ui://symphoneer/verification",
  intervention: "ui://symphoneer/intervention",
} as const;

export type UiResourceKind = keyof typeof UI_RESOURCES;

const UI_SHELL = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Symphoneer</title>
  <style>
    :root { color-scheme: light; font-family: "IBM Plex Sans", "Segoe UI", sans-serif; }
    body { margin: 0; padding: 1rem; background: linear-gradient(160deg, #f3efe6, #dce7e2); color: #1c2421; }
    h1 { font-size: 1.1rem; margin: 0 0 0.5rem; letter-spacing: 0.04em; text-transform: uppercase; }
    .status { font-size: 0.85rem; opacity: 0.8; margin-bottom: 0.75rem; }
    pre { white-space: pre-wrap; word-break: break-word; background: rgba(255,255,255,0.55); padding: 0.75rem; border: 0; }
    .err { color: #8a2f1d; }
  </style>
</head>
<body>
  <h1>Symphoneer <span id="kind"></span></h1>
  <p class="status" id="status">loading</p>
  <pre id="body"></pre>
  <script type="module">
    const kind = new URL(import.meta.url).searchParams.get("kind") || "attempt";
    document.getElementById("kind").textContent = kind;
    const statusEl = document.getElementById("status");
    const bodyEl = document.getElementById("body");

    function setState(label, payload, isError) {
      statusEl.textContent = label;
      statusEl.className = "status" + (isError ? " err" : "");
      bodyEl.textContent = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    }

    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      const method = data.method || data.type;
      if (method === "ui/notifications/tool-input" || method === "ui/initialize") {
        setState("loading", data.params ?? data);
        return;
      }
      if (method === "ui/notifications/tool-result") {
        const result = data.params?.result ?? data.params ?? data;
        const failed = Boolean(result?.isError) || result?.structuredContent?.ok === false;
        if (failed) {
          const code = result?.structuredContent?.code || "error";
          if (code === "unavailable") setState("offline", result, true);
          else if (code === "conflict") setState("conflict", result, true);
          else setState("error", result, true);
          return;
        }
        setState("success", result?.structuredContent?.data ?? result);
        return;
      }
      if (method === "ui/notifications/tool-cancelled" || method === "ui/notifications/cancelled") {
        setState("canceled approval", data.params ?? { canceled: true }, true);
      }
    });

    setState("loading", { kind, hint: "Waiting for Host tool result. Tools still work without this UI." });
  </script>
</body>
</html>
`;

export function uiResourceHtml(kind: UiResourceKind): string {
  // Embed kind for hosts that load the HTML without query params.
  return UI_SHELL.replace(
    'const kind = new URL(import.meta.url).searchParams.get("kind") || "attempt";',
    `const kind = ${JSON.stringify(kind)};`,
  );
}

export function uiMeta(kind: UiResourceKind): Record<string, unknown> {
  return { ui: { resourceUri: UI_RESOURCES[kind] } };
}

export function registerUiResources(server: McpServer): void {
  for (const kind of Object.keys(UI_RESOURCES) as UiResourceKind[]) {
    const uri = UI_RESOURCES[kind];
    server.registerResource(
      `symphoneer-${kind}`,
      uri,
      {
        title: `Symphoneer ${kind} UI`,
        description: `Optional MCP Apps UI for ${kind}. Display-only; tools remain authoritative.`,
        mimeType: "text/html;profile=mcp-app",
      },
      async () => ({
        contents: [
          {
            uri,
            mimeType: "text/html;profile=mcp-app",
            text: uiResourceHtml(kind),
          },
        ],
      }),
    );
  }
}
