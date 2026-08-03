import assert from "node:assert/strict";
import test from "node:test";

import {
  CodexAppServerAdapter,
  type CodexServerMessage,
  type CodexTransport,
  CodexTransportError,
  type JsonRpcId,
  StdioCodexTransport,
} from "../../packages/adapters/src/index.ts";
import { CONTRACT_SCHEMA_VERSION, type TaskSummary } from "../../packages/contracts/src/index.ts";
import { createWorkspaceReference } from "../../packages/symphony-core/src/index.ts";

class FakeCodexTransport implements CodexTransport {
  readonly toolVersion = "codex-cli 0.146.0";
  readonly requests: Array<{ method: string; params: unknown }> = [];
  readonly responses: Array<{ id: JsonRpcId; result: unknown }> = [];
  closeCalls = 0;
  readonly messages: AsyncIterable<CodexServerMessage>;
  readonly closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  readonly #closed = Promise.withResolvers<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>();
  #controller!: ReadableStreamDefaultController<CodexServerMessage>;
  #threadId: string;
  #turnId = "turn-14";
  readonly #mode:
    | "colliding_ids"
    | "failed"
    | "foreign_completed"
    | "interactive"
    | "manual"
    | "setup_failed"
    | "silent";

  constructor(
    threadId = "thread-14",
    mode:
      | "colliding_ids"
      | "failed"
      | "foreign_completed"
      | "interactive"
      | "manual"
      | "setup_failed"
      | "silent" = "interactive",
  ) {
    this.#threadId = threadId;
    this.#mode = mode;
    this.closed = this.#closed.promise;
    this.messages = new ReadableStream<CodexServerMessage>({
      start: (controller) => {
        this.#controller = controller;
      },
    });
  }

  async request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params: structuredClone(params) });
    if (method === "initialize" && this.#mode === "setup_failed") {
      throw new Error("initialize failed");
    }
    if (method === "initialize") return { userAgent: this.toolVersion };
    if (method === "thread/start" || method === "thread/resume") {
      const requested = stringField(params, "threadId");
      if (requested) this.#threadId = requested;
      return { thread: { id: this.#threadId } };
    }
    if (method === "turn/start") {
      if (this.#mode === "failed") queueMicrotask(() => this.#complete("failed"));
      else if (this.#mode === "colliding_ids") {
        queueMicrotask(() => {
          for (const id of [1, "1"] as const) {
            this.#controller.enqueue({
              kind: "request",
              id,
              method: "item/commandExecution/requestApproval",
              params: { threadId: this.#threadId, turnId: this.#turnId },
            });
          }
        });
      } else if (this.#mode === "foreign_completed") {
        queueMicrotask(() => {
          this.#controller.enqueue({
            kind: "notification",
            method: "turn/completed",
            params: undefined,
          });
          this.#controller.enqueue({
            kind: "notification",
            method: "turn/completed",
            params: { turn: { status: "failed" } },
          });
          this.#controller.enqueue({
            kind: "notification",
            method: "turn/completed",
            params: { threadId: this.#threadId, turn: { id: "foreign-turn", status: "failed" } },
          });
          this.#complete("completed");
        });
      } else if (this.#mode === "interactive") {
        queueMicrotask(() => {
          this.#controller.enqueue({
            kind: "request",
            id: 41,
            method: "item/commandExecution/requestApproval",
            params: { threadId: this.#threadId, turnId: this.#turnId },
          });
        });
      }
      return { turn: { id: this.#turnId } };
    }
    if (method === "turn/interrupt") {
      if (this.#mode !== "silent") queueMicrotask(() => this.#complete("interrupted"));
      return {};
    }
    throw new Error(`Unexpected request ${method}`);
  }

  notify(): void {}

  respond(id: JsonRpcId, result: unknown): void {
    this.responses.push({ id, result: structuredClone(result) });
    if (this.#mode === "colliding_ids") {
      if (this.responses.length === 2) queueMicrotask(() => this.#complete("completed"));
      return;
    }
    if (id === 41) {
      queueMicrotask(() => {
        this.#controller.enqueue({
          kind: "request",
          id: "input-14",
          method: "item/tool/requestUserInput",
          params: {
            threadId: this.#threadId,
            turnId: this.#turnId,
            questions: [{ id: "scope", question: "Keep the change narrow?" }],
          },
        });
      });
    } else {
      queueMicrotask(() => this.#complete("completed"));
    }
  }

  reject(): void {}

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.#controller.close();
    this.#closed.resolve({ code: 0, signal: null });
  }

  complete(status: "completed" | "failed" | "interrupted"): void {
    this.#complete(status);
  }

  #complete(status: "completed" | "failed" | "interrupted") {
    this.#controller.enqueue({
      kind: "notification",
      method: "turn/completed",
      params: { threadId: this.#threadId, turn: { id: this.#turnId, status } },
    });
  }
}

