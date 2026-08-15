import { z } from "zod";

import { CONTRACT_SCHEMA_VERSION, JsonValueSchema, NonEmptyString, Timestamp } from "./shared.ts";

export const ActivityPayloadSchema = z.object({
  kind: z.enum([
    "message",
    "plan",
    "reasoning",
    "command",
    "file_change",
    "tool",
    "web_search",
    "warning",
    "error",
  ]),
  status: z.enum(["info", "running", "completed", "failed", "declined", "interrupted"]),
  title: NonEmptyString,
  content: z.string().nullable(),
  details: z.record(z.string(), JsonValueSchema),
});

export type ActivityPayload = z.infer<typeof ActivityPayloadSchema>;

export const ActivityOccurrenceSchema = ActivityPayloadSchema.extend({
  itemId: NonEmptyString,
  occurredAt: Timestamp,
});

export type ActivityOccurrence = z.infer<typeof ActivityOccurrenceSchema>;

export const ExecutionActivitySchema = ActivityOccurrenceSchema.extend({
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  id: NonEmptyString,
  attemptId: NonEmptyString,
});

export type ExecutionActivity = z.infer<typeof ExecutionActivitySchema>;

export const ExecutionSessionItemSchema = z.object({
  id: NonEmptyString,
  type: NonEmptyString,
  status: z.string().nullable(),
  data: z.record(z.string(), JsonValueSchema),
});

export const ExecutionSessionTurnSchema = z.object({
  id: NonEmptyString,
  status: z.string().nullable(),
  items: z.array(ExecutionSessionItemSchema),
});

export const ExecutionSessionSchema = z.object({
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  attemptId: NonEmptyString,
  provider: z.enum(["codex-app-server", "claude-code", "fake"]),
  threadId: NonEmptyString,
  turns: z.array(ExecutionSessionTurnSchema),
  capturedAt: Timestamp,
});

export type ExecutionSession = z.infer<typeof ExecutionSessionSchema>;
