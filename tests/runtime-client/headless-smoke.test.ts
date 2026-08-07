import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RuntimeHttpServer, RuntimeService } from "@symphoneer/runtime";
import { DefaultRuntimeClient, HttpRuntimeTransport } from "@symphoneer/runtime-client";
import { createAssistantAdapter, executeRuntimeTool } from "../../src/runtime-tools/index.ts";

test("headless RuntimeClient supports query, mutation, and subscription without React/MCP", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "symphoneer-headless-"));
  const token = "headless-token-abcdefghijklmnopqrst";
  const service = new RuntimeService({ dataDir });
  const server = new RuntimeHttpServer(service, { sessionToken: token });
  const endpoint = await server.listen();
  try {
    const client = new DefaultRuntimeClient(
      new HttpRuntimeTransport({ baseUrl: endpoint.url, token }),
    );
    const health = await client.health();
    assert.equal(health.status, "ok");

    const subscription = client.subscribe({ afterSequence: 0 });
    const first = await subscription.events[Symbol.asyncIterator]().next();
    assert.equal(first.value?.kind, "snapshot");
    subscription.close();

    await assert.rejects(
      () =>
        executeRuntimeTool(client, "pause_attempt", { attemptId: "missing", idempotencyKey: "k" }),
      /requires confirmation/,
    );

    const assistant = createAssistantAdapter({});
    assert.equal(assistant.status().state, "disabled");
  } finally {
    await server.close();
  }
});
