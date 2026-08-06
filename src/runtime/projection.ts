import {
  type AgentRunSnapshot,
  AgentRunSnapshotSchema,
  type AttemptSnapshot,
  AttemptSnapshotSchema,
  InterventionSchema,
  ReviewDecisionSchema,
  type RuntimeAttemptDetail,
  RuntimeAttemptDetailSchema,
  type RuntimeConnection,
  type RuntimeEvent,
  type RuntimeSnapshot,
  RuntimeSnapshotSchema,
  TaskSummarySchema,
  type TeamProcessEvent,
  TeamProcessEventSchema,
  type TeamRunSnapshot,
  TeamRunSnapshotSchema,
  VerificationResultSchema,
  type WorkspaceReference,
  WorkspaceReferenceSchema,
} from "@symphoneer/contracts";
import { RuntimeError } from "./errors.ts";
import { eventPayload } from "./events.ts";

const payloadValue = (event: RuntimeEvent, key: string): unknown => {
  const value = eventPayload(event.event)[key];
  if (value === undefined) {
    throw new RuntimeError("corrupt_event", `Domain event ${event.event.id} misses ${key}`);
  }
  return value;
};

export class RuntimeProjection {
  readonly #tasks = new Map<string, ReturnType<typeof TaskSummarySchema.parse>>();
  readonly #attempts = new Map<string, AttemptSnapshot>();
  readonly #workspaces = new Map<string, WorkspaceReference>();
  readonly #verifications = new Map<string, ReturnType<typeof VerificationResultSchema.parse>>();
  readonly #reviews = new Map<string, ReturnType<typeof ReviewDecisionSchema.parse>>();
  readonly #interventions = new Map<string, ReturnType<typeof InterventionSchema.parse>>();
  readonly #teamRuns = new Map<string, TeamRunSnapshot>();
  readonly #agentRuns = new Map<string, AgentRunSnapshot>();
  readonly #teamEvents = new Map<string, TeamProcessEvent>();

  apply(stored: RuntimeEvent): void {
    const event = stored.event;
    switch (event.type) {
      case "task.upserted": {
        const task = TaskSummarySchema.parse(payloadValue(stored, "task"));
        this.#tasks.set(task.id, task);
        break;
      }
      case "attempt.recorded":
      case "attempt.turn_attached":
      case "attempt.paused":
      case "attempt.resumed":
      case "attempt.finished": {
        const attempt = AttemptSnapshotSchema.parse(payloadValue(stored, "attempt"));
        this.#attempts.set(attempt.id, attempt);
        const workspace = eventPayload(event).workspace;
        if (workspace !== undefined) this.#saveWorkspace(workspace);
        break;
      }
      case "workspace.recorded":
      case "workspace.retained":
      case "workspace.released":
        this.#saveWorkspace(payloadValue(stored, "workspace"));
        break;
      case "verification.recorded": {
        const verification = VerificationResultSchema.parse(payloadValue(stored, "verification"));
        this.#verifications.set(verification.id, verification);
        break;
      }
      case "review.decided": {
        const review = ReviewDecisionSchema.parse(payloadValue(stored, "review"));
        this.#reviews.set(review.id, review);
        break;
      }
      case "intervention.requested":
      case "intervention.resolved": {
        const intervention = InterventionSchema.parse(payloadValue(stored, "intervention"));
        this.#interventions.set(intervention.id, intervention);
        break;
      }
      case "team.run.created":
      case "team.run.updated": {
        const teamRun = TeamRunSnapshotSchema.parse(payloadValue(stored, "teamRun"));
        this.#teamRuns.set(teamRun.id, teamRun);
        const agents = eventPayload(event).agentRuns;
        if (agents !== undefined) {
          for (const agent of zodArray(agents, AgentRunSnapshotSchema)) {
            this.#agentRuns.set(agent.id, agent);
          }
        }
        const processEvents = eventPayload(event).events;
        if (processEvents !== undefined) {
          for (const processEvent of zodArray(processEvents, TeamProcessEventSchema)) {
            this.#teamEvents.set(processEvent.id, processEvent);
          }
        }
        break;
      }
      case "team.agent.updated": {
        const agent = AgentRunSnapshotSchema.parse(payloadValue(stored, "agentRun"));
        this.#agentRuns.set(agent.id, agent);
        break;
      }
      case "team.process.event": {
        const processEvent = TeamProcessEventSchema.parse(payloadValue(stored, "event"));
        this.#teamEvents.set(processEvent.id, processEvent);
        break;
      }
      case "team.run.reset": {
        const teamRunId = payloadValue(stored, "teamRunId");
        if (typeof teamRunId !== "string") {
          throw new RuntimeError("corrupt_event", "Team reset event has no TeamRun ID");
        }
        this.#teamRuns.delete(teamRunId);
        for (const [agentId, agent] of this.#agentRuns) {
          if (agent.teamRunId === teamRunId) this.#agentRuns.delete(agentId);
        }
        for (const [eventId, processEvent] of this.#teamEvents) {
          if (processEvent.teamRunId === teamRunId) this.#teamEvents.delete(eventId);
        }
        break;
      }
      case "runtime.command.requested":
        break;
      default:
        throw new RuntimeError("unknown_event", `Unhandled domain event: ${event.type}`);
    }
  }

