import { createReadStream, existsSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

import { RuntimeError } from "../errors.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

export function isApiPath(pathname: string): boolean {
  return pathname === "/healthz" || pathname.startsWith("/v1/") || pathname === "/v1";
}

export async function tryServeStaticUi(
  response: ServerResponse,
  options: {
    uiDistDir: string;
    pathname: string;
    sessionToken: string;
    bootstrap?: Record<string, string>;
  },
): Promise<boolean> {
  const dist = resolve(options.uiDistDir);
  if (!existsSync(dist)) {
    throw new RuntimeError("not_found", "UI build is missing; run pnpm web:build");
  }

  const requested = options.pathname === "/" ? "/index.html" : options.pathname;
  const candidate = safeJoin(dist, requested);
  if (candidate && existsSync(candidate) && statSync(candidate).isFile()) {
    await sendFile(response, candidate, options.pathname.startsWith("/assets/"));
    return true;
  }

  // SPA fallback — never for API routes (caller must guard).
  const index = join(dist, "index.html");
  if (!existsSync(index)) {
    throw new RuntimeError("not_found", "UI index.html is missing; run pnpm web:build");
  }
  await sendIndex(response, index, options.sessionToken, options.bootstrap ?? {});
  return true;
}

function safeJoin(root: string, pathname: string): string | null {
  const normalized = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const full = resolve(root, `.${normalized.startsWith("/") ? normalized : `/${normalized}`}`);
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

function sendFile(response: ServerResponse, filePath: string, immutable: boolean): Promise<void> {
  const type = MIME[extname(filePath)] ?? "application/octet-stream";
  response.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  return new Promise((resolvePromise, reject) => {
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("end", () => resolvePromise());
    stream.pipe(response);
  });
}

async function sendIndex(
  response: ServerResponse,
  indexPath: string,
  sessionToken: string,
  bootstrap: Record<string, string>,
): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  let html = await readFile(indexPath, "utf8");
  const payload = JSON.stringify({
    token: sessionToken,
    ...bootstrap,
  }).replace(/</g, "\\u003c");
  const snippet = `<script>window.__SYMPHONEER_RUNTIME__=${payload};</script>`;
  if (html.includes("</head>")) html = html.replace("</head>", `${snippet}</head>`);
  else html = `${snippet}${html}`;
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(html);
}
