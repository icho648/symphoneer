import { z } from "zod";

import { CONTRACT_SCHEMA_VERSION, JsonValueSchema, NonEmptyString, Timestamp } from "./shared.ts";

export const DomainEventEnvelopeSchema = z.object({
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  id: NonEmptyString,
  type: NonEmptyString,
  source: z.enum(["symphony-core", "runtime", "adapter", "human"]),
  occurredAt: Timestamp,
  aggregate: z.object({
    kind: z.enum(["task", "attempt", "workspace", "verification", "review", "intervention"]),
    id: NonEmptyString,
  }),
  taskId: NonEmptyString.optional(),
  attemptId: NonEmptyString.optional(),
  idempotencyKey: NonEmptyString.optional(),
  payload: z.record(z.string(), JsonValueSchema),
});

export type DomainEventEnvelope = z.infer<typeof DomainEventEnvelopeSchema>;

export const ApiErrorSchema = z.object({
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  code: NonEmptyString,
  message: NonEmptyString,
  retryable: z.boolean(),
  details: z.record(z.string(), JsonValueSchema).optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;
