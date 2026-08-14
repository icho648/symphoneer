import type { JsonValue } from "@symphoneer/contracts";
import type { AgentRunCompletion, AgentRunEvent, InterventionDetails } from "../agent-runner.ts";
import { safeProviderText } from "../safe-provider-text.ts";
import type { ClaudeMessage } from "./transport.ts";

type ActivityEvent = Extract<AgentRunEvent, { type: "activity" }>;

export interface ClaudeInit {
  sessionId: string;
  version: string;
  model: string;
  permissionMode: string;
  capabilities: string[];
}

export interface ClaudePermissionRequest {
  requestRef: string;
  toolUseId: string;
  input: Record<string, unknown>;
  event: Extract<AgentRunEvent, { type: "intervention_requested" }>;
}

export function parseClaudeInit(message: ClaudeMessage): ClaudeInit | null {
  if (message.type !== "system" || message.subtype !== "init") return null;
  const sessionId = stringField(message, "session_id");
  const version = stringField(message, "claude_code_version");
  const model = stringField(message, "model");
  const permissionMode = stringField(message, "permissionMode");
  if (!sessionId || !version || !model || !permissionMode || !/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error("claude_invalid_init");
  }
  return {
    sessionId,
    version,
    model,
    permissionMode,
    capabilities: Array.isArray(message.capabilities)
      ? message.capabilities.filter((value): value is string => typeof value === "string")
      : [],
  };
}

export function claudeSessionId(message: ClaudeMessage): string | null {
  return stringField(message, "session_id");
}

export function claudeActivities(message: ClaudeMessage, occurredAt: string): ActivityEvent[] {
  if (message.type === "assistant") return assistantActivities(message, occurredAt);
  if (message.type === "user") return toolResultActivities(message, occurredAt);
  if (message.type === "system" && message.subtype === "api_retry") {
    return [
      activity(
        stringField(message, "uuid") ?? `retry:${occurredAt}`,
        "warning",
        "info",
        "Claude API retry",
        null,
        compact({
          attempt: numberField(message, "attempt"),
          maxRetries: numberField(message, "max_retries"),
          retryDelayMs: numberField(message, "retry_delay_ms"),
          errorStatus: numberField(message, "error_status"),
          error: safeProviderText(stringField(message, "error")),
        }),
        occurredAt,
      ),
    ];
  }
  if (message.type === "result") {
    const succeeded = message.subtype === "success" && message.is_error !== true;
    const errors = Array.isArray(message.errors)
      ? message.errors.filter((value): value is string => typeof value === "string").join("; ")
      : null;
    return [
      activity(
        stringField(message, "uuid") ?? `result:${occurredAt}`,
        succeeded ? "message" : "error",
        succeeded ? "completed" : "failed",
        succeeded ? "Claude turn completed" : "Claude turn failed",
        succeeded
          ? safeProviderText(stringField(message, "result"), 4_000)
          : safeProviderText(errors, 4_000),
        compact({
          durationMs: numberField(message, "duration_ms"),
          durationApiMs: numberField(message, "duration_api_ms"),
          numTurns: numberField(message, "num_turns"),
          totalCostUsd: numberField(message, "total_cost_usd"),
          usage: numericRecord(message.usage),
          terminalReason: safeProviderText(stringField(message, "terminal_reason")),
        }),
        occurredAt,
      ),
    ];
  }
  return [];
}

export function claudeCompletion(
  message: ClaudeMessage,
  interrupted: boolean,
): AgentRunCompletion | null {
  if (message.type !== "result") return null;
  if (interrupted || message.terminal_reason === "aborted") return { outcome: "interrupted" };
  return message.subtype === "success" && message.is_error !== true
    ? { outcome: "completed" }
    : { outcome: "failed", error: "claude_turn_failed" };
}

