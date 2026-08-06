export type RuntimeClientErrorCode =
  | "unavailable"
  | "invalid_response"
  | "invalid_url"
  | "invalid_runtime_url"
  | "not_found"
  | "conflict"
  | "stale"
  | "terminal"
  | "unsupported"
  | "invalid_request"
  | "runtime_error";

export class RuntimeClientError extends Error {
  readonly status: number;
  readonly code: RuntimeClientErrorCode | string;

  constructor(status: number, code: RuntimeClientErrorCode | string, message: string) {
    super(message);
    this.name = "RuntimeClientError";
    this.status = status;
    this.code = code;
  }
}

export function mapHttpError(
  status: number,
  code: string,
  message: string,
): RuntimeClientError {
  if (code === "stale" || /stale|expectedEventSequence|expectedAttemptUpdatedAt|revision/i.test(message)) {
    return new RuntimeClientError(status, "stale", message);
  }
  if (code === "terminal" || /terminal/i.test(message)) {
    return new RuntimeClientError(status, "terminal", message);
  }
  if (status === 404 || code === "not_found") {
    return new RuntimeClientError(status, "not_found", message);
  }
  if (status === 409 || code === "conflict" || code === "duplicate_event" || code === "artifact_conflict") {
    return new RuntimeClientError(status, "conflict", message);
  }
  if (status === 501 || code === "unsupported") {
    return new RuntimeClientError(status, "unsupported", message);
  }
  if (status === 400 || code === "invalid_request") {
    return new RuntimeClientError(status, "invalid_request", message);
  }
  return new RuntimeClientError(status, code || "runtime_error", message);
}
