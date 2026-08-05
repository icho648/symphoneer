import {
  CONTRACT_SCHEMA_VERSION,
  type DomainEventEnvelope,
  DomainEventEnvelopeSchema,
  type RuntimeEvent,
} from "@symphoneer/contracts";
import { RuntimeError } from "../errors.ts";
import type { DomainEventType } from "../events.ts";
import { RuntimeProjection } from "../projection.ts";
import { ImmutableArtifactStore, JsonlEventStore } from "../storage.ts";
import { asJsonPayload } from "./helpers.ts";

type EventSource = DomainEventEnvelope["source"];

export interface EventLogOptions {
  dataDir: string;
  now: () => Date;
  idFactory: () => string;
  eventStore?: JsonlEventStore;
  artifactStore?: ImmutableArtifactStore;
}

/** Owns append-only replay, idempotency window, projection apply, and listener fan-out. */
export class EventLog {
  readonly events: JsonlEventStore;
  readonly artifacts: ImmutableArtifactStore;
  readonly projection = new RuntimeProjection();
  readonly #now: () => Date;
  readonly #idFactory: () => string;
  readonly #listeners = new Set<(event: RuntimeEvent) => void>();
  readonly #idempotency = new Map<string, RuntimeEvent>();
  #storedEvents: RuntimeEvent[] = [];
  #started = false;

  constructor(options: EventLogOptions) {
    this.events = options.eventStore ?? new JsonlEventStore(options.dataDir);
    this.artifacts = options.artifactStore ?? new ImmutableArtifactStore(options.dataDir);
    this.#now = options.now;
    this.#idFactory = options.idFactory;
  }

  get started(): boolean {
    return this.#started;
  }

  get storedEvents(): readonly RuntimeEvent[] {
    return this.#storedEvents;
  }

  get lastSequence(): number {
    return this.#storedEvents.length;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#storedEvents = await this.events.replay();
    for (const event of this.#storedEvents) {
      this.projection.apply(event);
      if (event.event.idempotencyKey) this.#idempotency.set(event.event.idempotencyKey, event);
    }
    this.#started = true;
  }

  markOffline(): void {
    this.#started = false;
  }

  requireStarted(): void {
    if (!this.#started) throw new RuntimeError("conflict", "Runtime has not started");
  }

  idempotent(key: string): RuntimeEvent | undefined {
    return this.#idempotency.get(key);
  }

  remember(key: string, event: RuntimeEvent): void {
    this.#idempotency.set(key, event);
  }

  listAfter(afterSequence: number): RuntimeEvent[] {
    this.requireStarted();
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new RuntimeError("invalid_request", "Event sequence must be a non-negative integer");
    }
    return this.#storedEvents.filter((event) => event.sequence > afterSequence);
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.requireStarted();
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async append(input: {
    type: DomainEventType;
    source: EventSource;
    aggregate: DomainEventEnvelope["aggregate"];
    taskId?: string;
    attemptId?: string;
    idempotencyKey?: string;
    payload: unknown;
  }): Promise<RuntimeEvent> {
    this.requireStarted();
    const existing = input.idempotencyKey ? this.#idempotency.get(input.idempotencyKey) : undefined;
    if (existing) {
      if (existing.event.type !== input.type) {
        throw new RuntimeError("conflict", "Idempotency key belongs to another event");
      }
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
    const stored = await this.events.append(event);
    this.projection.apply(stored);
    this.#storedEvents.push(stored);
    if (event.idempotencyKey) this.#idempotency.set(event.idempotencyKey, stored);
    for (const listener of this.#listeners) listener(stored);
    return stored;
  }
}
