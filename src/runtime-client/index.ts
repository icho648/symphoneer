import {
  ApiErrorSchema,
  type RuntimeAttemptDetail,
  RuntimeAttemptDetailSchema,
  type RuntimeCommand,
  type RuntimeCommandResult,
  RuntimeCommandResultSchema,
  type RuntimeEvent,
  type RuntimeHealth,
  RuntimeHealthSchema,
  type RuntimeSnapshot,
  RuntimeSnapshotSchema,
} from "@symphoneer/contracts";

export class RuntimeClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RuntimeClientError";
    this.status = status;
    this.code = code;
  }
}

export class RuntimeClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: { baseUrl: string; fetch?: typeof fetch }) {
    const baseUrl = new URL(options.baseUrl);
    if (baseUrl.protocol !== "http:")
      throw new RuntimeClientError(0, "invalid_url", "Runtime URL must use HTTP");
    this.#baseUrl = baseUrl.href.replace(/\/$/, "");
    this.#fetch = options.fetch ?? fetch;
  }

  snapshot(): Promise<RuntimeSnapshot> {
    return this.#request("/v1/snapshot", RuntimeSnapshotSchema);
  }

  health(): Promise<RuntimeHealth> {
    return this.#request("/healthz", RuntimeHealthSchema);
  }

  events(afterSequence = 0): Promise<{ events: RuntimeEvent[] }> {
    return this.#request(`/v1/events?after=${afterSequence}`, (value) => {
      if (
        !value ||
        typeof value !== "object" ||
        !Array.isArray((value as { events?: unknown }).events)
      ) {
        throw new RuntimeClientError(
          200,
          "invalid_response",
          "Runtime returned an invalid event list",
        );
      }
      return { events: (value as { events: RuntimeEvent[] }).events };
    });
  }

  attempt(attemptId: string): Promise<RuntimeAttemptDetail> {
    return this.#request(
      `/v1/attempts/${encodeURIComponent(attemptId)}`,
      RuntimeAttemptDetailSchema,
    );
  }

  command(command: RuntimeCommand): Promise<RuntimeCommandResult> {
    return this.#request("/v1/commands", RuntimeCommandResultSchema, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
  }

  async #request<T>(
    path: string,
    parse: { parse(value: unknown): T } | ((value: unknown) => T),
    init: RequestInit = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        ...init,
        headers: { Accept: "application/json", ...init.headers },
      });
    } catch {
      throw new RuntimeClientError(0, "unavailable", "Runtime is unavailable");
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new RuntimeClientError(
        response.status,
        "invalid_response",
        "Runtime returned invalid JSON",
      );
    }
    if (!response.ok) {
      const error = ApiErrorSchema.safeParse(body);
      throw new RuntimeClientError(
        response.status,
        error.success ? error.data.code : "runtime_error",
        error.success ? error.data.message : "Runtime request failed",
      );
    }
    try {
      return typeof parse === "function" ? parse(body) : parse.parse(body);
    } catch {
      throw new RuntimeClientError(
        response.status,
        "invalid_response",
        "Runtime returned an invalid response",
      );
    }
  }
}
