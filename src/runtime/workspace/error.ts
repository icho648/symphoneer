export class WorkspaceError extends Error {
  readonly code:
    | "workspace_not_directory"
    | "workspace_outside_root"
    | "workspace_identity_mismatch"
    | "workspace_dirty"
    | "workspace_git_failed"
    | "hook_failed"
    | "hook_timed_out";
  readonly hookFailures: readonly string[];

  constructor(
    code: WorkspaceError["code"],
    message: string,
    options?: ErrorOptions & { hookFailures?: readonly string[] },
  ) {
    super(message, options);
    this.name = "WorkspaceError";
    this.code = code;
    this.hookFailures = options?.hookFailures ?? [];
  }
}
