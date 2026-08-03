import type { WorkspaceReference } from "@symphoneer/contracts";

import type { WorkspaceError } from "./error.ts";

export interface WorkspaceReferenceInput {
  root: string;
  taskId: string;
  identifier: string;
  attemptId: string;
  repository: string;
  branch: string;
  host: string;
}

export type WorkspaceInput = Omit<WorkspaceReferenceInput, "root">;

export interface WorkspaceHooks {
  afterCreate?: string;
  beforeRun?: string;
  afterRun?: string;
  beforeRemove?: string;
  timeoutMs?: number;
}

export const workspaceHookNames = {
  afterCreate: "after_create",
  beforeRun: "before_run",
  afterRun: "after_run",
  beforeRemove: "before_remove",
} as const;

export type WorkspaceHook = keyof typeof workspaceHookNames;

export interface WorkspaceHookFailure {
  hook: (typeof workspaceHookNames)[WorkspaceHook];
  error: WorkspaceError;
}

export interface PreparedWorkspace {
  workspace: WorkspaceReference;
  createdNow: boolean;
}

export interface FinishedWorkspace {
  workspace: WorkspaceReference;
  hookFailures: WorkspaceHookFailure[];
}
