import type { SchedulerState } from "./state.ts";

export const snapshot = (state: SchedulerState) =>
  structuredClone({
    activeAttempts: [...state.running.values()].map((entry) => state.attempts.get(entry.attemptId)),
    attempts: [...state.attempts.values()],
    claimedTaskIds: [...state.claims.keys()],
    workspaceOwners: [...state.workspaceOwners.entries()].map(([path, attemptId]) => ({
      path,
      attemptId,
    })),
    workspaces: [...state.workspaces.values()],
    activeTurns: [...state.activeTurns.values()],
    retries: [...state.retries.values()],
  });
