export type RuntimeTransportMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RuntimeTransportRequest {
  method: RuntimeTransportMethod;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface RuntimeSubscriptionRequest {
  path: string;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface RuntimeTransportSubscription {
  readonly events: AsyncIterable<RuntimeTransportEvent>;
  close(): void;
}

export type RuntimeTransportEvent =
  | { kind: "message"; event: string; data: unknown }
  | { kind: "error"; error: Error }
  | { kind: "close" };

export interface RuntimeTransport {
  request(request: RuntimeTransportRequest): Promise<unknown>;
  subscribe(request: RuntimeSubscriptionRequest): RuntimeTransportSubscription;
}
