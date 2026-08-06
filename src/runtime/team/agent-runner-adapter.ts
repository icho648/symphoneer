import {
  AgentRunSnapshotSchema,
  CONTRACT_SCHEMA_VERSION,
  type TeamProcessEvent,
  TeamProcessEventSchema,
} from "@symphoneer/contracts";
import type { AgentRunEvent, AgentRunner } from "../executor/agent-runner.ts";
import type {
  FakeAgentSessionRequest,
  FakeAgentSessionResult,
  TeamAgentRunner,
} from "./fake-agent-runner.ts";

/** Bridges the existing Codex/Fake AgentRunner contract into a workflow executor node. */
export class AgentRunnerTeamAdapter implements TeamAgentRunner {
  readonly #runner: AgentRunner;

  constructor(runner: AgentRunner) {
    this.#runner = runner;
  }

  async run(request: FakeAgentSessionRequest): Promise<FakeAgentSessionResult> {
    const handle = await this.#runner.startOrContinue({
      attemptId: request.attemptId,
      task: request.task,
      workspace: request.workspace,
      prompt: request.prompt,
      continuation: request.continuation,
      ...(request.threadId ? { threadId: request.threadId } : {}),
    });
    const sourceEvents: AgentRunEvent[] = [];
    for await (const event of handle.events) sourceEvents.push(event);
    const completion = await handle.completion;
    const session = sourceEvents.find(
      (event): event is Extract<AgentRunEvent, { type: "session_started" }> =>
        event.type === "session_started",
    );
    const agentRunId = `agent:${request.teamRunId}:${request.role}:${request.reviewRound}`;
    const events = sourceEvents.map((event, index) =>
      processEvent(request, agentRunId, event, index),
    );
    const terminalType =
      completion.outcome === "completed"
        ? "session_completed"
        : completion.outcome === "interrupted"
          ? "session_interrupted"
          : "session_failed";
    events.push(
      TeamProcessEventSchema.parse({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        id: `workflow-event:${request.teamRunId}:${request.eventIndex + events.length + 1}`,
        teamRunId: request.teamRunId,
        agentRunId,
        role: request.role,
        type: terminalType,
        occurredAt: request.now,
        message: `Agent ${completion.outcome}`,
        ...(completion.error ? { details: { error: completion.error } } : {}),
      }),
    );
    const status = completion.outcome === "completed" ? "completed" : completion.outcome;
    const agentRun = AgentRunSnapshotSchema.parse({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      id: agentRunId,
      teamRunId: request.teamRunId,
      role: request.role,
      access: request.role === "implementer" ? "exclusive_write" : "read_only",
      status,
      providerSession: session
        ? {
            provider: session.provider.name,
            threadId: session.threadId,
            lastTurnId: session.turnId,
          }
        : null,
      inputVersion: session?.provider.inputFingerprint ?? `workflow-input:${request.teamRunId}`,
      reviewRound: request.reviewRound,
      startedAt: session?.occurredAt ?? request.now,
      updatedAt: request.now,
      finishedAt: request.now,
    });
    const reviewDecision = events
      .map((event) => event.details?.reviewDecision)
      .find(
        (value): value is "approve" | "request_changes" | "uncertain" =>
          value === "approve" || value === "request_changes" || value === "uncertain",
      );
    return {
      agentRun,
      events,
      ...(reviewDecision ? { reviewDecision } : {}),
    };
  }
}

function processEvent(
  request: FakeAgentSessionRequest,
  agentRunId: string,
  event: AgentRunEvent,
  index: number,
): TeamProcessEvent {
  const mapped =
    event.type === "session_started"
      ? {
          type: "session_started" as const,
          message: "Agent session started",
          details: {
            provider: event.provider.name,
            version: event.provider.version,
            threadId: event.threadId,
            turnId: event.turnId,
          },
        }
      : event.type === "intervention_requested"
        ? {
            type: "intervention_requested" as const,
            message: event.prompt,
            details: { requestRef: event.requestRef, kind: event.kind },
          }
        : {
            type: "progress_summary" as const,
            message: event.message,
          };
  return TeamProcessEventSchema.parse({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: `workflow-event:${request.teamRunId}:${request.eventIndex + index + 1}`,
    teamRunId: request.teamRunId,
    agentRunId,
    role: request.role,
    type: mapped.type,
    occurredAt: event.occurredAt,
    message: mapped.message,
    ...(mapped.details ? { details: mapped.details } : {}),
  });
}
