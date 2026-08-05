import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeClient } from "@symphoneer/runtime-client";
import { z } from "zod";

import { toolFailure, toolSuccess } from "./errors.ts";
import { uiMeta } from "./resources.ts";
import { ExpectedSequence, ExpectedUpdatedAt, IdempotencyKey, NonEmpty } from "./schemas.ts";

const mutationAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerMutationTools(server: McpServer, client: RuntimeClient): void {
  server.registerTool(
    "pause_attempt",
    {
      title: "Pause Attempt",
      description:
        "Request pause_attempt on Runtime. Hosts should require explicit approval. Does not Commit/Merge.",
      inputSchema: {
        attemptId: NonEmpty,
        idempotencyKey: IdempotencyKey,
        expectedEventSequence: ExpectedSequence,
        expectedAttemptUpdatedAt: ExpectedUpdatedAt,
      },
      annotations: mutationAnnotations,
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
      inputSchema: {
        attemptId: NonEmpty,
        idempotencyKey: IdempotencyKey,
        expectedEventSequence: ExpectedSequence,
        expectedAttemptUpdatedAt: ExpectedUpdatedAt,
      },
      annotations: mutationAnnotations,
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
      annotations: mutationAnnotations,
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
