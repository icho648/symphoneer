import { randomUUID } from "node:crypto";

import {
  type AttemptSnapshot,
  AttemptSnapshotSchema,
  CONTRACT_SCHEMA_VERSION,
  type DomainEventEnvelope,
  DomainEventEnvelopeSchema,
  type Intervention,
  InterventionSchema,
  type ReviewDecision,
  ReviewDecisionSchema,
  type RuntimeCommand,
  type RuntimeCommandResult,
  RuntimeCommandResultSchema,
  RuntimeCommandSchema,
  type RuntimeConnection,
  RuntimeConnectionSchema,
  type RuntimeEvent,
  type RuntimeHealth,
  RuntimeHealthSchema,
  type RuntimeSnapshot,
  type TaskSummary,
  TaskSummarySchema,
  type VerificationResult,
  VerificationResultSchema,
  type WorkspaceReference,
  WorkspaceReferenceSchema,
} from "@symphoneer/contracts";
import { RuntimeError } from "./errors.ts";
import type { DomainEventType } from "./events.ts";
import { eventPayload } from "./events.ts";
import { RuntimeProjection } from "./projection.ts";
import { ImmutableArtifactStore, JsonlEventStore } from "./storage.ts";

type EventSource = DomainEventEnvelope["source"];

export interface RuntimeServiceOptions {
  dataDir: string;
  endpoint?: string;
  runtimeId?: string;
  now?: () => Date;
  idFactory?: () => string;
  eventStore?: JsonlEventStore;
  artifactStore?: ImmutableArtifactStore;
}

export class RuntimeService {
  readonly #events: JsonlEventStore;
  readonly #artifacts: ImmutableArtifactStore;
  readonly #projection = new RuntimeProjection();
  readonly #now: () => Date;
  readonly #idFactory: () => string;
  readonly #runtimeId: string;
  readonly #startedAt: string;
  readonly #listeners = new Set<(event: RuntimeEvent) => void>();
  readonly #idempotency = new Map<string, RuntimeEvent>();
  #storedEvents: RuntimeEvent[] = [];
  #endpoint: string;
  #started = false;
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(options: RuntimeServiceOptions) {
    this.#events = options.eventStore ?? new JsonlEventStore(options.dataDir);
    this.#artifacts = options.artifactStore ?? new ImmutableArtifactStore(options.dataDir);
    this.#now = options.now ?? (() => new Date());
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#runtimeId = options.runtimeId?.trim() || `runtime:${this.#idFactory()}`;
    this.#startedAt = this.#now().toISOString();
    this.#endpoint = options.endpoint ?? "http://127.0.0.1:0";
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#storedEvents = await this.#events.replay();
    for (const event of this.#storedEvents) {
      this.#projection.apply(event);
      if (event.event.idempotencyKey) this.#idempotency.set(event.event.idempotencyKey, event);
    }
    this.#started = true;
  }

  setEndpoint(endpoint: string): void {
    this.#endpoint = endpoint;
  }

  markOffline(): void {
    this.#started = false;
  }

  snapshot(): RuntimeSnapshot {
    this.#requireStarted();
    return this.#projection.snapshot(this.#connection("online"));
  }

  health(): RuntimeHealth {
    this.#requireStarted();
    return RuntimeHealthSchema.parse({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      status: "ok",
      runtime: this.#connection("online"),
      process: {
        status: "running",
        pid: process.pid,
        nodeVersion: process.version,
        startedAt: this.#startedAt,
        uptimeSeconds: process.uptime(),
      },
    });
  }

