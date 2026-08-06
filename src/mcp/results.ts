import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { RuntimeClientError } from "@symphoneer/runtime-client";

export type McpErrorCode =
  | "unavailable"
  | "conflict"
  | "not_found"
  | "invalid_request"
  | "duplicate_event"
  | "runtime_error";

export type McpToolFailure = {
  ok: false;
  code: McpErrorCode;
  message: string;
  retryable: boolean;
};

export function toolSuccess<T>(data: T, summary: string): CallToolResult {
  return {
    content: [{ type: "text", text: summary }],
    structuredContent: { ok: true, data } as Record<string, unknown>,
  };
}

export function toolFailure(error: unknown): CallToolResult {
  const failure = toFailure(error);
  return {
    isError: true,
    content: [{ type: "text", text: `${failure.code}: ${failure.message}` }],
    structuredContent: failure as unknown as Record<string, unknown>,
  };
}

export function toFailure(error: unknown): McpToolFailure {
  if (error instanceof RuntimeClientError) {
    const code = mapCode(error.code);
    return {
      ok: false,
      code,
      message: error.message,
      retryable: code === "unavailable" || error.status >= 500,
    };
  }
  return {
    ok: false,
    code: "runtime_error",
    message: error instanceof Error ? error.message : "MCP tool failed",
    retryable: false,
  };
}

function mapCode(code: string): McpErrorCode {
  switch (code) {
    case "unavailable":
    case "conflict":
    case "not_found":
    case "invalid_request":
    case "duplicate_event":
      return code;
    case "stale":
    case "terminal":
      return "conflict";
    default:
      return "runtime_error";
  }
}
