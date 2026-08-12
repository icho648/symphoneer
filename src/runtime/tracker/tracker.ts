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

export interface TrackerTaskPage {
  tasks: TaskSnapshot[];
  nextCursor: string | null;
}

export interface Tracker {
  /** Stable adapter kind used by the Task source reference. */
  readonly kind: string;

  /**
   * Read one Task by tracker-native identity.
   */
  getTask(
    nativeId: string,
    options?: { expectedUpdatedAt?: string; signal?: AbortSignal },
  ): Promise<TaskSnapshot>;

  /** Read the complete Task collection a page at a time. */
  listTasks?(options?: { cursor?: string; signal?: AbortSignal }): Promise<TrackerTaskPage>;

  /** Apply the provider-native eligibility marker and re-read the Task. */
  enableTaskDispatch?(nativeId: string, options?: { signal?: AbortSignal }): Promise<TaskSnapshot>;
}