  events(afterSequence = 0): RuntimeEvent[] {
    this.#requireStarted();
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new RuntimeError("invalid_request", "Event sequence must be a non-negative integer");
    }
    return this.#storedEvents.filter((event) => event.sequence > afterSequence);
  }

  attemptDetail(attemptId: string) {
    this.#requireStarted();
    return this.#projection.attemptDetail(attemptId.trim());
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.#requireStarted();
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async recordTask(taskInput: TaskSummary, idempotencyKey?: string): Promise<RuntimeEvent> {
    const task = TaskSummarySchema.parse(taskInput);
    return this.#append({
      type: "task.upserted",
      source: "adapter",
      aggregate: { kind: "task", id: task.id },
      taskId: task.id,
      payload: { task },
      idempotencyKey: idempotencyKey ?? `task:${task.id}:${task.updatedAt ?? ""}`,
    });
  }

  async recordAttempt(
    attemptInput: AttemptSnapshot,
    options: { workspace?: WorkspaceReference; idempotencyKey?: string } = {},
  ): Promise<RuntimeEvent> {
    const attempt = AttemptSnapshotSchema.parse(attemptInput);
    const workspace = options.workspace
      ? WorkspaceReferenceSchema.parse(options.workspace)
      : undefined;
    return this.#append({
      type: attemptEventType(attempt),
      source: "symphony-core",
      aggregate: { kind: "attempt", id: attempt.id },
      taskId: attempt.taskId,
      attemptId: attempt.id,
      payload: { attempt, ...(workspace ? { workspace } : {}) },
      idempotencyKey: options.idempotencyKey ?? `attempt:${attempt.id}:${attempt.updatedAt}`,
    });
  }

  async recordWorkspace(
    workspaceInput: WorkspaceReference,
    idempotencyKey?: string,
  ): Promise<RuntimeEvent> {
    const workspace = WorkspaceReferenceSchema.parse(workspaceInput);
    return this.#append({
      type: workspaceEventType(workspace),
      source: "symphony-core",
      aggregate: { kind: "workspace", id: workspace.id },
      taskId: workspace.taskId,
      ...(workspace.ownerAttemptId ? { attemptId: workspace.ownerAttemptId } : {}),
      payload: { workspace },
      idempotencyKey: idempotencyKey ?? `workspace:${workspace.id}:${workspace.state}`,
    });
  }

  async recordVerification(
    verificationInput: VerificationResult,
    options: { artifact?: string | Uint8Array; idempotencyKey?: string } = {},
  ): Promise<RuntimeEvent> {
    let verification = VerificationResultSchema.parse(
      options.artifact !== undefined && verificationInput.artifactRef === null
        ? { ...verificationInput, artifactRef: "pending-artifact" }
        : verificationInput,
    );
    if (options.artifact !== undefined) {
      const artifactRef = await this.#artifacts.put(options.artifact);
      verification = VerificationResultSchema.parse({ ...verification, artifactRef });
    }
    return this.#append({
      type: "verification.recorded",
      source: "symphony-core",
      aggregate: { kind: "verification", id: verification.id },
      attemptId: verification.attemptId,
      payload: { verification },
      idempotencyKey:
        options.idempotencyKey ??
        `verification:${verification.id}:${verification.inputFingerprint}`,
    });
  }

  async recordReview(reviewInput: ReviewDecision, idempotencyKey?: string): Promise<RuntimeEvent> {
    const review = ReviewDecisionSchema.parse(reviewInput);
    return this.#append({
      type: "review.decided",
      source: "human",
      aggregate: { kind: "review", id: review.id },
      attemptId: review.attemptId,
      payload: { review },
      idempotencyKey: idempotencyKey ?? `review:${review.id}`,
    });
  }

  async recordIntervention(
    interventionInput: Intervention,
    idempotencyKey?: string,
  ): Promise<RuntimeEvent> {
    const intervention = InterventionSchema.parse(interventionInput);
    return this.#append({
      type: intervention.state === "pending" ? "intervention.requested" : "intervention.resolved",
      source: "adapter",
      aggregate: { kind: "intervention", id: intervention.id },
      attemptId: intervention.attemptId,
      payload: { intervention },
      idempotencyKey: idempotencyKey ?? `intervention:${intervention.id}:${intervention.state}`,
    });
  }

  async execute(commandInput: unknown): Promise<RuntimeCommandResult> {
    this.#requireStarted();
    const parsed = RuntimeCommandSchema.safeParse(commandInput);
    if (!parsed.success) {
      throw new RuntimeError("invalid_request", "Runtime command has an invalid shape");
    }
    const command = parsed.data;
    return this.#withMutation(async () => {
      const previous = this.#idempotency.get(command.idempotencyKey);
      if (previous) {
        if (!isCommandEvent(previous, command.kind)) {
          throw new RuntimeError("conflict", "Idempotency key belongs to another operation");
        }
        return this.#commandResult(previous.sequence, commandMessage(command), this.snapshot());
      }
      if (
        command.expectedEventSequence !== undefined &&
        command.expectedEventSequence !== this.#storedEvents.length
      ) {
        throw new RuntimeError(
          "conflict",
          "Runtime projection changed before this command was read",
        );
      }

      let stored: RuntimeEvent;
      if (command.kind === "respond_intervention") {
        stored = await this.#respondToIntervention(command);
      } else {
        const attempt = this.#projection.getAttempt(command.attemptId);
        if (!attempt)
          throw new RuntimeError("not_found", `Attempt ${command.attemptId} was not found`);
        if (
          command.expectedAttemptUpdatedAt &&
          attempt.updatedAt !== command.expectedAttemptUpdatedAt
        ) {
          throw new RuntimeError("conflict", "Attempt changed before this command was read");
        }
        if (
          command.kind !== "retry_attempt" &&
          attempt.finishedAt !== undefined &&
          attempt.finishedAt !== null
        ) {
          throw new RuntimeError("conflict", "Terminal Attempts cannot receive this command");
        }
        stored = await this.#commitEvent({
          type: "runtime.command.requested",
          source: "human",
          aggregate: { kind: "attempt", id: attempt.id },
          taskId: attempt.taskId,
          attemptId: attempt.id,
          idempotencyKey: command.idempotencyKey,
          payload: {
            commandKind: command.kind,
            attemptId: attempt.id,
            taskId: attempt.taskId,
          },
        });
      }
      return this.#commandResult(stored.sequence, commandMessage(command), this.snapshot());
    });
  }

  async #respondToIntervention(
    command: Extract<RuntimeCommand, { kind: "respond_intervention" }>,
  ): Promise<RuntimeEvent> {
    const current = this.#projection.getIntervention(command.interventionId);
    if (!current) {
      throw new RuntimeError("not_found", `Intervention ${command.interventionId} was not found`);
    }
    if (current.state !== "pending") {
      throw new RuntimeError("conflict", "Intervention is already resolved");
    }
    const intervention =
      command.decision === "canceled"
        ? InterventionSchema.parse({ ...current, state: "canceled" })
        : InterventionSchema.parse({
            ...current,
            state: "resolved",
            resolution: {
              decidedBy: command.decidedBy,
              decidedAt: this.#now().toISOString(),
              decision: command.decision,
            },
          });
    return this.#commitEvent({
      type: "intervention.resolved",
      source: "human",
      aggregate: { kind: "intervention", id: intervention.id },
      attemptId: intervention.attemptId,
      idempotencyKey: command.idempotencyKey,
      payload: {
        commandKind: command.kind,
        intervention,
      },
    });
  }

  async #append(input: {
    type: DomainEventType;
    source: EventSource;
    aggregate: DomainEventEnvelope["aggregate"];
    taskId?: string;
    attemptId?: string;
    idempotencyKey?: string;
    payload: unknown;
  }): Promise<RuntimeEvent> {
    return this.#withMutation(() => this.#commitEvent(input));
  }

  async #commitEvent(input: {
    type: DomainEventType;
    source: EventSource;
    aggregate: DomainEventEnvelope["aggregate"];
    taskId?: string;
    attemptId?: string;
    idempotencyKey?: string;
    payload: unknown;
  }): Promise<RuntimeEvent> {
    this.#requireStarted();
    const existing = input.idempotencyKey ? this.#idempotency.get(input.idempotencyKey) : undefined;
    if (existing) {
      const sameType = existing.event.type === input.type;
      if (!sameType) throw new RuntimeError("conflict", "Idempotency key belongs to another event");
      return existing;
    }
    const event = DomainEventEnvelopeSchema.parse({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      id: this.#idFactory(),
      type: input.type,
      source: input.source,
      occurredAt: this.#now().toISOString(),
      aggregate: input.aggregate,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.attemptId ? { attemptId: input.attemptId } : {}),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      payload: asJsonPayload(input.payload),
    });
    const stored = await this.#events.append(event);
    this.#projection.apply(stored);
    this.#storedEvents.push(stored);
    if (event.idempotencyKey) this.#idempotency.set(event.idempotencyKey, stored);
    for (const listener of this.#listeners) listener(stored);
    return stored;
  }

  #withMutation<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#mutationTail.then(fn, fn);
    this.#mutationTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  #connection(status: RuntimeConnection["status"]): RuntimeConnection {
    return RuntimeConnectionSchema.parse({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      status,
      runtimeId: this.#runtimeId,
      endpoint: this.#endpoint,
      startedAt: this.#startedAt,
      lastEventSequence: this.#storedEvents.length,
    });
  }

  #commandResult(
    eventSequence: number,
    message: string,
    snapshot: RuntimeSnapshot,
  ): RuntimeCommandResult {
    return RuntimeCommandResultSchema.parse({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      accepted: true,
      eventSequence,
      message,
      snapshot,
    });
  }

  #requireStarted(): void {
    if (!this.#started) throw new RuntimeError("conflict", "Runtime has not started");
  }
}

