import { RuntimeClientError } from "@symphoneer/runtime-client";

/** Shared loopback Runtime URL validation for Node helpers and tests. */
export function runtimeUrl(value = process.env.SYMPHONEER_RUNTIME_URL ?? "http://127.0.0.1:4318"): string {
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(hostname)) {
    throw new RuntimeClientError(0, "invalid_runtime_url", "Runtime must stay on loopback HTTP");
  }
  return url.href.replace(/\/$/, "");
}
