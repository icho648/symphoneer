import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";

import {
  CONTRACT_SCHEMA_VERSION,
  PROJECTION_SCHEMA_VERSION,
  type RuntimeHealth,
  type RuntimeSnapshot,
} from "@symphoneer/contracts";
import {
  DefaultRuntimeClient,
  HttpRuntimeTransport,
  RuntimeClientError,
} from "../../src/runtime-client/index.ts";

function emptySnapshot(sequence = 0): RuntimeSnapshot {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    projectionVersion: PROJECTION_SCHEMA_VERSION,
    runtime: {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      status: "online",
      runtimeId: "runtime-test",
      endpoint: "http://127.0.0.1:0",
      startedAt: "2026-08-06T00:00:00.000Z",
      lastEventSequence: sequence,
    },
    tasks: [],
    attempts: [],
    verifications: [],
    reviews: [],
    interventions: [],
    teamRuns: [],
    agentRuns: [],
    teamEvents: [],
  };
}

function health(): RuntimeHealth {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    status: "ok",
    runtime: emptySnapshot().runtime,
    process: {
      status: "running",
      pid: 1,
      nodeVersion: process.version,
      startedAt: "2026-08-06T00:00:00.000Z",
      uptimeSeconds: 1,
    },
  };
}

async function withServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch(() => {
      response.statusCode = 500;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("HttpRuntimeTransport maps domain methods and typed errors", async () => {
  await withServer(
    async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/healthz") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(health()));
        return;
      }
      if (url.pathname === "/v1/snapshot") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(emptySnapshot()));
        return;
      }
      if (url.pathname === "/v1/attempts/missing") {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            code: "not_found",
            message: "Attempt was not found",
            retryable: false,
          }),
        );
        return;
      }
      if (url.pathname === "/v1/commands") {
        response.writeHead(409, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            code: "conflict",
            message: "stale expectedEventSequence",
            retryable: false,
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end();
    },
    async (baseUrl) => {
      const client = new DefaultRuntimeClient(new HttpRuntimeTransport({ baseUrl }));
      assert.equal((await client.health()).status, "ok");
      assert.equal((await client.snapshot()).tasks.length, 0);
      await assert.rejects(
        () => client.getAttempt("missing"),
        (error: unknown) => error instanceof RuntimeClientError && error.code === "not_found",
      );
      await assert.rejects(
        () =>
          client.pauseAttempt({
            attemptId: "a1",
            idempotencyKey: "k1",
          }),
        (error: unknown) => error instanceof RuntimeClientError && error.code === "stale",
      );
    },
  );
});

function domainEvent(sequence: number, id: string) {
  return {
    sequence,
    event: {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      id,
      type: "runtime.command.requested",
      occurredAt: "2026-08-06T00:00:00.000Z",
      source: "runtime",
      aggregate: { kind: "attempt", id: "attempt-1" },
      payload: {},
    },
  };
}

function writeSse(response: ServerResponse, event: string, data: unknown): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

test("HttpRuntimeTransport subscribe delivers ordered SSE and closes", async () => {
  await withServer(
    (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      assert.equal(url.pathname, "/v1/events/stream");
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      writeSse(response, "snapshot", emptySnapshot(0));
      writeSse(response, "domain", domainEvent(1, "evt-1"));
      // Keep the stream open; subscription.close() terminates the consumer.
    },
    async (baseUrl) => {
      const client = new DefaultRuntimeClient(new HttpRuntimeTransport({ baseUrl }));
      const subscription = client.subscribe({ afterSequence: 0 });
      const seen: string[] = [];
      for await (const event of subscription.events) {
        if (event.kind === "snapshot") seen.push("snapshot");
        if (event.kind === "domain") seen.push(`domain:${event.event.sequence}`);
        if (event.kind === "error") throw event.error;
        if (seen.length >= 2) {
          subscription.close();
          break;
        }
      }
      assert.deepEqual(seen, ["snapshot", "domain:1"]);
    },
  );
});

test("HttpRuntimeTransport reconnects SSE after disconnect without duplicate or gap", async () => {
  let connections = 0;
  await withServer(
    (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      assert.equal(url.pathname, "/v1/events/stream");
      const after = Number(url.searchParams.get("after") ?? "0");
      connections += 1;
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      if (connections === 1) {
        assert.equal(after, 0);
        writeSse(response, "snapshot", emptySnapshot(0));
        writeSse(response, "domain", domainEvent(1, "evt-1"));
        response.end();
        return;
      }
      assert.equal(after, 1);
      writeSse(response, "snapshot", emptySnapshot(1));
      writeSse(response, "domain", domainEvent(2, "evt-2"));
      // Stay open until the client closes after observing sequence 2.
    },
    async (baseUrl) => {
      const client = new DefaultRuntimeClient(
        new HttpRuntimeTransport({ baseUrl, sseReconnectDelayMs: 0 }),
      );
      const subscription = client.subscribe({ afterSequence: 0 });
      const seen: string[] = [];
      for await (const event of subscription.events) {
        if (event.kind === "error") continue;
        if (event.kind === "snapshot")
          seen.push(`snapshot:${event.snapshot.runtime.lastEventSequence}`);
        if (event.kind === "domain") seen.push(`domain:${event.event.sequence}`);
        if (seen.includes("domain:2")) {
          subscription.close();
          break;
        }
      }
      assert.equal(connections, 2);
      assert.deepEqual(seen, ["snapshot:0", "domain:1", "snapshot:1", "domain:2"]);
    },
  );
});

test("HttpRuntimeTransport rejects invalid JSON responses", async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("{not-json");
    },
    async (baseUrl) => {
      const transport = new HttpRuntimeTransport({ baseUrl });
      await assert.rejects(
        () => transport.request({ method: "GET", path: "/healthz" }),
        (error: unknown) =>
          error instanceof RuntimeClientError && error.code === "invalid_response",
      );
    },
  );
});

test("HttpRuntimeTransport keeps fetch this-binding safe for browsers", async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(health()));
    },
    async (baseUrl) => {
      const browserLikeFetch: typeof fetch = function browserLikeFetch(
        this: unknown,
        input: RequestInfo | URL,
        init?: RequestInit,
      ) {
        if (this !== undefined && this !== globalThis) {
          throw new TypeError("Illegal invocation");
        }
        return fetch(input, init);
      };

      const transport = new HttpRuntimeTransport({
        baseUrl,
        fetch: browserLikeFetch,
      });
      const body = (await transport.request({ method: "GET", path: "/healthz" })) as RuntimeHealth;
      assert.equal(body.status, "ok");
    },
  );
});
