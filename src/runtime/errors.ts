export class RuntimeError extends Error {
  readonly code:
    | "corrupt_event"
    | "unknown_event"
    | "duplicate_event"
    | "artifact_conflict"
    | "invalid_path"
    | "conflict"
    | "not_found"
    | "unsupported"
    | "invalid_request";

  constructor(code: RuntimeError["code"], message: string) {
    super(message);
    this.name = "RuntimeError";
    this.code = code;
  }
}
