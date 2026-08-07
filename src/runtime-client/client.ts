import {
  type RuntimeAttemptDetail,
  RuntimeAttemptDetailSchema,
  type RuntimeCommand,
  type RuntimeCommandResult,
  RuntimeCommandResultSchema,
  type RuntimeEvent,
  RuntimeEventSchema,
  type RuntimeHealth,
  RuntimeHealthSchema,
  type RuntimeSnapshot,
  RuntimeSnapshotSchema,
  type TaskSummary,
} from "@symphoneer/contracts";
import { RuntimeClientError } from "./errors.ts";
import { HttpRuntimeTransport } from "./http-transport.ts";
import type { RuntimeTransport } from "./transport.ts";

export interface RuntimeSubscriptionInput {
  afterSequence?: number;
  signal?: AbortSignal;
}

export type RuntimeSubscriptionEvent =
  | { kind: "snapshot"; snapshot: RuntimeSnapshot }
  | { kind: "domain"; event: RuntimeEvent }
  | { kind: "error"; error: Error };

export interface RuntimeSubscription {
  readonly events: AsyncIterable<RuntimeSubscriptionEvent>;
  close(): void;
}

export type PauseAttemptInput = Omit<Extract<RuntimeCommand, { kind: "pause_attempt" }>, "kind">;
export type RetryAttemptInput = Omit<Extract<RuntimeCommand, { kind: "retry_attempt" }>, "kind">;
export type RespondInterventionInput = Omit<
  Extract<RuntimeCommand, { kind: "respond_intervention" }>,
  "kind"
>;
export type StartTeamRunInput = Omit<Extract<RuntimeCommand, { kind: "start_team_run" }>, "kind">;

export class DefaultRuntimeClient {
  readonly #transport: RuntimeTransport;

  constructor(transport: RuntimeTransport) {
    this.#transport = transport;
  }

