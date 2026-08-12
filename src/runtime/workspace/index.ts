export { DirectoryWorkspaceDriver } from "./directory-driver.ts";
export { WorkspaceError } from "./error.ts";
export { GitWorktreeDriver } from "./git-worktree/index.ts";
export { WorkspaceManager } from "./manager.ts";
export {
  canonicalizeWorkspaceReference,
  createWorkspaceReference,
  workspaceAttemptKey,
  workspaceKey,
} from "./reference.ts";
export type {
  FinishedWorkspace,
  PreparedWorkspace,
  WorkspaceDriver,
  WorkspaceHookFailure,
  WorkspaceHooks,
  WorkspaceInput,
  WorkspaceObservation,
  WorkspaceReferenceInput,
} from "./types.ts";
