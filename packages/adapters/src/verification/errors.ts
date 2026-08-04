export class VerificationError extends Error {
  readonly code:
    | "artifact_exists"
    | "artifact_replaced"
    | "invalid_workspace"
    | "git_failed"
    | "process_failed";

  constructor(code: VerificationError["code"], message: string) {
    super(message);
    this.name = "VerificationError";
    this.code = code;
  }
}
