import { RuntimeClientError } from "@symphoneer/runtime-client";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/** Resolve and enforce loopback-only Runtime HTTP URL for MCP. */
export function resolveRuntimeUrl(value = process.env.SYMPHONEER_RUNTIME_URL): string {
  const raw = value ?? "http://127.0.0.1:4318";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RuntimeClientError(0, "invalid_runtime_url", "Runtime URL is invalid");
  }
  const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(hostname)) {
    throw new RuntimeClientError(0, "invalid_runtime_url", "Runtime must stay on loopback HTTP");
  }
  return url.href.replace(/\/$/, "");
}