export function parsePermissionRequest(
  message: ClaudeMessage,
  occurredAt: string,
): ClaudePermissionRequest | null {
  if (message.type !== "control_request") return null;
  const requestRef = stringField(message, "request_id");
  const request = asRecord(message.request);
  const toolName = stringField(request, "tool_name");
  const toolUseId = stringField(request, "tool_use_id");
  const input = asRecord(request?.input);
  if (request?.subtype !== "can_use_tool" || !requestRef || !toolName || !toolUseId || !input) {
    return null;
  }
  const details = permissionDetails(toolName, input, request);
  return {
    requestRef,
    toolUseId,
    input,
    event: {
      type: "intervention_requested",
      occurredAt,
      requestRef,
      kind: "approval",
      prompt:
        safeProviderText(stringField(request, "title")) ??
        `Claude Code requests approval to use ${safeProviderText(toolName) ?? "a tool"}.`,
      ...(details ? { details } : {}),
    },
  };
}

function assistantActivities(message: ClaudeMessage, occurredAt: string): ActivityEvent[] {
  const envelope = asRecord(message.message);
  const content = Array.isArray(envelope?.content) ? envelope.content : [];
  const uuid = stringField(message, "uuid") ?? `assistant:${occurredAt}`;
  const events = content.flatMap((value, index) => {
    const block = asRecord(value);
    if (!block) return [];
    if (block.type === "text") {
      return [
        activity(
          `${uuid}:text:${index}`,
          "message",
          "completed",
          "Claude message",
          safeProviderText(stringField(block, "text"), 12_000),
          {},
          occurredAt,
        ),
      ];
    }
    if (block.type === "thinking") {
      return [
        activity(
          `${uuid}:thinking:${index}`,
          "reasoning",
          "completed",
          "Reasoning summary",
          safeProviderText(stringField(block, "thinking"), 4_000),
          {},
          occurredAt,
        ),
      ];
    }
    if (block.type === "tool_use") {
      const name = safeProviderText(stringField(block, "name")) ?? "Claude tool";
      return [
        activity(
          stringField(block, "id") ?? `${uuid}:tool:${index}`,
          "tool",
          "running",
          name,
          null,
          compact({ input: safeJson(block.input) }),
          occurredAt,
        ),
      ];
    }
    return [];
  });
  const error = safeProviderText(stringField(message, "error"), 4_000);
  return error
    ? [
        ...events,
        activity(`${uuid}:error`, "error", "failed", "Claude error", error, {}, occurredAt),
      ]
    : events;
}

function toolResultActivities(message: ClaudeMessage, occurredAt: string): ActivityEvent[] {
  const envelope = asRecord(message.message);
  const content = Array.isArray(envelope?.content) ? envelope.content : [];
  return content.flatMap((value, index) => {
    const block = asRecord(value);
    if (block?.type !== "tool_result") return [];
    const failed = block.is_error === true;
    return [
      activity(
        stringField(block, "tool_use_id") ?? `tool-result:${occurredAt}:${index}`,
        "tool",
        failed ? "failed" : "completed",
        failed ? "Claude tool failed" : "Claude tool completed",
        safeProviderText(
          typeof block.content === "string" ? block.content : JSON.stringify(block.content),
          12_000,
        ),
        {},
        occurredAt,
      ),
    ];
  });
}

function permissionDetails(
  toolName: string,
  input: Record<string, unknown>,
  request: Record<string, unknown>,
): InterventionDetails | null {
  const reason = safeProviderText(stringField(request, "decision_reason"));
  if (toolName === "Bash") {
    return {
      action: "command",
      command: safeProviderText(stringField(input, "command"), 2_000) ?? "<command unavailable>",
      cwd: safeProviderText(stringField(input, "cwd"), 1_000),
      reason,
    };
  }
  if (["Edit", "Write", "NotebookEdit"].includes(toolName)) {
    return { action: "file_change", reason, scope: "workspace" };
  }
  return null;
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
  return { type: "activity", itemId, occurredAt, kind, status, title, content, details };
}

function safeJson(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined;
  return safeProviderText(JSON.stringify(value), 12_000) ?? undefined;
}

function numericRecord(value: unknown): Record<string, JsonValue> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, number] => Number.isFinite(entry[1])),
  );
}

function compact(value: Record<string, JsonValue | undefined>): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined),
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(value: unknown, field: string): string | null {
  const record = asRecord(value);
  return record && typeof record[field] === "string" ? record[field] : null;
}

function numberField(value: unknown, field: string): number | undefined {
  const record = asRecord(value);
  return record && typeof record[field] === "number" && Number.isFinite(record[field])
    ? (record[field] as number)
    : undefined;
}
