import { parseSseStream } from "../sse.ts";
import {
  type AssistantEvent,
  AssistantEventSchema,
  type AssistantSession,
  AssistantSessionSchema,
  type AssistantSessionSummary,
  AssistantSessionSummarySchema,
  type AssistantStatus,
  AssistantStatusSchema,
  type CreateAssistantSessionInput,
} from "./contracts.ts";

export class AssistantClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #token: string | undefined;

  constructor(options: { baseUrl: string; fetch?: typeof fetch; token?: string }) {
    const baseUrl = new URL(options.baseUrl);
    if (baseUrl.protocol !== "http:") throw new Error("Assistant URL must use HTTP");
    this.#baseUrl = baseUrl.href.replace(/\/$/, "");
    const fetchImpl = options.fetch ?? fetch;
    this.#fetch = (input, init) => fetchImpl(input, init);
    this.#token = options.token;
  }

  async status(): Promise<AssistantStatus> {
    return AssistantStatusSchema.parse(await this.#request("GET", "/v1/assistant/status"));
  }

  async listSessions(): Promise<AssistantSessionSummary[]> {
    const value = await this.#request("GET", "/v1/assistant/sessions");
    return AssistantSessionSummarySchema.array().parse(value);
  }

  async createSession(input: CreateAssistantSessionInput): Promise<AssistantSessionSummary> {
    return AssistantSessionSummarySchema.parse(
      await this.#request("POST", "/v1/assistant/sessions", input),
    );
  }

  async openSession(sessionId: string): Promise<AssistantSession> {
    return AssistantSessionSchema.parse(
      await this.#request("GET", `/v1/assistant/sessions/${encodeURIComponent(sessionId)}`),
    );
  }

  async renameSession(sessionId: string, name: string): Promise<AssistantSessionSummary> {
    return AssistantSessionSummarySchema.parse(
      await this.#request("PATCH", `/v1/assistant/sessions/${encodeURIComponent(sessionId)}`, {
        name,
      }),
    );
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.#request("DELETE", `/v1/assistant/sessions/${encodeURIComponent(sessionId)}`);
  }

  async *run(
    sessionId: string,
    prompt: string,
    options: { signal?: AbortSignal } = {},
  ): AsyncIterable<AssistantEvent> {
    const response = await this.#fetch(
      `${this.#baseUrl}/v1/assistant/sessions/${encodeURIComponent(sessionId)}/runs`,
      {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
          ...(this.#token ? { Authorization: `Bearer ${this.#token}` } : {}),
        },
        body: JSON.stringify({ prompt }),
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );
    if (!response.ok || !response.body) throw await readResponseError(response);
    let terminal = false;
    for await (const frame of parseSseStream(response.body)) {
      const event = AssistantEventSchema.parse(JSON.parse(frame.data));
      terminal ||= event.type === "completed" || event.type === "aborted" || event.type === "error";
      yield event;
    }
    if (!terminal) throw new Error("Assistant stream ended unexpectedly");
  }

  async abort(sessionId: string): Promise<void> {
    await this.#request("POST", `/v1/assistant/sessions/${encodeURIComponent(sessionId)}/abort`);
  }

  async respondApproval(
    sessionId: string,
    approvalId: string,
    approved: boolean,
    reason?: string,
  ): Promise<void> {
    await this.#request(
      "POST",
      `/v1/assistant/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approvalId)}`,
      { approved, ...(reason ? { reason } : {}) },
    );
  }

  async #request(method: string, path: string, requestBody?: unknown): Promise<unknown> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(this.#token ? { Authorization: `Bearer ${this.#token}` } : {}),
        ...(requestBody !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(requestBody !== undefined ? { body: JSON.stringify(requestBody) } : {}),
    });
    if (!response.ok) throw await readResponseError(response);
    try {
      return await response.json();
    } catch {
      throw new Error("Assistant request failed");
    }
  }
}

async function readResponseError(response: Response): Promise<Error> {
  try {
    const body = await response.json();
    if (
      body &&
      typeof body === "object" &&
      typeof (body as { message?: unknown }).message === "string"
    ) {
      return new Error((body as { message: string }).message);
    }
  } catch {
    // fall through to the stable client error
  }
  return new Error("Assistant request failed");
}

export function createHttpAssistantClient(options: {
  baseUrl: string;
  fetch?: typeof fetch;
  token?: string;
}): AssistantClient {
  return new AssistantClient(options);
}
