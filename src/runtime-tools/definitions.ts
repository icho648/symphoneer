import type { RuntimeClient } from "@symphoneer/runtime-client";
import { z } from "zod";

import { defineRuntimeTool } from "./types.ts";

const NonEmpty = z.string().min(1);
const IdempotencyKey = NonEmpty;
const ExpectedSequence = z.number().int().nonnegative().optional();
const ExpectedUpdatedAt = z.string().min(1).optional();

export const runtimeHealthTool = defineRuntimeTool({
  name: "runtime_health",
  description: "Read Runtime health.",
  inputSchema: z.object({}),
  approval: "none",
  readOnly: true,
  execute: (runtime) => runtime.health(),
});

export const runtimeSnapshotTool = defineRuntimeTool({
  name: "runtime_snapshot",
  description: "Read Runtime projection snapshot.",
  inputSchema: z.object({}),
  approval: "none",
  readOnly: true,
  execute: (runtime) => runtime.snapshot(),
});

export const getAttemptTool = defineRuntimeTool({
  name: "get_attempt",
  description: "Read Attempt detail.",
  inputSchema: z.object({ attemptId: NonEmpty }),
  approval: "none",
  readOnly: true,
  execute: (runtime, input) => runtime.getAttempt(input.attemptId),
});

export const listEventsTool = defineRuntimeTool({
  name: "list_events",
  description: "List Runtime domain events after a sequence.",
  inputSchema: z.object({ after: ExpectedSequence }),
  approval: "none",
  readOnly: true,
  execute: (runtime, input) => runtime.listEvents(input.after ?? 0),
});

export const pauseAttemptTool = defineRuntimeTool({
  name: "pause_attempt",
  description: "Pause an active Attempt.",
  inputSchema: z.object({
    attemptId: NonEmpty,
    idempotencyKey: IdempotencyKey,
    expectedEventSequence: ExpectedSequence,
    expectedAttemptUpdatedAt: ExpectedUpdatedAt,
  }),
  approval: "required",
  readOnly: false,
  prepare: captureAttemptPreconditions,
  execute: async (runtime, input) => {
    const prepared = await captureAttemptPreconditions(runtime, input);
    return runtime.pauseAttempt({
      ...prepared,
    });
  },
});

export const retryAttemptTool = defineRuntimeTool({
  name: "retry_attempt",
  description: "Retry an Attempt.",
  inputSchema: z.object({
    attemptId: NonEmpty,
    idempotencyKey: IdempotencyKey,
    expectedEventSequence: ExpectedSequence,
    expectedAttemptUpdatedAt: ExpectedUpdatedAt,
  }),
  approval: "required",
  readOnly: false,
  prepare: captureAttemptPreconditions,
  execute: async (runtime, input) => {
    const prepared = await captureAttemptPreconditions(runtime, input);
    return runtime.retryAttempt({
      ...prepared,
    });
  },
});

export const respondInterventionTool = defineRuntimeTool({
  name: "respond_intervention",
  description: "Respond to a pending Intervention.",
  inputSchema: z.object({
    interventionId: NonEmpty,
    decidedBy: NonEmpty,
    decision: z.enum(["approved", "rejected", "answered", "canceled"]),
    response: z.string().optional(),
    idempotencyKey: IdempotencyKey,
    expectedEventSequence: ExpectedSequence,
  }),
  approval: "required",
  readOnly: false,
  prepare: captureEventSequence,
  execute: async (runtime, input) => {
    const prepared = await captureEventSequence(runtime, input);
    return runtime.respondToIntervention({
      ...prepared,
    });
  },
});

export const RUNTIME_TOOLS = [
  runtimeHealthTool,
  runtimeSnapshotTool,
  getAttemptTool,
  listEventsTool,
  pauseAttemptTool,
  retryAttemptTool,
  respondInterventionTool,
] as const;

export async function executeRuntimeTool(
  runtime: RuntimeClient,
  name: string,
  rawInput: unknown,
  options: { confirmed?: boolean } = {},
): Promise<unknown> {
  const tool = RUNTIME_TOOLS.find((item) => item.name === name);
  if (!tool) throw new Error(`Unknown runtime tool: ${name}`);
  if (tool.approval === "required" && !options.confirmed) {
    throw new Error(`Tool ${name} requires confirmation`);
  }
  const input = await prepareRuntimeToolInput(runtime, name, rawInput);
  return tool.execute(runtime, input as never);
}

export async function prepareRuntimeToolInput(
  runtime: RuntimeClient,
  name: string,
  rawInput: unknown,
): Promise<unknown> {
  const tool = RUNTIME_TOOLS.find((item) => item.name === name);
  if (!tool) throw new Error(`Unknown runtime tool: ${name}`);
  const input = tool.inputSchema.parse(rawInput ?? {});
  return tool.prepare ? tool.prepare(runtime, input as never) : input;
}

async function captureAttemptPreconditions(
  runtime: RuntimeClient,
  input: {
    attemptId: string;
    idempotencyKey: string;
    expectedEventSequence?: number | undefined;
    expectedAttemptUpdatedAt?: string | undefined;
  },
) {
  const [snapshot, detail] = await Promise.all([
    input.expectedEventSequence === undefined ? runtime.snapshot() : undefined,
    input.expectedAttemptUpdatedAt === undefined ? runtime.getAttempt(input.attemptId) : undefined,
  ]);
  return {
    ...input,
    expectedEventSequence: input.expectedEventSequence ?? snapshot?.runtime.lastEventSequence,
    expectedAttemptUpdatedAt: input.expectedAttemptUpdatedAt ?? detail?.attempt.updatedAt,
  };
}

async function captureEventSequence<T extends { expectedEventSequence?: number | undefined }>(
  runtime: RuntimeClient,
  input: T,
): Promise<T> {
  if (input.expectedEventSequence !== undefined) return input;
  const snapshot = await runtime.snapshot();
  return { ...input, expectedEventSequence: snapshot.runtime.lastEventSequence };
}
