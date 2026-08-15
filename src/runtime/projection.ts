import {
  type AgentRunSnapshot,
  AgentRunSnapshotSchema,
  type AttemptSnapshot,
  AttemptSnapshotSchema,
  BlockedTaskSchema,
  type ExecutionActivity,
  ExecutionActivitySchema,
  type ExecutionSession,
  ExecutionSessionSchema,
  InterventionSchema,
  ReviewDecisionSchema,
  type RuntimeAttemptDetail,
  RuntimeAttemptDetailSchema,
  type RuntimeConnection,
  type RuntimeEvent,
  type RuntimeSnapshot,
  RuntimeSnapshotSchema,
  type TaskSummary,
  TaskSummarySchema,
  type TeamProcessEvent,
  TeamProcessEventSchema,
  type TeamRunSnapshot,
  TeamRunSnapshotSchema,
  VerificationResultSchema,
  WorkflowStatusSchema,
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

const currentWorkflowStatus = (value: unknown): unknown => (value === "ready" ? "backlog" : value);

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
  readonly #activities = new Map<string, ExecutionActivity>();
  readonly #sessions = new Map<string, ExecutionSession>();

  apply(stored: RuntimeEvent): void {
    const event = stored.event;
    switch (event.type) {
      case "task.upserted": {
        const task = TaskSummarySchema.parse(payloadValue(stored, "task"));
        const existing = this.#tasks.get(task.id);
        this.#tasks.set(
          task.id,
          TaskSummarySchema.parse(
            existing
              ? { ...task, workflowStatus: existing.workflowStatus, blocked: existing.blocked }
              : task,
          ),
        );
        break;
      }
      case "task.status.changed": {
        const taskId = event.taskId;
        if (!taskId) throw new RuntimeError("corrupt_event", "Task status event misses taskId");
        const task = this.#tasks.get(taskId);
        if (!task) throw new RuntimeError("not_found", `Task ${taskId} was not found`);
        this.#tasks.set(
          taskId,
          TaskSummarySchema.parse({
            ...task,
            workflowStatus: WorkflowStatusSchema.parse(
              currentWorkflowStatus(payloadValue(stored, "workflowStatus")),
            ),
            blocked: BlockedTaskSchema.nullable().parse(payloadValue(stored, "blocked")),
          }),
        );
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
      case "attempt.activity.recorded": {
        const activity = ExecutionActivitySchema.parse(payloadValue(stored, "activity"));
        this.#activities.set(activity.id, activity);
        break;
      }
      case "attempt.session.recorded": {
        const session = ExecutionSessionSchema.parse(payloadValue(stored, "session"));
        this.#sessions.set(session.attemptId, session);
        break;
      }
      case "attempt.deleted": {
        const attemptId = payloadValue(stored, "attemptId");
        if (typeof attemptId !== "string") {
          throw new RuntimeError("corrupt_event", "Attempt deletion event misses attemptId");
        }
        this.#attempts.delete(attemptId);
        this.#sessions.delete(attemptId);
        for (const [id, activity] of this.#activities) {
          if (activity.attemptId === attemptId) this.#activities.delete(id);
        }
        for (const [id, verification] of this.#verifications) {
          if (verification.attemptId === attemptId) this.#verifications.delete(id);
        }
        for (const [id, review] of this.#reviews) {
          if (review.attemptId === attemptId) this.#reviews.delete(id);
        }
        for (const [id, intervention] of this.#interventions) {
          if (intervention.attemptId === attemptId) this.#interventions.delete(id);
        }
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
      activities: [...this.#activities.values()]
        .filter((activity) => activity.attemptId === attempt.id)
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
      session: this.#sessions.get(attempt.id) ?? null,
    });
  }

  getAttempt(attemptId: string): AttemptSnapshot | undefined {
    return this.#attempts.get(attemptId);
  }

  attemptsForTask(taskId: string): AttemptSnapshot[] {
    return [...this.#attempts.values()].filter((attempt) => attempt.taskId === taskId);
  }

  getTask(taskId: string) {
    return this.#tasks.get(taskId);
  }

  tasks(): TaskSummary[] {
    return [...this.#tasks.values()];
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
