export class VerificationError extends Error {
  readonly code: "artifact_exists" | "invalid_workspace" | "git_failed" | "process_failed";

  constructor(code: VerificationError["code"], message: string) {
    super(message);
    this.name = "VerificationError";
    this.code = code;
  }
}
