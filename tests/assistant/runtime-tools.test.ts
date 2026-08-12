import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createModels,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  type AttemptSnapshot,
  CONTRACT_SCHEMA_VERSION,
  type TaskSummary,
  type WorkspaceReference,
} from "@symphoneer/contracts";
import { PiAssistantService } from "../../src/assistant/index.ts";
import { createHttpAssistantClient } from "../../src/assistant-client/index.ts";
import { RuntimeHttpServer, RuntimeService } from "../../src/runtime/index.ts";
import {
  createHttpRuntimeClient,
  type DefaultRuntimeClient,
} from "../../src/runtime-client/index.ts";
import { RUNTIME_TOOLS } from "../../src/runtime-tools/index.ts";

const ASSISTANT_ENV = {
  SYMPHONEER_ASSISTANT_PROVIDER: "faux",
  SYMPHONEER_ASSISTANT_MODEL: "test-model",
  SYMPHONEER_ASSISTANT_API_KEY: "credential-must-not-persist",
};

async function startHost(responses: FauxResponseStep[]) {
  const dataDir = await mkdtemp(join(tmpdir(), "symphoneer-assistant-tools-"));
  const faux = fauxProvider({ provider: "faux", models: [{ id: "test-model" }] });
  faux.setResponses(responses);
  const models = createModels();
  models.setProvider(faux.provider);
  let runtimeClient: DefaultRuntimeClient | undefined;
  const assistant = new PiAssistantService({
    dataDir,
    env: ASSISTANT_ENV,
    models,
    runtimeClient: () => {
      if (!runtimeClient) throw new Error("Runtime client is not ready");
      return runtimeClient;
    },
  });
  const runtime = new RuntimeService({ dataDir: join(dataDir, "runtime") });
  const server = new RuntimeHttpServer(runtime, {
    assistantHandler: assistant.handle,
    sessionToken: "test-token",
  });
  const endpoint = await server.listen();
  runtimeClient = createHttpRuntimeClient({ baseUrl: endpoint.url, token: "test-token" });
  return {
    assistant,
    assistantClient: createHttpAssistantClient({
      baseUrl: endpoint.url,
      token: "test-token",
    }),
    close: async () => {
      await assistant.close();
      await server.close();
      await rm(dataDir, { recursive: true, force: true });
    },
    runtimeClient,
    runtime,
  };
}

test("Pi sees only the Runtime allowlist and executes a query through RuntimeClient", async () => {
  let observedTools: string[] = [];
  const host = await startHost([
    (context) => {
      observedTools = context.tools?.map((tool) => tool.name) ?? [];
      return fauxAssistantMessage(fauxToolCall("runtime_health", {}), {
        stopReason: "toolUse",
      });
    },
    fauxAssistantMessage("Runtime is healthy"),
  ]);

  try {
    const session = await host.assistantClient.createSession({ createdBy: "tui" });
    const events = [];
    for await (const event of host.assistantClient.run(session.id, "Check Runtime health")) {
      events.push(event);
    }

    assert.deepEqual(
      observedTools,
      RUNTIME_TOOLS.map((tool) => tool.name),
    );
    assert.equal(
      observedTools.some((name) => /bash|edit|write|git|file/i.test(name)),
      false,
    );
    assert.ok(events.some((event) => event.type === "tool_started"));
    assert.ok(
      events.some(
        (event) =>
          event.type === "tool_completed" && event.toolName === "runtime_health" && !event.isError,
      ),
    );
    assert.equal(events.at(-1)?.type, "completed");
  } finally {
    await host.close();
  }
});

