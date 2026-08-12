import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeClient } from "@symphoneer/runtime-client";
import {
  executeRuntimeTool,
  getAttemptTool,
  listEventsTool,
  pauseAttemptTool,
  respondInterventionTool,
  retryAttemptTool,
  runtimeHealthTool,
  runtimeSnapshotTool,
} from "@symphoneer/runtime-tools";
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
    runtimeHealthTool.name,
    {
      title: "Runtime health",
      description: runtimeHealthTool.description,
      inputSchema: {},
      annotations: readOnly,
      _meta: uiMeta("task"),
    },
    async () => {
      try {
        const data = await executeRuntimeTool(client, "runtime_health", {});
        return toolSuccess(data, "Runtime health: ok");
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    runtimeSnapshotTool.name,
    {
      title: "Runtime snapshot",
      description: runtimeSnapshotTool.description,
      inputSchema: {},
      annotations: readOnly,
      _meta: uiMeta("task"),
    },
    async () => {
      try {
        const data = await executeRuntimeTool(client, "runtime_snapshot", {});
        return toolSuccess(data, "Runtime snapshot");
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    getAttemptTool.name,
    {
      title: "Attempt detail",
      description: getAttemptTool.description,
      inputSchema: { attemptId: NonEmpty.describe("Attempt id") },
      annotations: readOnly,
      _meta: uiMeta("attempt"),
    },
    async ({ attemptId }) => {
      try {
        const data = await executeRuntimeTool(client, "get_attempt", { attemptId });
        const attempt = data as { attempt: { id: string; status: string } };
        return toolSuccess(data, `Attempt ${attempt.attempt.id}: ${attempt.attempt.status}`);
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    listEventsTool.name,
    {
      title: "Runtime events",
      description: listEventsTool.description,
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
        const data = (await executeRuntimeTool(client, "list_events", { after })) as {
          events: unknown[];
        };
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
    pauseAttemptTool.name,
    {
      title: "Pause Attempt",
      description: pauseAttemptTool.description,
      inputSchema: attemptInput,
      annotations: mutating,
      _meta: uiMeta("attempt"),
    },
    async (args) => {
      try {
        const data = (await executeRuntimeTool(client, "pause_attempt", args, {
          confirmed: true,
        })) as { message: string };
        return toolSuccess(data, data.message);
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    retryAttemptTool.name,
    {
      title: "Retry Attempt",
      description: retryAttemptTool.description,
      inputSchema: attemptInput,
      annotations: mutating,
      _meta: uiMeta("attempt"),
    },
    async (args) => {
      try {
        const data = (await executeRuntimeTool(client, "retry_attempt", args, {
          confirmed: true,
        })) as { message: string };
        return toolSuccess(data, data.message);
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    respondInterventionTool.name,
    {
      title: "Respond to Intervention",
      description: respondInterventionTool.description,
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
        const data = (await executeRuntimeTool(client, "respond_intervention", args, {
          confirmed: true,
        })) as { message: string };
        return toolSuccess(data, data.message);
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  registerUiResources(server);
}
