import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeClient } from "@symphoneer/runtime-client";
import { z } from "zod";

import { registerUiResources, uiMeta } from "./resources.ts";
import { toolFailure, toolSuccess } from "./results.ts";

/** Canonical MCP tool names for #16 (audit source). */
export const QUERY_TOOLS = [
  "runtime_health",
  "runtime_snapshot",
  "get_attempt",
  "list_events",
] as const;

export const MUTATION_TOOLS = ["pause_attempt", "retry_attempt", "respond_intervention"] as const;

export const ALL_TOOLS = [...QUERY_TOOLS, ...MUTATION_TOOLS] as const;

export const FORBIDDEN_TOOL_NAMES = [
  "dispatch",
  "commit",
  "push",
  "merge",
  "close",
  "create_pr",
] as const;

const NonEmpty = z.string().min(1);
const IdempotencyKey = NonEmpty.describe("Required idempotency key for Runtime commands");
const ExpectedSequence = z
  .number()
  .int()
  .nonnegative()
  .optional()
  .describe("Optional Runtime event sequence precondition");
const ExpectedUpdatedAt = z
  .string()
  .min(1)
  .optional()
  .describe("Optional Attempt updatedAt precondition");

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

const mutating = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Register query tools, mutation tools, and optional MCP Apps resources. */
export function registerMcpTools(server: McpServer, client: RuntimeClient): void {
  server.registerTool(
    "runtime_health",
    {
      title: "Runtime health",
      description: "Read loopback Runtime health (process/status).",
      annotations: readOnly,
      _meta: uiMeta("task"),
    },
    async () => {
      try {
        const data = await client.health();
        return toolSuccess(data, `Runtime health: ${data.status}`);
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    "runtime_snapshot",
    {
      title: "Runtime snapshot",
      description: "Re-read the authoritative Runtime projection (refresh).",
      annotations: readOnly,
      _meta: uiMeta("task"),
    },
    async () => {
      try {
        const data = await client.snapshot();
        return toolSuccess(
          data,
          `Snapshot: ${data.tasks.length} tasks, ${data.attempts.length} attempts, seq ${data.runtime.lastEventSequence}`,
        );
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    "get_attempt",
    {
      title: "Attempt detail",
      description: "Read Attempt detail, related Verification / Review / Intervention.",
      inputSchema: { attemptId: NonEmpty.describe("Attempt id") },
      annotations: readOnly,
      _meta: uiMeta("attempt"),
    },
    async ({ attemptId }) => {
      try {
        const data = await client.attempt(attemptId);
        return toolSuccess(data, `Attempt ${data.attempt.id}: ${data.attempt.status}`);
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    "list_events",
    {
      title: "Runtime events",
      description: "Read ordered Runtime domain events after a sequence.",
      inputSchema: {
        after: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Return events after this sequence"),
      },
      annotations: readOnly,
      _meta: uiMeta("verification"),
    },
    async ({ after }) => {
      try {
        const data = await client.events(after ?? 0);
        return toolSuccess(data, `${data.events.length} events after ${after ?? 0}`);
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  const attemptInput = {
    attemptId: NonEmpty,
    idempotencyKey: IdempotencyKey,
    expectedEventSequence: ExpectedSequence,
    expectedAttemptUpdatedAt: ExpectedUpdatedAt,
  };

  server.registerTool(
    "pause_attempt",
    {
      title: "Pause Attempt",
      description:
        "Request pause_attempt on Runtime. Hosts should require explicit approval. Does not Commit/Merge.",
      inputSchema: attemptInput,
      annotations: mutating,
      _meta: uiMeta("attempt"),
    },
    async (args) => runAttemptCommand(client, "pause_attempt", args),
  );

  server.registerTool(
    "retry_attempt",
    {
      title: "Retry Attempt",
      description:
        "Request retry_attempt on Runtime. Hosts should require explicit approval. Does not Commit/Merge.",
      inputSchema: attemptInput,
      annotations: mutating,
      _meta: uiMeta("attempt"),
    },
    async (args) => runAttemptCommand(client, "retry_attempt", args),
  );

  server.registerTool(
    "respond_intervention",
    {
      title: "Respond to Intervention",
      description:
        "Resolve a pending Intervention via Runtime. Hosts should require explicit approval.",
      inputSchema: {
        interventionId: NonEmpty,
        decidedBy: NonEmpty,
        decision: z.enum(["approved", "rejected", "answered", "canceled"]),
        response: z.string().optional(),
        idempotencyKey: IdempotencyKey,
        expectedEventSequence: ExpectedSequence,
      },
      annotations: mutating,
      _meta: uiMeta("intervention"),
    },
    async (args) => {
      try {
        const snapshot = await client.snapshot();
        const data = await client.command({
          kind: "respond_intervention",
          interventionId: args.interventionId,
          decidedBy: args.decidedBy,
          decision: args.decision,
          ...(args.response !== undefined ? { response: args.response } : {}),
          idempotencyKey: args.idempotencyKey,
          expectedEventSequence: args.expectedEventSequence ?? snapshot.runtime.lastEventSequence,
        });
        return toolSuccess(data, data.message);
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  registerUiResources(server);
}

async function runAttemptCommand(
  client: RuntimeClient,
  kind: "pause_attempt" | "retry_attempt",
  args: {
    attemptId: string;
    idempotencyKey: string;
    expectedEventSequence?: number | undefined;
    expectedAttemptUpdatedAt?: string | undefined;
  },
) {
  try {
    const [snapshot, detail] = await Promise.all([
      client.snapshot(),
      client.attempt(args.attemptId),
    ]);
    const data = await client.command({
      kind,
      attemptId: args.attemptId,
      idempotencyKey: args.idempotencyKey,
      expectedEventSequence: args.expectedEventSequence ?? snapshot.runtime.lastEventSequence,
      expectedAttemptUpdatedAt: args.expectedAttemptUpdatedAt ?? detail.attempt.updatedAt,
    });
    return toolSuccess(data, data.message);
  } catch (error) {
    return toolFailure(error);
  }
}
