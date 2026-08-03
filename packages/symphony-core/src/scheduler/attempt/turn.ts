import { type AttemptSnapshot, AttemptSnapshotSchema } from "@symphoneer/contracts";

import type { SchedulerState } from "../state.ts";
import { CoreError } from "../types.ts";

export function attachTurn(
  state: SchedulerState,
  request: { attemptId: string; threadId: string; turnId: string; updatedAt: string },
): AttemptSnapshot {
  const attempt = state.attempts.get(request.attemptId);
  if (!attempt) throw new CoreError("not_found", `Attempt ${request.attemptId} does not exist`);
  const activeTurn = attempt.activeTurn;
  if (activeTurn?.threadId === request.threadId && activeTurn.turnId === request.turnId) {
    return attempt;
  }
  if (activeTurn != null && activeTurn.threadId !== request.threadId) {
    throw new CoreError("conflict", `Attempt ${request.attemptId} already has another Thread`);
  }
  const threadOwner = state.activeThreads.get(request.threadId);
  if (state.activeTurns.has(request.turnId) || (threadOwner && threadOwner !== attempt.id)) {
    throw new CoreError("conflict", "Thread or Turn already has another active owner");
  }
  const updated = AttemptSnapshotSchema.parse({
    ...attempt,
    status: "streaming_turn",
    activeTurn: { threadId: request.threadId, turnId: request.turnId },
    updatedAt: request.updatedAt,
  });
  if (activeTurn) state.activeTurns.delete(activeTurn.turnId);
  state.attempts.set(updated.id, updated);
  state.activeTurns.set(request.turnId, {
    attemptId: updated.id,
    threadId: request.threadId,
    turnId: request.turnId,
  });
  state.activeThreads.set(request.threadId, updated.id);
  return updated;
}
