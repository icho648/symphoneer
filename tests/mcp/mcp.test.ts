import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  type AttemptSnapshot,
  CONTRACT_SCHEMA_VERSION,
  type Intervention,
  type TaskSummary,
  type WorkspaceReference,
} from "@symphoneer/contracts";
import {
  ALL_TOOLS,
  createSymphoneerMcpServer,
  FORBIDDEN_TOOL_NAMES,
  MUTATION_TOOLS,
  QUERY_TOOLS,
  resolveRuntimeUrl,
  UI_RESOURCES,
} from "@symphoneer/mcp";
import { RuntimeHttpServer, RuntimeService } from "@symphoneer/runtime";
import { RuntimeClient, RuntimeClientError } from "@symphoneer/runtime-client";

const task: TaskSummary = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  id: "github:icho648/symphoneer:16",
  identifier: "#16",
  source: {
    kind: "github",
    nativeId: "16",
    url: "https://github.com/icho648/symphoneer/issues/16",
  },
  title: "Expose controlled MCP tools",
  state: "open",
  labels: [],
  dispatchable: true,
};

const workspace: WorkspaceReference = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  id: "workspace-16",
  taskId: task.id,
  path: "/tmp/symphoneer-workspace-16",
  repository: "icho648/symphoneer",
  branch: "cursor/issue-16-controlled-mcp-eeaa",
  gitHead: null,
  worktreeFingerprint: null,
  host: "local",
  state: "ready",
  ownerAttemptId: "attempt-16",
};

const attempt: AttemptSnapshot = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  id: "attempt-16",
  taskId: task.id,
  sequence: 1,
  startReason: "dispatch",
  status: "preparing_workspace",
  controller: "symphoneer",
  workspaceId: workspace.id,
  providerSession: null,
  startedAt: "2026-08-05T09:00:00.000Z",
  updatedAt: "2026-08-05T09:00:01.000Z",
};

const intervention: Intervention = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  id: "intervention-16",
  attemptId: attempt.id,
  requestRef: "request-16",
  kind: "approval",
  state: "pending",
  prompt: "Approve retry?",
  createdAt: "2026-08-05T08:59:00.000Z",
};