const stringField = (value: unknown, field: string): string | null =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>)[field] === "string"
    ? ((value as Record<string, unknown>)[field] as string)
    : null;

const task: TaskSummary = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  id: "github:icho648/symphoneer:14",
  identifier: "#14",
  source: {
    kind: "github",
    nativeId: "14",
    url: "https://github.com/icho648/symphoneer/issues/14",
  },
  title: "Connect the execution boundaries",
  state: "open",
  labels: ["symphoneer:ready"],
  dispatchable: true,
};

const workspace = createWorkspaceReference({
  root: "/tmp/symphoneer-workspaces",
  taskId: task.id,
  identifier: task.identifier,
  attemptId: "attempt-14",
  repository: "icho648/symphoneer",
  branch: "codex/issue-14",
  host: "local",
});

test("Codex adapter maps v2 Thread, Turn, approvals, and input to the Agent Runner contract", async () => {
  const transport = new FakeCodexTransport();
  const runner = new CodexAppServerAdapter({
    transportFactory: async () => transport,
    now: () => new Date("2026-08-03T12:00:00.000Z"),
  });
  const handle = await runner.startOrContinue({
    attemptId: "attempt-14",
    task,
    workspace,
    prompt: "Implement #14",
    continuation: false,
  });
  const events = handle.events[Symbol.asyncIterator]();
  const session = (await events.next()).value;
  assert.equal(session?.type, "session_started");
  if (session?.type !== "session_started") assert.fail("session_started event missing");
  assert.equal(session.provider.version, "codex-cli 0.146.0");
  assert.equal(session.provider.schema, "v2");
  assert.match(session.provider.inputFingerprint, /^[a-f0-9]{64}$/);

  const approval = (await events.next()).value;
  assert.equal(approval?.type, "intervention_requested");
  if (approval?.type !== "intervention_requested") assert.fail("approval event missing");
  await handle.respondToIntervention(approval.requestRef, { decision: "approved" });

  const input = (await events.next()).value;
  assert.equal(input?.type, "intervention_requested");
  if (input?.type !== "intervention_requested") assert.fail("input event missing");
  await handle.respondToIntervention(input.requestRef, {
    decision: "answered",
    responses: { scope: ["Yes"] },
  });
  assert.deepEqual(await handle.completion, { outcome: "completed" });
  assert.deepEqual(transport.responses, [
    { id: 41, result: { decision: "accept" } },
    { id: "input-14", result: { answers: { scope: { answers: ["Yes"] } } } },
  ]);
  assert.deepEqual(
    transport.requests.map(({ method }) => method),
    ["initialize", "thread/start", "turn/start"],
  );
});

test("Codex continuation resumes the recorded Thread and interrupt pauses the Turn", async () => {
  const transport = new FakeCodexTransport("thread-resume");
  const runner = new CodexAppServerAdapter({ transportFactory: async () => transport });
  const handle = await runner.startOrContinue({
    attemptId: "attempt-14-continuation",
    task,
    workspace,
    prompt: "Continue #14",
    continuation: true,
    threadId: "thread-resume",
  });
  await handle.interrupt();
  assert.deepEqual(await handle.completion, { outcome: "interrupted" });
  assert.deepEqual(
    transport.requests.map(({ method }) => method),
    ["initialize", "thread/resume", "turn/start", "turn/interrupt"],
  );
});

test("Codex adapter exposes failed and timed-out Turns without Provider error payloads", async () => {
  const failedTransport = new FakeCodexTransport("thread-failed", "failed");
  const failedRunner = new CodexAppServerAdapter({
    transportFactory: async () => failedTransport,
  });
  const failed = await failedRunner.startOrContinue({
    attemptId: "attempt-failed",
    task,
    workspace,
    prompt: "Fail safely",
    continuation: false,
  });
  assert.deepEqual(await failed.completion, { outcome: "failed", error: "codex_turn_failed" });

  const silentTransport = new FakeCodexTransport("thread-timeout", "silent");
  const timedRunner = new CodexAppServerAdapter({
    transportFactory: async () => silentTransport,
    turnTimeoutMs: 20,
    stallTimeoutMs: 0,
  });
  const timed = await timedRunner.startOrContinue({
    attemptId: "attempt-timeout",
    task,
    workspace,
    prompt: "Time out safely",
    continuation: false,
  });
  assert.deepEqual(await timed.completion, { outcome: "failed", error: "turn_timed_out" });
});

