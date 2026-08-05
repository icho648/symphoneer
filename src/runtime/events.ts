import type { DomainEventEnvelope } from "@symphoneer/contracts";

export const KNOWN_DOMAIN_EVENT_TYPES = [
  "task.upserted",
  "attempt.recorded",
  "attempt.turn_attached",
  "attempt.paused",
  "attempt.resumed",
  "attempt.finished",
  "workspace.recorded",
  "workspace.retained",
  "workspace.released",
  "verification.recorded",
  "review.decided",
  "intervention.requested",
  "intervention.resolved",
  "runtime.command.requested",
] as const;

export type DomainEventType = (typeof KNOWN_DOMAIN_EVENT_TYPES)[number];

export const isKnownDomainEventType = (type: string): type is DomainEventType =>
  (KNOWN_DOMAIN_EVENT_TYPES as readonly string[]).includes(type);

export const eventPayload = (event: DomainEventEnvelope): Record<string, unknown> =>
  event.payload as Record<string, unknown>;