  async health(): Promise<RuntimeHealth> {
    return this.#parse(
      await this.#transport.request({ method: "GET", path: "/healthz" }),
      RuntimeHealthSchema,
    );
  }

  async snapshot(): Promise<RuntimeSnapshot> {
    return this.#parse(
      await this.#transport.request({ method: "GET", path: "/v1/snapshot" }),
      RuntimeSnapshotSchema,
    );
  }

  async listTasks(): Promise<TaskSummary[]> {
    const snapshot = await this.snapshot();
    return snapshot.tasks;
  }

  async getAttempt(attemptId: string): Promise<RuntimeAttemptDetail> {
    return this.#parse(
      await this.#transport.request({
        method: "GET",
        path: `/v1/attempts/${encodeURIComponent(attemptId)}`,
      }),
      RuntimeAttemptDetailSchema,
    );
  }

  /** @deprecated Prefer getAttempt */
  attempt(attemptId: string): Promise<RuntimeAttemptDetail> {
    return this.getAttempt(attemptId);
  }

  async listEvents(afterSequence = 0): Promise<{ events: RuntimeEvent[] }> {
    const body = await this.#transport.request({
      method: "GET",
      path: "/v1/events",
      query: { after: afterSequence },
    });
    if (
      !body ||
      typeof body !== "object" ||
      !Array.isArray((body as { events?: unknown }).events)
    ) {
      throw new RuntimeClientError(
        200,
        "invalid_response",
        "Runtime returned an invalid event list",
      );
    }
    const events = (body as { events: unknown[] }).events.map((event) =>
      this.#parse(event, RuntimeEventSchema),
    );
    return { events };
  }

  /** @deprecated Prefer listEvents */
  events(afterSequence = 0): Promise<{ events: RuntimeEvent[] }> {
    return this.listEvents(afterSequence);
  }

  async execute(command: RuntimeCommand): Promise<RuntimeCommandResult> {
    return this.#parse(
      await this.#transport.request({
        method: "POST",
        path: "/v1/commands",
        body: command,
      }),
      RuntimeCommandResultSchema,
    );
  }

  /** @deprecated Prefer domain methods or execute */
  command(command: RuntimeCommand): Promise<RuntimeCommandResult> {
    return this.execute(command);
  }

  pauseAttempt(input: PauseAttemptInput): Promise<RuntimeCommandResult> {
    return this.execute({ ...input, kind: "pause_attempt" });
  }

  retryAttempt(input: RetryAttemptInput): Promise<RuntimeCommandResult> {
    return this.execute({ ...input, kind: "retry_attempt" });
  }

  respondToIntervention(input: RespondInterventionInput): Promise<RuntimeCommandResult> {
    return this.execute({ ...input, kind: "respond_intervention" });
  }

  startTeamRun(input: StartTeamRunInput): Promise<RuntimeCommandResult> {
    return this.execute({ ...input, kind: "start_team_run" });
  }

  subscribe(input: RuntimeSubscriptionInput = {}): RuntimeSubscription {
    const transportSub = this.#transport.subscribe({
      path: "/v1/events/stream",
      query: { after: input.afterSequence ?? 0 },
      ...(input.signal ? { signal: input.signal } : {}),
    });

    const events: AsyncIterable<RuntimeSubscriptionEvent> = {
      [Symbol.asyncIterator]: () => {
        const iterator = transportSub.events[Symbol.asyncIterator]();
        return {
          async next() {
            while (true) {
              const result = await iterator.next();
              if (result.done) return { value: undefined, done: true as const };
              const item = result.value;
              if (item.kind === "close") return { value: undefined, done: true as const };
              if (item.kind === "error") {
                return { value: { kind: "error", error: item.error }, done: false as const };
              }
              if (item.event === "snapshot") {
                try {
                  return {
                    value: {
                      kind: "snapshot",
                      snapshot: RuntimeSnapshotSchema.parse(item.data),
                    },
                    done: false as const,
                  };
                } catch {
                  return {
                    value: {
                      kind: "error",
                      error: new RuntimeClientError(
                        200,
                        "invalid_response",
                        "Invalid snapshot event",
                      ),
                    },
                    done: false as const,
                  };
                }
              }
              if (item.event === "domain") {
                try {
                  return {
                    value: {
                      kind: "domain",
                      event: RuntimeEventSchema.parse(item.data),
                    },
                    done: false as const,
                  };
                } catch {
                  return {
                    value: {
                      kind: "error",
                      error: new RuntimeClientError(
                        200,
                        "invalid_response",
                        "Invalid domain event",
                      ),
                    },
                    done: false as const,
                  };
                }
              }
            }
          },
        };
      },
    };

    return {
      events,
      close: () => transportSub.close(),
    };
  }

  #parse<T>(value: unknown, schema: { parse(value: unknown): T }): T {
    try {
      return schema.parse(value);
    } catch {
      throw new RuntimeClientError(200, "invalid_response", "Runtime returned an invalid response");
    }
  }
}

export function createHttpRuntimeClient(options: {
  baseUrl: string;
  fetch?: typeof fetch;
  token?: string;
}): DefaultRuntimeClient {
  return new DefaultRuntimeClient(
    new HttpRuntimeTransport({
      baseUrl: options.baseUrl,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.token ? { token: options.token } : {}),
    }),
  );
}

/** Historical alias: accepts transport or `{ baseUrl }`. */
export class RuntimeClient extends DefaultRuntimeClient {
  constructor(
    transportOrOptions:
      | RuntimeTransport
      | { baseUrl: string; fetch?: typeof fetch; token?: string },
  ) {
    if (isTransport(transportOrOptions)) {
      super(transportOrOptions);
      return;
    }
    super(
      new HttpRuntimeTransport({
        baseUrl: transportOrOptions.baseUrl,
        ...(transportOrOptions.fetch ? { fetch: transportOrOptions.fetch } : {}),
        ...(transportOrOptions.token ? { token: transportOrOptions.token } : {}),
      }),
    );
  }
}

function isTransport(
  value: RuntimeTransport | { baseUrl: string; fetch?: typeof fetch; token?: string },
): value is RuntimeTransport {
  return typeof (value as RuntimeTransport).request === "function";
}
