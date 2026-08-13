import { ApiErrorSchema } from "@symphoneer/contracts";
import { readSseFrames } from "../sse.ts";
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
  /** Delay before SSE reconnect. Default: exponential 250ms..10s. Use 0 in tests. */
  sseReconnectDelayMs?: number | ((attempt: number) => number);
}

export class HttpRuntimeTransport implements RuntimeTransport {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #token: string | undefined;
  readonly #sseReconnectDelayMs: number | ((attempt: number) => number) | undefined;

  constructor(options: HttpRuntimeTransportOptions) {
    const baseUrl = new URL(options.baseUrl);
    if (baseUrl.protocol !== "http:") {
      throw new RuntimeClientError(0, "invalid_url", "Runtime URL must use HTTP");
    }
    this.#baseUrl = baseUrl.href.replace(/\/$/, "");
    // Browsers reject unbound fetch when called as `this.#fetch(...)` ("Illegal invocation").
    const fetchImpl = options.fetch ?? fetch;
    this.#fetch = (input, init) => fetchImpl(input, init);
    this.#token = options.token;
    this.#sseReconnectDelayMs = options.sseReconnectDelayMs;
  }

  async request(request: RuntimeTransportRequest): Promise<unknown> {
    const url = this.#url(request.path, request.query);
    const init: RequestInit = {
      method: request.method,
      headers: {
        Accept: "application/json",
        ...this.#authHeaders(),
        ...request.headers,
        ...(request.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
    };
    if (request.body !== undefined) init.body = JSON.stringify(request.body);
    if (request.signal) init.signal = request.signal;
    let response: Response;
    try {
      response = await this.#fetch(url, init);
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

    const push = (event: RuntimeTransportEvent) => {
      queue.push(event);
      wake?.();
      wake = undefined;
    };

    const run = async () => {
      let after = readAfterSequence(request.query?.after);
      let attempt = 0;
      while (!closed && !controller.signal.aborted) {
        try {
          await this.#consumeSse(
            { ...request, query: { ...request.query, after } },
            controller.signal,
            (event) => {
              if (event.kind === "message" && event.event === "domain") {
                const sequence = readDomainSequence(event.data);
                if (sequence !== undefined && sequence > after) after = sequence;
              }
              if (!closed) push(event);
            },
          );
          attempt = 0;
        } catch (error) {
          if (controller.signal.aborted || closed) break;
          push({
            kind: "error",
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
        if (closed || controller.signal.aborted) break;
        const delay = resolveReconnectDelay(attempt, this.#sseReconnectDelayMs);
        attempt += 1;
        await sleep(delay, controller.signal);
      }
      if (!closed) push({ kind: "close" });
    };
    void run();

    const events: AsyncIterable<RuntimeTransportEvent> = {
      [Symbol.asyncIterator]: () => ({
        async next() {
          while (queue.length === 0 && !closed) {
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

    for await (const frame of readSseFrames(response.body)) {
      let data: unknown = frame.data;
      try {
        data = JSON.parse(frame.data);
      } catch {
        // keep raw string
      }
      push({ kind: "message", event: frame.event, data });
    }
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

function readAfterSequence(value: string | number | undefined): number {
  if (value === undefined) return 0;
  const sequence = typeof value === "number" ? value : Number(value);
  return Number.isInteger(sequence) && sequence >= 0 ? sequence : 0;
}

function readDomainSequence(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined;
  const sequence = (data as { sequence?: unknown }).sequence;
  return typeof sequence === "number" && Number.isInteger(sequence) && sequence > 0
    ? sequence
    : undefined;
}

function resolveReconnectDelay(
  attempt: number,
  configured: number | ((attempt: number) => number) | undefined,
): number {
  if (typeof configured === "function") return Math.max(0, configured(attempt));
  if (typeof configured === "number") return Math.max(0, configured);
  return Math.min(10_000, 250 * 2 ** attempt);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
