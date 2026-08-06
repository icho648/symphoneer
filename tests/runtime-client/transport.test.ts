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
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("HttpRuntimeTransport maps domain methods and typed errors", async () => {
  await withServer(async (request, response) => {
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
  }, async (baseUrl) => {
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
          kind: "pause_attempt",
          attemptId: "a1",
          idempotencyKey: "k1",
        }),
      (error: unknown) => error instanceof RuntimeClientError && error.code === "stale",
    );
  });
});

test("HttpRuntimeTransport subscribe delivers ordered SSE and closes", async () => {
  await withServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    assert.equal(url.pathname, "/v1/events/stream");
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    response.write(`event: snapshot\ndata: ${JSON.stringify(emptySnapshot(0))}\n\n`);
    response.write(
      `event: domain\ndata: ${JSON.stringify({
        sequence: 1,
        event: {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          id: "evt-1",
          type: "runtime.command.requested",
          occurredAt: "2026-08-06T00:00:00.000Z",
          source: "runtime",
          aggregate: { kind: "attempt", id: "attempt-1" },
          payload: {},
        },
      })}\n\n`,
    );
    response.end();
  }, async (baseUrl) => {
    const client = new DefaultRuntimeClient(new HttpRuntimeTransport({ baseUrl }));
    const subscription = client.subscribe({ afterSequence: 0 });
    const seen: string[] = [];
    for await (const event of subscription.events) {
      if (event.kind === "snapshot") seen.push("snapshot");
      if (event.kind === "domain") seen.push(`domain:${event.event.sequence}`);
      if (event.kind === "error") throw event.error;
    }
    assert.deepEqual(seen, ["snapshot", "domain:1"]);
  });
});

test("HttpRuntimeTransport rejects invalid JSON responses", async () => {
  await withServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end("{not-json");
  }, async (baseUrl) => {
    const transport = new HttpRuntimeTransport({ baseUrl });
    await assert.rejects(
      () => transport.request({ method: "GET", path: "/healthz" }),
      (error: unknown) =>
        error instanceof RuntimeClientError && error.code === "invalid_response",
    );
  });
});
