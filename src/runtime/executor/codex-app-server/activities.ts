import {
  ActivityPayloadSchema,
  CONTRACT_SCHEMA_VERSION,
  type ExecutionSession,
  ExecutionSessionSchema,
  type JsonValue,
} from "@symphoneer/contracts";
import type { AgentRunEvent } from "../agent-runner.ts";

import { safeProviderText } from "../safe-provider-text.ts";
import { asRecord, stringField } from "./protocol.ts";
import type { CodexServerMessage } from "./transport.ts";

type ActivityEvent = Extract<AgentRunEvent, { type: "activity" }>;

export function executionActivity(
  message: Extract<CodexServerMessage, { kind: "notification" }>,
  occurredAt: string,
): ActivityEvent | null {
  const params = asRecord(message.params);
  if (!params) return null;
  if (message.method === "turn/plan/updated") return planActivity(params, occurredAt);
  if (
    message.method === "error" ||
    message.method === "warning" ||
    message.method === "configWarning"
  ) {
    const content = safeProviderText(stringField(params, "message"), 4_000);
    return {
      type: "activity",
      occurredAt,
      itemId: `${message.method}:${occurredAt}`,
      kind: message.method === "error" ? "error" : "warning",
      status: message.method === "error" ? "failed" : "info",
      title: message.method === "error" ? "Codex error" : "Codex warning",
      content,
      details: {},
    };
  }
  if (message.method !== "item/started" && message.method !== "item/completed") return null;
  const item = asRecord(params.item);
  if (!item) return null;
  const itemId = stringField(item, "id");
  const itemType = stringField(item, "type");
  if (!itemId || !itemType) return null;
  const running = message.method === "item/started";
  const status = activityStatus(stringField(item, "status"), running);

  if (itemType === "agentMessage") {
    return activity(
      itemId,
      "message",
      status,
      "Agent message",
      stringField(item, "text"),
      {},
      occurredAt,
    );
  }
  if (itemType === "userMessage") {
    const content = Array.isArray(item.content)
      ? item.content
          .flatMap((value) => {
            const part = asRecord(value);
            const text = part ? safeProviderText(stringField(part, "text"), 4_000) : null;
            return text ? [text] : [];
          })
          .join("\n")
      : null;
    return activity(
      itemId,
      "message",
      status,
      "User message",
      content,
      { role: "user" },
      occurredAt,
    );
  }
  if (itemType === "plan") {
    return activity(
      itemId,
      "plan",
      status,
      "Execution plan",
      stringField(item, "text"),
      {},
      occurredAt,
    );
  }
  if (itemType === "reasoning") {
    const summary = Array.isArray(item.summary)
      ? item.summary.filter((value): value is string => typeof value === "string").join("\n\n")
      : null;
    return activity(itemId, "reasoning", status, "Reasoning summary", summary, {}, occurredAt);
  }
  if (itemType === "commandExecution") {
    const command = safeProviderText(stringField(item, "command"), 2_000) ?? "Command";
    return activity(
      itemId,
      "command",
      status,
      command,
      null,
      compact({
        command,
        cwd: safeProviderText(stringField(item, "cwd"), 1_000),
        output: safeProviderText(stringField(item, "aggregatedOutput"), 12_000),
        exitCode: numberField(item, "exitCode"),
        durationMs: numberField(item, "durationMs"),
      }),
      occurredAt,
    );
  }
  if (itemType === "fileChange") {
    const changes = Array.isArray(item.changes)
      ? item.changes.flatMap((value) => {
          const change = asRecord(value);
          const path = change ? safeProviderText(stringField(change, "path"), 1_000) : null;
          if (!change || !path) return [];
          return [
            compact({
              path,
              kind: safeProviderText(stringField(change, "kind")),
              diff: safeProviderText(stringField(change, "diff"), 12_000),
            }),
          ];
        })
      : [];
    return activity(
      itemId,
      "file_change",
      status,
      changes.length === 1 ? "Changed 1 file" : `Changed ${changes.length} files`,
      changes.map((change) => String(change.path)).join("\n"),
      { changes },
      occurredAt,
    );
  }
  if (itemType === "mcpToolCall" || itemType === "dynamicToolCall") {
    const server = stringField(item, "server") ?? stringField(item, "namespace");
    const tool = stringField(item, "tool") ?? "Tool";
    return activity(
      itemId,
      "tool",
      status,
      server ? `${server} · ${tool}` : tool,
      safeProviderText(stringField(asRecord(item.error), "message"), 4_000),
      compact({
        input: safeJson(item.arguments),
        output: safeJson(item.result ?? item.contentItems),
        durationMs: numberField(item, "durationMs"),
      }),
      occurredAt,
    );
  }
  if (itemType === "webSearch") {
    return activity(
      itemId,
      "web_search",
      status,
      "Web search",
      safeProviderText(stringField(item, "query"), 2_000),
      {},
      occurredAt,
    );
  }
  return null;
}

