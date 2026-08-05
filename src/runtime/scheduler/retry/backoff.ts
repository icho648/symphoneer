import type { RetryEntry } from "../types.ts";

export function retryDelayMs(
  kind: RetryEntry["kind"],
  attempt: number,
  maxRetryBackoffMs: number,
): number {
  if (kind === "continuation") return 1_000;
  return Math.min(10_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 52), maxRetryBackoffMs);
}
