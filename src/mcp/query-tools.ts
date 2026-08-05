import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeClient } from "@symphoneer/runtime-client";
import { z } from "zod";

import { toolFailure, toolSuccess } from "./errors.ts";
import { uiMeta } from "./resources.ts";
import { NonEmpty } from "./schemas.ts";

export function registerQueryTools(server: McpServer, client: RuntimeClient): void {
  server.registerTool(
    "runtime_health",
    {
      title: "Runtime health",
      description: "Read loopback Runtime health (process/status).",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
}