test("Rejected mutation approval does not create a Runtime domain event", async () => {
  const host = await startHost([
    fauxAssistantMessage(
      fauxToolCall("pause_attempt", {
        attemptId: "missing-attempt",
        idempotencyKey: "reject-test",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("The mutation was rejected"),
  ]);

  try {
    const before = await host.runtimeClient.listEvents();
    const session = await host.assistantClient.createSession({ createdBy: "web" });
    const events = [];
    for await (const event of host.assistantClient.run(session.id, "Pause it")) {
      events.push(event);
      if (event.type === "approval_required") {
        await host.assistantClient.respondApproval(session.id, event.approvalId, false);
      }
    }

    const after = await host.runtimeClient.listEvents();
    assert.deepEqual(after.events, before.events);
    assert.ok(events.some((event) => event.type === "approval_required"));
    assert.ok(
      events.some(
        (event) =>
          event.type === "tool_completed" && event.toolName === "pause_attempt" && event.isError,
      ),
    );
    assert.equal(events.at(-1)?.type, "completed");
  } finally {
    await host.close();
  }
});

test("Aborting a run expires its pending approval", async () => {
  const host = await startHost([
    fauxAssistantMessage(
      fauxToolCall("pause_attempt", {
        attemptId: "missing-attempt",
        idempotencyKey: "abort-approval-test",
      }),
      { stopReason: "toolUse" },
    ),
  ]);

  try {
    const session = await host.assistantClient.createSession({ createdBy: "web" });
    let approvalId = "";
    for await (const event of host.assistantClient.run(session.id, "Pause it")) {
      if (event.type !== "approval_required") continue;
      approvalId = event.approvalId;
      await host.assistantClient.abort(session.id);
    }
    assert.ok(approvalId);
    await assert.rejects(
      host.assistantClient.respondApproval(session.id, approvalId, true),
      /not found/,
    );
  } finally {
    await host.close();
  }
});

test("Approved mutation still surfaces Runtime optimistic-concurrency failure", async () => {
  const host = await startHost([
    fauxAssistantMessage(
      fauxToolCall("pause_attempt", {
        attemptId: "attempt-45",
        idempotencyKey: "stale-test",
        expectedEventSequence: 0,
        expectedAttemptUpdatedAt: "2026-08-12T09:01:00.000Z",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("Runtime rejected the stale mutation"),
  ]);
  const task: TaskSummary = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "github:icho648/symphoneer:45",
    identifier: "#45",
    source: {
      kind: "github",
      nativeId: "45",
      url: "https://github.com/icho648/symphoneer/issues/45",
    },
    title: "Assistant",
    state: "open",
    labels: [],
    dispatchable: true,
    workflowStatus: "ready",
    blocked: null,
  };
  const attempt: AttemptSnapshot = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "attempt-45",
    taskId: task.id,
    sequence: 1,
    startReason: "dispatch",
    status: "preparing_workspace",
    controller: "symphoneer",
    workspaceId: "workspace-45",
    providerSession: null,
    startedAt: "2026-08-12T09:00:00.000Z",
    updatedAt: "2026-08-12T09:01:00.000Z",
  };
  const workspace: WorkspaceReference = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "workspace-45",
    taskId: task.id,
    path: "/tmp/symphoneer-workspace-45",
    repository: "icho648/symphoneer",
    branch: "codex/issue-45-pi-assistant",
    gitHead: null,
    worktreeFingerprint: null,
    host: "local",
    state: "ready",
    ownerAttemptId: attempt.id,
  };

  try {
    await host.runtime.recordTask(task);
    await host.runtime.recordAttempt(attempt, { workspace });
    const before = await host.runtimeClient.listEvents();
    const session = await host.assistantClient.createSession({ createdBy: "web" });
    const events = [];
    for await (const event of host.assistantClient.run(session.id, "Pause it")) {
      events.push(event);
      if (event.type === "approval_required") {
        await host.assistantClient.respondApproval(session.id, event.approvalId, true);
      }
    }

    assert.deepEqual((await host.runtimeClient.listEvents()).events, before.events);
    const failure = events.find(
      (event) => event.type === "tool_completed" && event.toolName === "pause_attempt",
    );
    assert.equal(failure?.type, "tool_completed");
    if (failure?.type === "tool_completed") {
      assert.equal(failure.isError, true);
      assert.match(JSON.stringify(failure.result), /projection changed/i);
    }
    assert.equal(events.at(-1)?.type, "completed");
  } finally {
    await host.close();
  }
});