  snapshot(runtime: RuntimeConnection): RuntimeSnapshot {
    return RuntimeSnapshotSchema.parse({
      schemaVersion: runtime.schemaVersion,
      projectionVersion: 1,
      runtime,
      tasks: [...this.#tasks.values()].sort((a, b) => a.identifier.localeCompare(b.identifier)),
      attempts: [...this.#attempts.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
      verifications: [...this.#verifications.values()].sort((a, b) =>
        b.startedAt.localeCompare(a.startedAt),
      ),
      reviews: [...this.#reviews.values()].sort((a, b) => b.decidedAt.localeCompare(a.decidedAt)),
      interventions: [...this.#interventions.values()].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
      teamRuns: [...this.#teamRuns.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      agentRuns: [...this.#agentRuns.values()].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
      teamEvents: [...this.#teamEvents.values()].sort((a, b) =>
        a.occurredAt.localeCompare(b.occurredAt),
      ),
    });
  }

  attemptDetail(attemptId: string): RuntimeAttemptDetail | null {
    const attempt = this.#attempts.get(attemptId);
    if (!attempt) return null;
    return RuntimeAttemptDetailSchema.parse({
      schemaVersion: attempt.schemaVersion,
      attempt,
      workspace:
        [...this.#workspaces.values()].find((workspace) => workspace.id === attempt.workspaceId) ??
        null,
      verifications: [...this.#verifications.values()].filter(
        (verification) => verification.attemptId === attempt.id,
      ),
      reviews: [...this.#reviews.values()].filter((review) => review.attemptId === attempt.id),
      interventions: [...this.#interventions.values()].filter(
        (intervention) => intervention.attemptId === attempt.id,
      ),
      teamRuns: [...this.#teamRuns.values()].filter((teamRun) => teamRun.attemptId === attempt.id),
      agentRuns: [...this.#agentRuns.values()].filter((agent) =>
        [...this.#teamRuns.values()]
          .filter((teamRun) => teamRun.attemptId === attempt.id)
          .some((teamRun) => teamRun.id === agent.teamRunId),
      ),
      teamEvents: [...this.#teamEvents.values()].filter((event) =>
        [...this.#teamRuns.values()]
          .filter((teamRun) => teamRun.attemptId === attempt.id)
          .some((teamRun) => teamRun.id === event.teamRunId),
      ),
    });
  }

  getAttempt(attemptId: string): AttemptSnapshot | undefined {
    return this.#attempts.get(attemptId);
  }

  getTask(taskId: string) {
    return this.#tasks.get(taskId);
  }

  getTeamRun(teamRunId: string): TeamRunSnapshot | undefined {
    return this.#teamRuns.get(teamRunId);
  }

  getIntervention(interventionId: string) {
    return this.#interventions.get(interventionId);
  }

  #saveWorkspace(value: unknown): void {
    const workspace = WorkspaceReferenceSchema.parse(value);
    this.#workspaces.set(workspace.id, workspace);
  }
}

function zodArray<T>(value: unknown, schema: { parse(value: unknown): T }): T[] {
  if (!Array.isArray(value)) throw new RuntimeError("corrupt_event", "Team event list is invalid");
  return value.map((item) => schema.parse(item));
}
