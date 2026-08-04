import type { AttemptSnapshot, TaskSummary, WorkspaceReference } from "@symphoneer/contracts";

import type { RetryEntry } from "./types.ts";

export interface RunningAttempt {
  task: TaskSummary;
  attemptId: string;
  workspace: WorkspaceReference;
  failureRetryAttempt: number;
}

export interface SchedulerState {
  attempts: Map<string, AttemptSnapshot>;
  running: Map<string, RunningAttempt>;
  claims: Map<string, string>;
  workspaceOwners: Map<string, string>;
  workspaces: Map<string, WorkspaceReference>;
  activeTurns: Map<string, { attemptId: string; threadId: string; turnId: string }>;
  activeThreads: Map<string, string>;
  pausedThreads: Map<string, string>;
  retries: Map<string, RetryEntry>;
  pausedFailureRetries: Map<string, number>;
}

export const createSchedulerState = (): SchedulerState => ({
  attempts: new Map(),
  running: new Map(),
  claims: new Map(),
  workspaceOwners: new Map(),
  workspaces: new Map(),
  activeTurns: new Map(),
  activeThreads: new Map(),
  pausedThreads: new Map(),
  retries: new Map(),
  pausedFailureRetries: new Map(),
});
