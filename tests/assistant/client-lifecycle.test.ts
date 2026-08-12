import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Models,
} from "@earendil-works/pi-ai";
import {
  createNodeSqliteFactory,
  SqliteSessionRepository,
} from "@earendil-works/pi-session-backend-sqlite-node";
import { PiAssistantService } from "../../src/assistant/index.ts";
import { createHttpAssistantClient } from "../../src/assistant-client/index.ts";
import { RuntimeHttpServer, RuntimeService } from "../../src/runtime/index.ts";
import { createHttpRuntimeClient } from "../../src/runtime-client/index.ts";

test("AssistantClient hides empty HTTP response parse errors", async () => {
  const client = createHttpAssistantClient({
    baseUrl: "http://127.0.0.1:4318",
    fetch: async () => new Response("", { status: 503 }),
  });

  await assert.rejects(() => client.status(), { message: "Assistant request failed" });
});

test("Runtime stays available when Assistant config is missing", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "symphoneer-assistant-disabled-"));
  const assistant = new PiAssistantService({ dataDir, env: {} });
  const server = new RuntimeHttpServer(new RuntimeService({ dataDir: join(dataDir, "runtime") }), {
    assistantHandler: assistant.handle,
    sessionToken: "test-token",
  });

  try {
    const endpoint = await server.listen();
    const client = createHttpAssistantClient({
      baseUrl: endpoint.url,
      token: "test-token",
    });

    assert.deepEqual(await client.status(), {
      state: "disabled",
      reason: "missing_config",
    });
    assert.equal((await fetch(`${endpoint.url}/healthz`)).status, 200);
  } finally {
    await assistant.close();
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Invalid Assistant config and provider initialization failure do not stop Runtime", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "symphoneer-assistant-status-"));
  const models = createModels();
  const invalid = new PiAssistantService({
    dataDir: join(dataDir, "invalid"),
    models,
    env: {
      SYMPHONEER_ASSISTANT_PROVIDER: "missing",
      SYMPHONEER_ASSISTANT_MODEL: "missing",
      SYMPHONEER_ASSISTANT_API_KEY: "credential-must-not-persist",
    },
  });
  const brokenModels = {
    getModel() {
      throw new Error("provider initialization failed");
    },
  } as unknown as Models;
  const failed = new PiAssistantService({
    dataDir: join(dataDir, "failed"),
    models: brokenModels,
    env: {
      SYMPHONEER_ASSISTANT_PROVIDER: "broken",
      SYMPHONEER_ASSISTANT_MODEL: "broken",
      SYMPHONEER_ASSISTANT_API_KEY: "credential-must-not-persist",
    },
  });
  const server = new RuntimeHttpServer(new RuntimeService({ dataDir: join(dataDir, "runtime") }), {
    assistantHandler: invalid.handle,
    sessionToken: "test-token",
  });

  try {
    const endpoint = await server.listen();
    const client = createHttpAssistantClient({ baseUrl: endpoint.url, token: "test-token" });
    assert.equal((await client.status()).state, "invalid_config");
    assert.equal((await failed.status()).state, "provider_failure");
    assert.equal((await fetch(`${endpoint.url}/healthz`)).status, 200);
  } finally {
    await invalid.close();
    await failed.close();
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("AssistantClient manages persistent sessions through the loopback API", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "symphoneer-assistant-sessions-"));
  const env = {
    SYMPHONEER_ASSISTANT_PROVIDER: "faux",
    SYMPHONEER_ASSISTANT_MODEL: "test-model",
    SYMPHONEER_ASSISTANT_API_KEY: "credential-must-not-persist",
  };

  const start = async (runtimeName: string) => {
    const faux = fauxProvider({ provider: "faux", models: [{ id: "test-model" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const assistant = new PiAssistantService({ dataDir, env, models });
    const server = new RuntimeHttpServer(
      new RuntimeService({ dataDir: join(dataDir, runtimeName) }),
      { assistantHandler: assistant.handle, sessionToken: "test-token" },
    );
    const endpoint = await server.listen();
    return {
      assistant,
      server,
      baseUrl: endpoint.url,
      client: createHttpAssistantClient({ baseUrl: endpoint.url, token: "test-token" }),
      runtimeClient: createHttpRuntimeClient({ baseUrl: endpoint.url, token: "test-token" }),
    };
  };

  let host = await start("runtime-1");
  try {
    const created = await host.client.createSession({
      createdBy: "web",
      taskId: "task-45",
      locale: "zh-CN",
    });
    assert.equal(created.provider, "faux");
    assert.equal(created.model, "test-model");
    assert.equal(created.metadata.taskId, "task-45");
    assert.deepEqual(await host.client.listSessions(), [created]);

    const renamed = await host.client.renameSession(created.id, "Issue 45");
    assert.equal(renamed.name, "Issue 45");
    assert.deepEqual((await host.client.openSession(created.id)).messages, []);
    await stat(join(dataDir, "assistant", "sessions.sqlite"));

    await host.assistant.close();
    await host.server.close();
    host = await start("runtime-2");

    const headlessClient = createHttpAssistantClient({
      baseUrl: host.baseUrl,
      token: "test-token",
    });
    assert.equal((await headlessClient.openSession(created.id)).name, "Issue 45");
    const runtimeEvents = await host.runtimeClient.listEvents();
    await headlessClient.deleteSession(created.id);
    assert.deepEqual(await headlessClient.listSessions(), []);
    assert.deepEqual(await host.runtimeClient.listEvents(), runtimeEvents);
  } finally {
    await host.assistant.close();
    await host.server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("AssistantClient streams Pi text and reopens the persisted conversation", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "symphoneer-assistant-stream-"));
  const faux = fauxProvider({
    provider: "faux",
    models: [{ id: "test-model" }],
    tokenSize: { min: 2, max: 2 },
  });
  faux.setResponses([fauxAssistantMessage("hello from Pi")]);
  const models = createModels();
  models.setProvider(faux.provider);
  const assistant = new PiAssistantService({
    dataDir,
    models,
    env: {
      SYMPHONEER_ASSISTANT_PROVIDER: "faux",
      SYMPHONEER_ASSISTANT_MODEL: "test-model",
      SYMPHONEER_ASSISTANT_API_KEY: "credential-must-not-persist",
    },
  });
  const server = new RuntimeHttpServer(new RuntimeService({ dataDir: join(dataDir, "runtime") }), {
    assistantHandler: assistant.handle,
    sessionToken: "test-token",
  });

  try {
    const endpoint = await server.listen();
    const client = createHttpAssistantClient({ baseUrl: endpoint.url, token: "test-token" });
    const session = await client.createSession({ createdBy: "web", taskId: "task-45" });
    const events = [];
    for await (const event of client.run(session.id, "hello")) events.push(event);

    assert.equal(
      events
        .filter((event) => event.type === "text_delta")
        .map((event) => event.delta)
        .join(""),
      "hello from Pi",
    );
    assert.equal(events.at(-1)?.type, "completed", JSON.stringify(events));

    const reopened = await client.openSession(session.id);
    assert.deepEqual(
      reopened.messages.map((message) => message.role),
      ["user", "assistant"],
    );
    assert.deepEqual(reopened.messages[1]?.parts, [{ type: "text", text: "hello from Pi" }]);
    assert.equal(
      (await readFile(join(dataDir, "assistant", "sessions.sqlite"))).includes(
        Buffer.from("credential-must-not-persist"),
      ),
      false,
    );
    assert.equal(
      JSON.stringify(await client.listSessions()).includes("credential-must-not-persist"),
      false,
    );
  } finally {
    await assistant.close();
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Provider errors cannot expose the configured credential in events or SQLite", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "symphoneer-assistant-redaction-"));
  const credential = "credential-must-not-persist";
  const faux = fauxProvider({ provider: "faux", models: [{ id: "test-model" }] });
  faux.setResponses([
    fauxAssistantMessage(`Provider echoed ${credential}`, {
      stopReason: "error",
      errorMessage: `Provider rejected ${credential}`,
    }),
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const assistant = new PiAssistantService({
    dataDir,
    models,
    env: {
      SYMPHONEER_ASSISTANT_PROVIDER: "faux",
      SYMPHONEER_ASSISTANT_MODEL: "test-model",
      SYMPHONEER_ASSISTANT_API_KEY: credential,
    },
  });
  const server = new RuntimeHttpServer(new RuntimeService({ dataDir: join(dataDir, "runtime") }), {
    assistantHandler: assistant.handle,
    sessionToken: "test-token",
  });

  try {
    const endpoint = await server.listen();
    const client = createHttpAssistantClient({ baseUrl: endpoint.url, token: "test-token" });
    const session = await client.createSession({ createdBy: "web" });
    const events = [];
    for await (const event of client.run(session.id, "fail")) events.push(event);

    assert.equal(JSON.stringify(events).includes(credential), false);
    assert.equal(
      events
        .filter((event) => event.type === "text_delta")
        .map((event) => event.delta)
        .join("")
        .includes(credential),
      false,
    );
    assert.equal(JSON.stringify(await client.openSession(session.id)).includes(credential), false);
    assert.equal(
      (await readFile(join(dataDir, "assistant", "sessions.sqlite"))).includes(
        Buffer.from(credential),
      ),
      false,
    );
  } finally {
    await assistant.close();
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Aborting a run preserves the session for a later prompt", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "symphoneer-assistant-abort-"));
  const faux = fauxProvider({
    provider: "faux",
    models: [{ id: "test-model" }],
    tokensPerSecond: 20,
    tokenSize: { min: 1, max: 1 },
  });
  faux.setResponses([
    fauxAssistantMessage("This response is intentionally long enough to abort while streaming."),
    fauxAssistantMessage("continued"),
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const assistant = new PiAssistantService({
    dataDir,
    models,
    env: {
      SYMPHONEER_ASSISTANT_PROVIDER: "faux",
      SYMPHONEER_ASSISTANT_MODEL: "test-model",
      SYMPHONEER_ASSISTANT_API_KEY: "credential-must-not-persist",
    },
  });
  const server = new RuntimeHttpServer(new RuntimeService({ dataDir: join(dataDir, "runtime") }), {
    assistantHandler: assistant.handle,
    sessionToken: "test-token",
  });

  try {
    const endpoint = await server.listen();
    const client = createHttpAssistantClient({ baseUrl: endpoint.url, token: "test-token" });
    const session = await client.createSession({ createdBy: "web" });
    const firstEvents = [];
    let stopped = false;
    for await (const event of client.run(session.id, "start")) {
      firstEvents.push(event);
      if (!stopped && event.type === "text_delta") {
        stopped = true;
        await client.abort(session.id);
      }
    }
    assert.equal(firstEvents.at(-1)?.type, "aborted");
    assert.equal(
      firstEvents.some((event) => event.type === "completed"),
      false,
    );

    const secondEvents = [];
    for await (const event of client.run(session.id, "continue")) secondEvents.push(event);
    assert.equal(secondEvents.at(-1)?.type, "completed");
    assert.equal(
      secondEvents
        .filter((event) => event.type === "text_delta")
        .map((event) => event.delta)
        .join(""),
      "continued",
    );
  } finally {
    await assistant.close();
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("A session rejects a second concurrent run", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "symphoneer-assistant-concurrent-"));
  const faux = fauxProvider({
    provider: "faux",
    models: [{ id: "test-model" }],
    tokensPerSecond: 10,
    tokenSize: { min: 1, max: 1 },
  });
  faux.setResponses([fauxAssistantMessage("a deliberately slow response")]);
  const models = createModels();
  models.setProvider(faux.provider);
  const assistant = new PiAssistantService({
    dataDir,
    models,
    env: {
      SYMPHONEER_ASSISTANT_PROVIDER: "faux",
      SYMPHONEER_ASSISTANT_MODEL: "test-model",
      SYMPHONEER_ASSISTANT_API_KEY: "credential-must-not-persist",
    },
  });
  const server = new RuntimeHttpServer(new RuntimeService({ dataDir: join(dataDir, "runtime") }), {
    assistantHandler: assistant.handle,
    sessionToken: "test-token",
  });

  try {
    const endpoint = await server.listen();
    const client = createHttpAssistantClient({ baseUrl: endpoint.url, token: "test-token" });
    const session = await client.createSession({ createdBy: "web" });
    const firstRun = client.run(session.id, "first")[Symbol.asyncIterator]();
    assert.equal((await firstRun.next()).done, false);
    await assert.rejects(async () => {
      for await (const _event of client.run(session.id, "second")) {
        // request is expected to fail before streaming
      }
    }, /active run/);
    await client.abort(session.id);
    while (!(await firstRun.next()).done) {
      // drain the aborted run
    }
  } finally {
    await assistant.close();
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("A restarted process restores and continues the same Assistant session", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "symphoneer-assistant-restart-"));
  const start = async (runtimeName: string, responseText: string) => {
    const faux = fauxProvider({ provider: "faux", models: [{ id: "test-model" }] });
    faux.setResponses([fauxAssistantMessage(responseText)]);
    const models = createModels();
    models.setProvider(faux.provider);
    const assistant = new PiAssistantService({
      dataDir,
      models,
      env: {
        SYMPHONEER_ASSISTANT_PROVIDER: "faux",
        SYMPHONEER_ASSISTANT_MODEL: "test-model",
        SYMPHONEER_ASSISTANT_API_KEY: "credential-must-not-persist",
      },
    });
    const server = new RuntimeHttpServer(
      new RuntimeService({ dataDir: join(dataDir, runtimeName) }),
      { assistantHandler: assistant.handle, sessionToken: "test-token" },
    );
    const endpoint = await server.listen();
    return {
      assistant,
      server,
      client: createHttpAssistantClient({ baseUrl: endpoint.url, token: "test-token" }),
    };
  };

  let host = await start("runtime-1", "before restart");
  try {
    const created = await host.client.createSession({ createdBy: "web", taskId: "task-45" });
    for await (const _event of host.client.run(created.id, "first")) {
      // drain the first run
    }
    await host.assistant.close();
    await host.server.close();

    host = await start("runtime-2", "after restart");
    assert.equal((await host.client.listSessions())[0]?.id, created.id);
    assert.deepEqual(
      (await host.client.openSession(created.id)).messages.map((message) => message.role),
      ["user", "assistant"],
    );
    for await (const _event of host.client.run(created.id, "second")) {
      // drain the resumed run
    }
    const resumed = await host.client.openSession(created.id);
    assert.deepEqual(
      resumed.messages.map((message) => message.role),
      ["user", "assistant", "user", "assistant"],
    );
    assert.deepEqual(resumed.messages[3]?.parts, [{ type: "text", text: "after restart" }]);
  } finally {
    await host.assistant.close();
    await host.server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Opening a restarted session repairs an unfinished tool call", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "symphoneer-assistant-repair-"));
  const env = {
    SYMPHONEER_ASSISTANT_PROVIDER: "faux",
    SYMPHONEER_ASSISTANT_MODEL: "test-model",
    SYMPHONEER_ASSISTANT_API_KEY: "credential-must-not-persist",
  };
  const models = createModels();
  models.setProvider(fauxProvider({ provider: "faux", models: [{ id: "test-model" }] }).provider);
  const first = new PiAssistantService({ dataDir, env, models });
  const created = await first.createSession({ createdBy: "web" });
  await first.close();

  const assistantDir = join(dataDir, "assistant");
  const executionEnv = new NodeExecutionEnv({ cwd: assistantDir });
  const repository = new SqliteSessionRepository({
    env: executionEnv,
    sqlite: createNodeSqliteFactory(),
    databasePath: join(assistantDir, "sessions.sqlite"),
  });
  const metadata = (await repository.list({ cwd: assistantDir }))[0];
  assert.ok(metadata);
  const session = await repository.open(metadata);
  await session.appendMessage(
    JSON.parse(
      JSON.stringify(
        fauxAssistantMessage(fauxToolCall("runtime_health", {}, { id: "unfinished-tool" }), {
          stopReason: "toolUse",
        }),
      ),
    ),
  );
  await repository.close();
  await executionEnv.cleanup();

  const restarted = new PiAssistantService({ dataDir, env, models });
  try {
    const opened = await restarted.openSession(created.id);
    assert.deepEqual(
      opened.messages.map((message) => message.role),
      ["assistant", "tool"],
    );
    assert.deepEqual(opened.messages[1]?.parts, [
      {
        type: "tool_result",
        toolCallId: "unfinished-tool",
        toolName: "runtime_health",
        result: { code: "interrupted" },
        isError: true,
      },
    ]);
  } finally {
    await restarted.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
