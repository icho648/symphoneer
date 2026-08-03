export class WorkspaceError extends Error {
  readonly code:
    | "workspace_not_directory"
    | "workspace_outside_root"
    | "workspace_identity_mismatch"
    | "hook_failed"
    | "hook_timed_out";

  constructor(code: WorkspaceError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkspaceError";
    this.code = code;
  }
}
