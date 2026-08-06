import {
  AgentRunSnapshotSchema,
  CONTRACT_SCHEMA_VERSION,
  type FakeTeamScenario,
  type TaskSummary,
  type TeamProcessEvent,
  TeamProcessEventSchema,
  type TeamRole,
  type WorkspaceReference,
} from "@symphoneer/contracts";

export interface FakeAgentSessionRequest {
  teamRunId: string;
  attemptId: string;
  task: TaskSummary;
  workspace: WorkspaceReference;
  prompt: string;
  continuation: boolean;
  threadId?: string;
  role: TeamRole;
  reviewRound: number;
  eventIndex: number;
  now: string;
  scenario: FakeTeamScenario;
}

export interface FakeAgentSessionResult {
  agentRun: ReturnType<typeof AgentRunSnapshotSchema.parse>;
  events: TeamProcessEvent[];
  reviewDecision?: "approve" | "request_changes" | "uncertain";
}

export interface TeamAgentRunner {
  run(request: FakeAgentSessionRequest): FakeAgentSessionResult | Promise<FakeAgentSessionResult>;
}

/** Deterministic executor substitute. It never calls a model or touches a workspace. */
export class FakeAgentRunner implements TeamAgentRunner {
  async run(request: FakeAgentSessionRequest): Promise<FakeAgentSessionResult> {
    const agentRunId = `agent:${request.teamRunId}:${request.role}:${request.reviewRound}`;
    const threadId = `fake:${request.teamRunId}:${request.role}:${request.reviewRound}`;
    const turnId = `turn:${request.teamRunId}:${request.role}:${request.reviewRound}`;
    const event = (
      type: TeamProcessEvent["type"],
      message: string,
      details?: TeamProcessEvent["details"],
    ): TeamProcessEvent =>
      TeamProcessEventSchema.parse({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        id: `team-event:${request.teamRunId}:${request.eventIndex + events.length + 1}`,
        teamRunId: request.teamRunId,
        agentRunId,
        role: request.role,
        type,
        occurredAt: request.now,
        message,
        ...(details ? { details } : {}),
      });
    const events: TeamProcessEvent[] = [];
    events.push(
      event("session_started", `${request.role} Fake session started`, {
        provider: "fake",
        threadId,
        turnId,
      }),
      event("progress_summary", `${request.role} produced a deterministic result`),
    );

    if (request.role === "planner") {
      events.push(event("assistant_message", "Plan: implement the requested vertical slice."));
    } else if (request.role === "implementer") {
      events.push(
        event("tool_call", "Fake tool call: inspect the requested scope", { tool: "inspect" }),
        event("command_started", "Fake command started: pnpm check", { command: "pnpm check" }),
        event("command_completed", "Fake command completed: pnpm check", { exitCode: 0 }),
        event("file_change_summary", "Fake change summary: Runtime, contracts, and Web", {
          files: ["src/contracts", "src/runtime", "src/web"],
        }),
      );
    } else {
      const reviewDecision = request.scenario.reviewDecisions[request.reviewRound] ?? "approve";
      events.push(
        event("assistant_message", `Reviewer decision: ${reviewDecision}`, { reviewDecision }),
      );
    }

    events.push(event("session_completed", `${request.role} Fake session completed`));
    const agentRun = AgentRunSnapshotSchema.parse({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      id: agentRunId,
      teamRunId: request.teamRunId,
      role: request.role,
      access: request.role === "implementer" ? "exclusive_write" : "read_only",
      status: "completed",
      providerSession: { provider: "fake", threadId, lastTurnId: turnId },
      inputVersion: `fake-input:${request.teamRunId}:${request.role}:${request.reviewRound}`,
      reviewRound: request.reviewRound,
      startedAt: request.now,
      updatedAt: request.now,
      finishedAt: request.now,
    });
    return {
      agentRun,
      events,
      ...(request.role === "reviewer"
        ? { reviewDecision: request.scenario.reviewDecisions[request.reviewRound] ?? "approve" }
        : {}),
    };
  }
}
