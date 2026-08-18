import { ActivityPayloadSchema, type ExecutionSession } from "@symphoneer/contracts";
import type { AgentRunEvent } from "./agent-runner.ts";
import { codexSessionExecutionActivities } from "./codex-app-server/activities.ts";

export function sessionExecutionActivities(
  session: ExecutionSession,
): Array<Extract<AgentRunEvent, { type: "activity" }>> {
  if (session.provider === "codex-app-server") return codexSessionExecutionActivities(session);
  return session.turns.flatMap((turn) =>
    turn.items.flatMap((item) => {
      const activity = ActivityPayloadSchema.safeParse(item.data.activity);
      return activity.success
        ? [
            {
              type: "activity" as const,
              occurredAt: session.capturedAt,
              itemId: item.id,
              ...activity.data,
            },
          ]
        : [];
    }),
  );
}