export function storedExecutionSession(
  value: unknown,
  attemptId: string,
  capturedAt: string,
  instructionSources: string[] = [],
): ExecutionSession | null {
  const response = asRecord(value);
  const thread = response ? asRecord(response.thread) : null;
  const threadId = thread ? stringField(thread, "id") : null;
  if (!thread || !threadId || !Array.isArray(thread.turns)) return null;

  return ExecutionSessionSchema.parse({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    attemptId,
    provider: "codex-app-server",
    threadId,
    instructionSources,
    capturedAt,
    turns: thread.turns.flatMap((turnValue) => {
      const turn = asRecord(turnValue);
      const id = turn ? stringField(turn, "id") : null;
      if (!turn || !id || !Array.isArray(turn.items)) return [];
      return [
        {
          id,
          status: stringField(turn, "status"),
          items: turn.items.flatMap((itemValue) => {
            const item = asRecord(itemValue);
            if (!item) return [];
            const itemId = stringField(item, "id");
            const type = stringField(item, "type");
            if (!itemId || !type) return [];
            return [
              {
                id: itemId,
                type,
                status: stringField(item, "status"),
                data: storedSessionItemData(item, capturedAt),
              },
            ];
          }),
        },
      ];
    }),
  });
}

export function codexSessionExecutionActivities(session: ExecutionSession): ActivityEvent[] {
  return session.turns.flatMap((turn) =>
    turn.items.flatMap((item) => {
      const stored = ActivityPayloadSchema.safeParse(item.data.activity);
      if (stored.success) {
        return [
          {
            type: "activity" as const,
            occurredAt: session.capturedAt,
            itemId: item.id,
            ...stored.data,
          },
        ];
      }
      const projected = executionActivity(
        {
          kind: "notification",
          method: item.status === "inProgress" ? "item/started" : "item/completed",
          params: {
            threadId: session.threadId,
            turnId: turn.id,
            item: item.data,
          },
        },
        session.capturedAt,
      );
      return projected ? [projected] : [];
    }),
  );
}

function storedSessionItemData(
  item: Record<string, unknown>,
  capturedAt: string,
): Record<string, JsonValue> {
  const projected = executionActivity(
    {
      kind: "notification",
      method: stringField(item, "status") === "inProgress" ? "item/started" : "item/completed",
      params: { item },
    },
    capturedAt,
  );
  return projected ? { activity: ActivityPayloadSchema.parse(projected) } : {};
}

function planActivity(params: Record<string, unknown>, occurredAt: string): ActivityEvent {
  const turnId = stringField(params, "turnId") ?? "current";
  const steps = Array.isArray(params.plan)
    ? params.plan.flatMap((value) => {
        const step = asRecord(value);
        const text = step ? safeProviderText(stringField(step, "step"), 2_000) : null;
        const status = step ? stringField(step, "status") : null;
        return text ? [{ text, status: status ?? "pending" }] : [];
      })
    : [];
  return activity(
    `plan:${turnId}`,
    "plan",
    steps.length > 0 && steps.every((step) => step.status === "completed")
      ? "completed"
      : "running",
    "Execution plan",
    safeProviderText(stringField(params, "explanation"), 4_000),
    { steps },
    occurredAt,
  );
}

function activity(
  itemId: string,
  kind: ActivityEvent["kind"],
  status: ActivityEvent["status"],
  title: string,
  content: string | null,
  details: Record<string, JsonValue>,
  occurredAt: string,
): ActivityEvent {
  return {
    type: "activity",
    occurredAt,
    itemId,
    kind,
    status,
    title,
    content: safeProviderText(content, 12_000),
    details,
  };
}

function activityStatus(value: string | null, running: boolean): ActivityEvent["status"] {
  if (running || value === "inProgress") return "running";
  if (value === "failed") return "failed";
  if (value === "declined") return "declined";
  return "completed";
}

function numberField(value: Record<string, unknown>, field: string): number | null {
  return typeof value[field] === "number" && Number.isFinite(value[field])
    ? (value[field] as number)
    : null;
}

function safeJson(value: unknown): JsonValue | null {
  if (value === undefined || value === null) return null;
  const serialized = safeProviderText(JSON.stringify(value), 12_000);
  return serialized;
}

function compact(value: Record<string, JsonValue | undefined>): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined),
  );
}
