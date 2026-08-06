import { ApiErrorSchema } from "@symphoneer/contracts";
import { mapHttpError, RuntimeClientError } from "./errors.ts";
import type {
  RuntimeSubscriptionRequest,
  RuntimeTransport,
  RuntimeTransportEvent,
  RuntimeTransportRequest,
  RuntimeTransportSubscription,
} from "./transport.ts";

export interface HttpRuntimeTransportOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  token?: string;
}

export class HttpRuntimeTransport implements RuntimeTransport {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #token: string | undefined;

  constructor(options: HttpRuntimeTransportOptions) {
    const baseUrl = new URL(options.baseUrl);
    if (baseUrl.protocol !== "http:") {
      throw new RuntimeClientError(0, "invalid_url", "Runtime URL must use HTTP");
    }
    this.#baseUrl = baseUrl.href.replace(/\/$/, "");
    this.#fetch = options.fetch ?? fetch;
    this.#token = options.token;
  }

  async request(request: RuntimeTransportRequest): Promise<unknown> {
    const url = this.#url(request.path, request.query);
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: request.method,
        headers: {
          Accept: "application/json",
          ...this.#authHeaders(),
          ...request.headers,
          ...(request.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: request.signal,
      });
    } catch (error) {
      if (error instanceof RuntimeClientError) throw error;
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
      throw mapHttpError(
        response.status,
        error.success ? error.data.code : "runtime_error",
        error.success ? error.data.message : "Runtime request failed",
      );
    }
    return body;
  }

  subscribe(request: RuntimeSubscriptionRequest): RuntimeTransportSubscription {
    const controller = new AbortController();
    if (request.signal) {
      if (request.signal.aborted) controller.abort();
      else
        request.signal.addEventListener("abort", () => controller.abort(), {
          once: true,
        });
    }

    const queue: RuntimeTransportEvent[] = [];
    let wake: (() => void) | undefined;
    let closed = false;
    let lastError: Error | undefined;

    const push = (event: RuntimeTransportEvent) => {
      queue.push(event);
      wake?.();
      wake = undefined;
    };

    const run = async () => {
      try {
        await this.#consumeSse(request, controller.signal, push);
      } catch (error) {
        if (controller.signal.aborted || closed) return;
        lastError = error instanceof Error ? error : new Error(String(error));
        push({ kind: "error", error: lastError });
      } finally {
        if (!closed) push({ kind: "close" });
      }
    };
    void run();

    const events: AsyncIterable<RuntimeTransportEvent> = {
      [Symbol.asyncIterator]: () => ({
        async next() {
          while (queue.length === 0 && !closed && !lastError) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
          const event = queue.shift();
          if (event) return { value: event, done: false as const };
          return { value: undefined, done: true as const };
        },
      }),
    };

    return {
      events,
      close: () => {
        closed = true;
        controller.abort();
        wake?.();
      },
    };
  }

  async #consumeSse(
    request: RuntimeSubscriptionRequest,
    signal: AbortSignal,
    push: (event: RuntimeTransportEvent) => void,
  ): Promise<void> {
    const url = this.#url(request.path, request.query);
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          ...this.#authHeaders(),
          ...request.headers,
        },
        signal,
      });
    } catch (error) {
      if (signal.aborted) return;
      throw error instanceof RuntimeClientError
        ? error
        : new RuntimeClientError(0, "unavailable", "Runtime is unavailable");
    }

    if (!response.ok || !response.body) {
      let message = "Runtime subscription failed";
      try {
        const body = await response.json();
        const error = ApiErrorSchema.safeParse(body);
        if (error.success) message = error.data.message;
      } catch {
        // ignore parse failure
      }
      throw mapHttpError(response.status, "runtime_error", message);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventName = "message";
    let dataLines: string[] = [];

    const flush = () => {
      if (dataLines.length === 0) {
        eventName = "message";
        return;
      }
      const raw = dataLines.join("\n");
      dataLines = [];
      let data: unknown = raw;
      try {
        data = JSON.parse(raw);
      } catch {
        // keep raw string
      }
      push({ kind: "message", event: eventName, data });
      eventName = "message";
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line === "") {
          flush();
          continue;
        }
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim() || "message";
          continue;
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }
    flush();
  }

  #authHeaders(): Record<string, string> {
    return this.#token ? { Authorization: `Bearer ${this.#token}` } : {};
  }

  #url(path: string, query?: Record<string, string | number | undefined>): string {
    const url = new URL(path.startsWith("http") ? path : `${this.#baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.href;
  }
}
