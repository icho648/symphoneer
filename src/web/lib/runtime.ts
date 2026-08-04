import type { RuntimeHealth, RuntimeSnapshot } from "@symphoneer/contracts";
import { RuntimeClient, RuntimeClientError } from "@symphoneer/runtime-client";

export function runtimeUrl(): string {
  const value = process.env.SYMPHONEER_RUNTIME_URL ?? "http://127.0.0.1:4318";
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new RuntimeClientError(0, "invalid_runtime_url", "Runtime must stay on loopback HTTP");
  }
  return url.href.replace(/\/$/, "");
}

export function runtimeClient(): RuntimeClient {
  return new RuntimeClient({ baseUrl: runtimeUrl() });
}

export async function initialSnapshot(): Promise<RuntimeSnapshot | null> {
  try {
    return await runtimeClient().snapshot();
  } catch {
    return null;
  }
}

export async function initialHealth(): Promise<RuntimeHealth | null> {
  try {
    return await runtimeClient().health();
  } catch {
    return null;
  }
}

export function runtimeErrorResponse(error: unknown): Response {
  const status = error instanceof RuntimeClientError && error.status > 0 ? error.status : 503;
  const code = error instanceof RuntimeClientError ? error.code : "runtime_unavailable";
  const message = error instanceof RuntimeClientError ? error.message : "Runtime is unavailable";
  return Response.json(
    {
      schemaVersion: 2,
      code,
      message,
      retryable: status >= 500,
    },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
