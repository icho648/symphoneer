import type { CodexServerMessage } from "./transport.ts";

export const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

export const stringField = (value: unknown, field: string): string | null => {
  const record = asRecord(value);
  return record && typeof record[field] === "string" ? record[field] : null;
};

export function belongsToTurn(
  message: CodexServerMessage,
  threadId: string,
  turnId: string,
): boolean {
  const requiresOwnership =
    message.method.startsWith("turn/") || message.method.startsWith("item/");
  const params = asRecord(message.params);
  if (!params) return !requiresOwnership;
  const messageThreadId =
    (typeof params.threadId === "string" ? params.threadId : null) ??
    stringField(params.thread, "id");
  const messageTurnId =
    (typeof params.turnId === "string" ? params.turnId : null) ?? stringField(params.turn, "id");
  if (requiresOwnership) {
    return messageThreadId === threadId && messageTurnId === turnId;
  }
  return (
    (messageThreadId === null || messageThreadId === threadId) &&
    (messageTurnId === null || messageTurnId === turnId)
  );
}