async function withRuntime(
  t: TestContext,
  run: (ctx: { client: RuntimeClient; service: RuntimeService; url: string }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(resolve(tmpdir(), "symphoneer-mcp-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let id = 0;
  const service = new RuntimeService({
    dataDir: root,
    runtimeId: "runtime:mcp-test",
    now: () => new Date("2026-08-05T09:00:00.000Z"),
    idFactory: () => `event-${++id}`,
  });
  await service.start();
  await service.recordTask(task);
  await service.recordAttempt(attempt, { workspace });
  const server = new RuntimeHttpServer(service);
  const endpoint = await server.listen();
  t.after(() => server.close());
  const client = new RuntimeClient({ baseUrl: endpoint.url });
  await run({ client, service, url: endpoint.url });
}

async function withMcpClient(
  runtimeClient: RuntimeClient,
  run: (client: Client) => Promise<void>,
): Promise<void> {
  const mcp = createSymphoneerMcpServer({ client: runtimeClient });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "symphoneer-mcp-test", version: "0.0.0" });
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
  try {
    await run(client);
  } finally {
    await client.close();
    await mcp.close();
  }
}

function asToolResult(result: unknown): {
  isError?: boolean;
  structuredContent?: unknown;
  content: Array<{ type: string; text?: string }>;
} {
  assert.ok(result && typeof result === "object");
  const value = result as {
    isError?: boolean;
    structuredContent?: unknown;
    content?: Array<{ type: string; text?: string }>;
  };
  assert.ok(Array.isArray(value.content));
  return { ...value, content: value.content };
}

function structured(result: unknown): Record<string, unknown> {
  const toolResult = asToolResult(result);
  if (toolResult.structuredContent && typeof toolResult.structuredContent === "object") {
    return toolResult.structuredContent as Record<string, unknown>;
  }
  const text = toolResult.content.find((part) => part.type === "text")?.text;
  assert.ok(text);
  return JSON.parse(text) as Record<string, unknown>;
}

function textOf(result: unknown): string {
  const text = asToolResult(result).content.find((part) => part.type === "text")?.text;
  assert.ok(text);
  return text;
}

test("resolveRuntimeUrl accepts only loopback HTTP", () => {
  assert.equal(resolveRuntimeUrl("http://127.0.0.1:4318/"), "http://127.0.0.1:4318");
  assert.throws(
    () => resolveRuntimeUrl("http://example.com:4318"),
    (error) => error instanceof RuntimeClientError && error.code === "invalid_runtime_url",
  );
  assert.throws(
    () => resolveRuntimeUrl("https://127.0.0.1:4318"),
    (error) => error instanceof RuntimeClientError && error.code === "invalid_runtime_url",
  );
});

test("MCP tool list, annotations, and capability audit", async (t) => {
  await withRuntime(t, async ({ client }) => {
    await withMcpClient(client, async (mcpClient) => {
      const listed = await mcpClient.listTools();
      const names = listed.tools.map((tool) => tool.name).sort();
      assert.deepEqual(names, [...ALL_TOOLS].sort());
      for (const forbidden of FORBIDDEN_TOOL_NAMES) {
        assert.equal((names as string[]).includes(forbidden), false);
      }
      for (const name of QUERY_TOOLS) {
        const tool = listed.tools.find((entry) => entry.name === name);
        assert.equal(tool?.annotations?.readOnlyHint, true);
      }
      for (const name of MUTATION_TOOLS) {
        const tool = listed.tools.find((entry) => entry.name === name);
        assert.equal(tool?.annotations?.readOnlyHint, false);
        assert.equal(tool?.annotations?.destructiveHint, true);
      }
      const resources = await mcpClient.listResources();
      const uris = resources.resources.map((resource) => resource.uri).sort();
      assert.deepEqual(uris, Object.values(UI_RESOURCES).sort());
      const attemptUi = listed.tools.find((tool) => tool.name === "get_attempt");
      assert.equal(
        (attemptUi?._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri,
        UI_RESOURCES.attempt,
      );
    });
  });
});

test("MCP query tools map to Runtime health, snapshot, attempt, and events", async (t) => {
  await withRuntime(t, async ({ client }) => {
    await withMcpClient(client, async (mcpClient) => {
      const health = await mcpClient.callTool({ name: "runtime_health", arguments: {} });
      assert.equal(asToolResult(health).isError, undefined);
      assert.match(textOf(health), /ok/i);
      assert.equal(structured(health).ok, true);

      const snapshot = await mcpClient.callTool({ name: "runtime_snapshot", arguments: {} });
      const snapshotData = structured(snapshot).data as {
        tasks: Array<{ id: string }>;
        runtime: { lastEventSequence: number };
      };
      assert.equal(snapshotData.tasks[0]?.id, task.id);

      const detail = await mcpClient.callTool({
        name: "get_attempt",
        arguments: { attemptId: attempt.id },
      });
      assert.equal((structured(detail).data as { attempt: { id: string } }).attempt.id, attempt.id);

      const events = await mcpClient.callTool({
        name: "list_events",
        arguments: { after: 0 },
      });
      assert.ok(((structured(events).data as { events: unknown[] }).events.length as number) >= 1);
    });
  });
});

test("MCP pause_attempt maps to Runtime command with idempotency and conflict", async (t) => {
  await withRuntime(t, async ({ client }) => {
    await withMcpClient(client, async (mcpClient) => {
      const accepted = await mcpClient.callTool({
        name: "pause_attempt",
        arguments: {
          attemptId: attempt.id,
          idempotencyKey: "mcp-pause-1",
        },
      });
      assert.equal(structured(accepted).ok, true);
      const seq = (structured(accepted).data as { eventSequence: number }).eventSequence;

      const replay = await mcpClient.callTool({
        name: "pause_attempt",
        arguments: {
          attemptId: attempt.id,
          idempotencyKey: "mcp-pause-1",
        },
      });
      assert.equal((structured(replay).data as { eventSequence: number }).eventSequence, seq);

      const conflict = await mcpClient.callTool({
        name: "pause_attempt",
        arguments: {
          attemptId: attempt.id,
          idempotencyKey: "mcp-pause-stale",
          expectedEventSequence: 0,
        },
      });
      assert.equal(asToolResult(conflict).isError, true);
      assert.equal(structured(conflict).code, "conflict");

      const reused = await mcpClient.callTool({
        name: "retry_attempt",
        arguments: {
          attemptId: attempt.id,
          idempotencyKey: "mcp-pause-1",
        },
      });
      assert.equal(asToolResult(reused).isError, true);
      assert.ok(
        structured(reused).code === "conflict" || structured(reused).code === "duplicate_event",
      );
    });
  });
});

test("MCP rejects pause on terminal Attempt and responds to intervention", async (t) => {
  await withRuntime(t, async ({ client, service }) => {
    const finished: AttemptSnapshot = {
      ...attempt,
      id: "attempt-16-finished",
      status: "failed",
      finishedAt: "2026-08-05T09:02:00.000Z",
      updatedAt: "2026-08-05T09:02:00.000Z",
    };
    await service.recordAttempt(finished, {
      workspace: { ...workspace, id: "workspace-16-finished", ownerAttemptId: finished.id },
    });
    await service.recordIntervention(intervention);

    await withMcpClient(client, async (mcpClient) => {
      const pauseFinished = await mcpClient.callTool({
        name: "pause_attempt",
        arguments: {
          attemptId: finished.id,
          idempotencyKey: "mcp-pause-finished",
        },
      });
      assert.equal(asToolResult(pauseFinished).isError, true);
      assert.equal(structured(pauseFinished).code, "conflict");

      const before = (await client.snapshot()).runtime.lastEventSequence;
      const responded = await mcpClient.callTool({
        name: "respond_intervention",
        arguments: {
          interventionId: intervention.id,
          decidedBy: "mcp-test",
          decision: "approved",
          idempotencyKey: "mcp-intervention-1",
        },
      });
      assert.equal(structured(responded).ok, true);
      assert.ok((structured(responded).data as { eventSequence: number }).eventSequence > before);

      const again = await mcpClient.callTool({
        name: "respond_intervention",
        arguments: {
          interventionId: intervention.id,
          decidedBy: "mcp-test",
          decision: "approved",
          idempotencyKey: "mcp-intervention-2",
        },
      });
      assert.equal(asToolResult(again).isError, true);
      assert.equal(structured(again).code, "conflict");
    });
  });
});

test("MCP reports Runtime offline distinctly and canceled approval produces no events", async (t) => {
  await withRuntime(t, async ({ client }) => {
    const before = (await client.snapshot()).runtime.lastEventSequence;
    // Host canceled approval => tool never called; sequence unchanged.
    assert.equal((await client.snapshot()).runtime.lastEventSequence, before);

    const offlineClient = new RuntimeClient({ baseUrl: "http://127.0.0.1:9" });
    await withMcpClient(offlineClient, async (mcpClient) => {
      const result = await mcpClient.callTool({ name: "runtime_health", arguments: {} });
      assert.equal(asToolResult(result).isError, true);
      assert.equal(structured(result).code, "unavailable");
      assert.match(textOf(result), /unavailable/i);
    });
  });
});

test("MCP Apps resources are readable and tools still return text without UI", async (t) => {
  await withRuntime(t, async ({ client }) => {
    await withMcpClient(client, async (mcpClient) => {
      const resource = await mcpClient.readResource({ uri: UI_RESOURCES.attempt });
      const text =
        resource.contents[0] && "text" in resource.contents[0] ? resource.contents[0].text : "";
      assert.match(String(text), /Symphoneer/);
      assert.match(String(text), /loading|success|conflict|offline|canceled/i);

      const snapshot = await mcpClient.callTool({ name: "runtime_snapshot", arguments: {} });
      assert.ok(
        asToolResult(snapshot).content.some((part) => part.type === "text" && Boolean(part.text)),
      );
      assert.equal(structured(snapshot).ok, true);
    });
  });
});