test("Codex adapter ignores foreign nested Turn identities and closes failed setup", async () => {
  const foreignTransport = new FakeCodexTransport("thread-owned", "foreign_completed");
  const runner = new CodexAppServerAdapter({ transportFactory: async () => foreignTransport });
  const handle = await runner.startOrContinue({
    attemptId: "attempt-owned",
    task,
    workspace,
    prompt: "Ignore another Turn",
    continuation: false,
  });
  assert.deepEqual(await handle.completion, { outcome: "completed" });

  const setupTransport = new FakeCodexTransport("thread-setup", "setup_failed");
  const setupRunner = new CodexAppServerAdapter({
    transportFactory: async () => setupTransport,
  });
  await assert.rejects(
    setupRunner.startOrContinue({
      attemptId: "attempt-setup",
      task,
      workspace,
      prompt: "Fail setup",
      continuation: false,
    }),
    /initialize failed/,
  );
  assert.equal(setupTransport.closeCalls, 1);
});

test("Codex adapter keeps numeric and string JSON-RPC intervention IDs distinct", async () => {
  const transport = new FakeCodexTransport("thread-collisions", "colliding_ids");
  const handle = await new CodexAppServerAdapter({
    transportFactory: async () => transport,
  }).startOrContinue({
    attemptId: "attempt-collisions",
    task,
    workspace,
    prompt: "Handle both approvals",
    continuation: false,
  });
  const events = handle.events[Symbol.asyncIterator]();
  await events.next();
  const first = (await events.next()).value;
  const second = (await events.next()).value;
  if (first?.type !== "intervention_requested" || second?.type !== "intervention_requested") {
    assert.fail("approval events missing");
  }
  assert.notEqual(first.requestRef, second.requestRef);
  await handle.respondToIntervention(first.requestRef, { decision: "approved" });
  await handle.respondToIntervention(second.requestRef, { decision: "rejected" });
  assert.deepEqual(await handle.completion, { outcome: "completed" });
  assert.deepEqual(transport.responses, [
    { id: 1, result: { decision: "accept" } },
    { id: "1", result: { decision: "decline" } },
  ]);
});

test("Codex execution fingerprint changes with the Workspace code observation", async () => {
  const fingerprints: string[] = [];
  for (const [index, observedWorkspace] of [
    workspace,
    { ...workspace, gitHead: "b".repeat(40), worktreeFingerprint: "a".repeat(64) },
  ].entries()) {
    const handle = await new CodexAppServerAdapter({
      transportFactory: async () => new FakeCodexTransport(`thread-fingerprint-${index}`, "failed"),
    }).startOrContinue({
      attemptId: "attempt-fingerprint",
      task,
      workspace: observedWorkspace,
      prompt: "Same prompt",
      continuation: false,
    });
    const first = (await handle.events[Symbol.asyncIterator]().next()).value;
    if (first?.type !== "session_started") assert.fail("session event missing");
    fingerprints.push(first.provider.inputFingerprint);
    await handle.completion;
  }
  assert.notEqual(fingerprints[0], fingerprints[1]);
});

test("Codex completion survives an event consumer canceling early", async () => {
  const transport = new FakeCodexTransport("thread-canceled-events", "manual");
  const handle = await new CodexAppServerAdapter({
    transportFactory: async () => transport,
  }).startOrContinue({
    attemptId: "attempt-canceled-events",
    task,
    workspace,
    prompt: "Do not require event draining",
    continuation: false,
  });
  const events = handle.events[Symbol.asyncIterator]();
  assert.equal((await events.next()).value?.type, "session_started");
  await events.return?.();
  transport.complete("completed");
  assert.deepEqual(await handle.completion, { outcome: "completed" });
  assert.equal(transport.closeCalls, 1);
});

test("Codex stdio transport turns an input-pipe race into a process failure", async () => {
  const transport = await StdioCodexTransport.start({
    command: process.execPath,
    args: ["-e", "process.exit(0)"],
    readTimeoutMs: 1_000,
  });
  await assert.rejects(
    transport.request("initialize", { payload: "x".repeat(2 ** 20) }),
    (error) => error instanceof CodexTransportError && error.code === "process_failed",
  );
  await transport.closed;
});

test("Codex stdio transport ignores buffered JSONL after a protocol failure", async () => {
  const transport = await StdioCodexTransport.start({
    command: process.execPath,
    args: ["-e", 'process.stdout.write(\'not-json\\n{"method":"turn/started","params":{}}\\n\')'],
  });
  await assert.rejects(
    async () => {
      for await (const _message of transport.messages) {
        // No valid message may follow the protocol failure.
      }
    },
    (error) => error instanceof CodexTransportError && error.code === "invalid_message",
  );
  await transport.closed;
});
