import { z } from "zod";

export const AssistantThinkingLevelSchema = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export const AssistantModelOptionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  thinkingLevels: z.array(AssistantThinkingLevelSchema).min(1),
});

export const AssistantStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("disabled"), reason: z.enum(["missing_config", "opt_out"]) }),
  z.object({
    state: z.literal("ready"),
    provider: z.string().min(1),
    model: z.string().min(1),
    thinkingLevel: AssistantThinkingLevelSchema,
    models: z.array(AssistantModelOptionSchema).min(1),
  }),
  z.object({ state: z.literal("provider_failure"), message: z.string().min(1) }),
  z.object({ state: z.literal("invalid_config"), message: z.string().min(1) }),
]);

export type AssistantStatus = z.infer<typeof AssistantStatusSchema>;

export const AssistantSessionMetadataSchema = z.object({
  projectId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  attemptId: z.string().min(1).optional(),
  locale: z.string().min(1).optional(),
  createdBy: z.enum(["web", "tui"]),
  schemaVersion: z.literal(1),
});

export const CreateAssistantSessionInputSchema = AssistantSessionMetadataSchema.omit({
  schemaVersion: true,
}).extend({
  name: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  thinkingLevel: AssistantThinkingLevelSchema.optional(),
});

export const AssistantSessionSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  createdAt: z.number().nonnegative(),
  updatedAt: z.number().nonnegative(),
  provider: z.string().min(1),
  model: z.string().min(1),
  thinkingLevel: AssistantThinkingLevelSchema,
  metadata: AssistantSessionMetadataSchema,
});

export const AssistantMessagePartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("tool_call"),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    input: z.unknown(),
  }),
  z.object({
    type: z.literal("tool_result"),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    result: z.unknown(),
    isError: z.boolean(),
  }),
]);

export const AssistantMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant", "tool"]),
  parts: z.array(AssistantMessagePartSchema),
  timestamp: z.number().nonnegative(),
});

export const AssistantSessionSchema = AssistantSessionSummarySchema.extend({
  messages: z.array(AssistantMessageSchema),
});

export const AssistantEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text_delta"), delta: z.string() }),
  z.object({
    type: z.literal("tool_started"),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    input: z.unknown(),
  }),
  z.object({
    type: z.literal("tool_updated"),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    update: z.unknown(),
  }),
  z.object({
    type: z.literal("tool_completed"),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    result: z.unknown(),
    isError: z.boolean(),
  }),
  z.object({
    type: z.literal("approval_required"),
    approvalId: z.string().min(1),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    input: z.unknown(),
  }),
  z.object({ type: z.literal("completed") }),
  z.object({ type: z.literal("aborted") }),
  z.object({ type: z.literal("error"), message: z.string().min(1), code: z.string().optional() }),
]);

export type AssistantSessionMetadata = z.infer<typeof AssistantSessionMetadataSchema>;
export type AssistantThinkingLevel = z.infer<typeof AssistantThinkingLevelSchema>;
export type AssistantModelOption = z.infer<typeof AssistantModelOptionSchema>;
export type CreateAssistantSessionInput = z.infer<typeof CreateAssistantSessionInputSchema>;
export type AssistantSessionSummary = z.infer<typeof AssistantSessionSummarySchema>;
export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;
export type AssistantSession = z.infer<typeof AssistantSessionSchema>;
export type AssistantEvent = z.infer<typeof AssistantEventSchema>;