function attemptEventType(attempt: AttemptSnapshot): Extract<DomainEventType, `attempt.${string}`> {
  if (attempt.status === "paused") return "attempt.paused";
  if (attempt.finishedAt !== undefined && attempt.finishedAt !== null) return "attempt.finished";
  if (attempt.activeTurn !== undefined && attempt.activeTurn !== null)
    return "attempt.turn_attached";
  return "attempt.recorded";
}

function workspaceEventType(
  workspace: WorkspaceReference,
): Extract<DomainEventType, `workspace.${string}`> {
  if (workspace.state === "retained") return "workspace.retained";
  if (workspace.state === "released") return "workspace.released";
  return "workspace.recorded";
}

function commandMessage(command: RuntimeCommand): string {
  if (command.kind === "pause_attempt") {
    return "Pause requested; the Runtime coordinator must interrupt the active Provider before recording a paused Attempt.";
  }
  if (command.kind === "retry_attempt") {
    return "Retry requested; the Runtime coordinator will decide the next Attempt from current state.";
  }
  return "Intervention decision recorded without persisting the response text.";
}

function isCommandEvent(event: RuntimeEvent, kind: RuntimeCommand["kind"]): boolean {
  const payload = eventPayload(event.event);
  return payload.commandKind === kind;
}

function asJsonPayload(value: unknown): DomainEventEnvelope["payload"] {
  return JSON.parse(JSON.stringify(value)) as DomainEventEnvelope["payload"];
}
