import type { TaskSummary } from "@symphoneer/contracts";

export type TrackerErrorCode =
  | "invalid_response"
  | "network_error"
  | "not_authorized"
  | "not_found"
  | "rate_limited"
  | "tracker_conflict"
  | "unavailable"
  | "unsupported";

export class TrackerError extends Error {
  readonly code: TrackerErrorCode;
  readonly retryable: boolean;

  constructor(code: TrackerErrorCode, retryable: boolean, message: string) {
    super(message);
    this.name = "TrackerError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface TaskSnapshot {
  task: TaskSummary;
  /** Opaque concurrency / cache token from the tracker provider. */
  versionToken: string | null;
}

export interface Tracker {
  /**
   * Read one Task by tracker-native identity.
   * GitHub uses the Issue number as a decimal string (e.g. `"14"`).
   */
  getTask(
    nativeId: string,
    options?: { expectedUpdatedAt?: string; signal?: AbortSignal },
  ): Promise<TaskSnapshot>;
}
