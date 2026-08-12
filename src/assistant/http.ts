import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type AssistantEvent,
  type AssistantSession,
  type AssistantSessionSummary,
  type AssistantStatus,
  type CreateAssistantSessionInput,
  CreateAssistantSessionInputSchema,
} from "../assistant-client/index.ts";

const MAX_BODY_BYTES = 64 * 1024;

type AssistantOperations = {
  status(): Promise<AssistantStatus>;
  listSessions(): Promise<AssistantSessionSummary[]>;
  createSession(input: CreateAssistantSessionInput): Promise<AssistantSessionSummary>;
  openSession(id: string): Promise<AssistantSession>;
  renameSession(id: string, name: string): Promise<AssistantSessionSummary>;
  deleteSession(id: string): Promise<void>;
  run(id: string, prompt: string): Promise<ReadableStream<AssistantEvent>>;
  abort(id: string): boolean;
  respondApproval(sessionId: string, approvalId: string, approved: boolean): void;
};

export class AssistantServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function handleAssistantHttp(
  assistant: AssistantOperations,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  try {
    if (request.method === "GET" && url.pathname === "/v1/assistant/status") {
      sendJson(response, 200, await assistant.status());
      return true;
    }
    if (url.pathname === "/v1/assistant/sessions") {
      if (request.method === "GET") sendJson(response, 200, await assistant.listSessions());
      else if (request.method === "POST") {
        const input = CreateAssistantSessionInputSchema.parse(await readJson(request));
        sendJson(response, 201, await assistant.createSession(input));
      } else return false;
      return true;
    }
    const runMatch = /^\/v1\/assistant\/sessions\/([^/]+)\/runs$/.exec(url.pathname);
    if (request.method === "POST" && runMatch?.[1]) {
      const id = decodeURIComponent(runMatch[1]);
      const prompt = field(await readJson(request), "prompt");
      if (typeof prompt !== "string") {
        throw new AssistantServiceError(400, "invalid_request", "Prompt is required");
      }
      await streamEvents(response, await assistant.run(id, prompt), () => assistant.abort(id));
      return true;
    }
    const abortMatch = /^\/v1\/assistant\/sessions\/([^/]+)\/abort$/.exec(url.pathname);
    if (request.method === "POST" && abortMatch?.[1]) {
      sendJson(response, 200, { aborted: assistant.abort(decodeURIComponent(abortMatch[1])) });
      return true;
    }
    const approvalMatch = /^\/v1\/assistant\/sessions\/([^/]+)\/approvals\/([^/]+)$/.exec(
      url.pathname,
    );
    if (request.method === "POST" && approvalMatch?.[1] && approvalMatch[2]) {
      const approved = field(await readJson(request), "approved");
      if (typeof approved !== "boolean") {
        throw new AssistantServiceError(400, "invalid_request", "Approval decision is required");
      }
      assistant.respondApproval(
        decodeURIComponent(approvalMatch[1]),
        decodeURIComponent(approvalMatch[2]),
        approved,
      );
      sendJson(response, 200, { accepted: true });
      return true;
    }
    const sessionMatch = /^\/v1\/assistant\/sessions\/([^/]+)$/.exec(url.pathname);
    if (!sessionMatch?.[1]) return false;
    const id = decodeURIComponent(sessionMatch[1]);
    if (request.method === "GET") sendJson(response, 200, await assistant.openSession(id));
    else if (request.method === "PATCH") {
      const name = field(await readJson(request), "name");
      if (typeof name !== "string") {
        throw new AssistantServiceError(400, "invalid_request", "Name is required");
      }
      sendJson(response, 200, await assistant.renameSession(id, name));
    } else if (request.method === "DELETE") {
      await assistant.deleteSession(id);
      sendJson(response, 200, { deleted: true });
    } else return false;
    return true;
  } catch (error) {
    const failure = toServiceError(error);
    sendJson(response, failure.status, { code: failure.code, message: failure.message });
    return true;
  }
}

async function streamEvents(
  response: ServerResponse,
  events: ReadableStream<AssistantEvent>,
  abort: () => void,
): Promise<void> {
  response.writeHead(200, {
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no",
  });
  let completed = false;
  const onClose = () => {
    if (!completed) abort();
  };
  response.once("close", onClose);
  try {
    for await (const event of events) {
      response.write(`event: assistant\ndata: ${JSON.stringify(event)}\n\n`);
    }
    completed = true;
    response.end();
  } finally {
    response.off("close", onClose);
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) {
      throw new AssistantServiceError(400, "invalid_request", "Request body is too large");
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AssistantServiceError(400, "invalid_request", "Request body must be JSON");
  }
}

function field(value: unknown, name: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[name] : undefined;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function toServiceError(error: unknown): AssistantServiceError {
  if (error instanceof AssistantServiceError) return error;
  if (error && typeof error === "object" && "issues" in error) {
    return new AssistantServiceError(400, "invalid_request", "Assistant request is invalid");
  }
  return new AssistantServiceError(500, "assistant_error", "Assistant request failed");
}
