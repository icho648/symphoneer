import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { CONTRACT_SCHEMA_VERSION, type TaskSummary } from "@symphoneer/contracts";
import {
  CodexAppServerAdapter,
  type CodexServerMessage,
  type CodexTransport,
  CodexTransportError,
  createWorkspaceReference,
  type JsonRpcId,
  StdioCodexTransport,
} from "@symphoneer/runtime";

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
  #turnSequence = 14;
  readonly #mode:
    | "colliding_ids"
    | "failed"
    | "file_change"
    | "foreign_completed"
    | "interactive"
    | "manual"
    | "activity"
    | "history"
    | "setup_failed"
    | "silent";

  constructor(
    threadId = "thread-14",
    mode:
      | "colliding_ids"
      | "failed"
      | "file_change"
      | "foreign_completed"
      | "interactive"
      | "manual"
      | "activity"
      | "history"
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
    if (method === "model/list") {
      return {
        data: [
          {
            id: "gpt-5.6-codex",
            model: "gpt-5.6-codex",
            displayName: "GPT-5.6 Codex",
            description: "Frontier coding model",
            isDefault: true,
            hidden: false,
            defaultReasoningEffort: "high",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "Balanced" },
              { reasoningEffort: "high", description: "Deeper reasoning" },
            ],
          },
        ],
        nextCursor: null,
      };
    }
    if (method === "thread/read" && this.#mode === "history") {
      return {
        thread: {
          id: this.#threadId,
          turns: [
            {
              id: "turn-history",
              status: "completed",
              items: [
                {
                  type: "userMessage",
                  id: "user-history",
                  content: [{ type: "inputText", text: "Implement the issue." }],
                },
                {
                  type: "commandExecution",
                  id: "command-history",
                  command: "curl --token=history-command-secret",
                  status: "completed",
                  aggregatedOutput: "AWS_SECRET_ACCESS_KEY=history-output-secret",
                  environment: { API_TOKEN: "history-environment-secret" },
                  exitCode: 0,
                },
                {
                  type: "agentMessage",
                  id: "message-history",
                  text: "The change is complete.",
                  status: "completed",
                },
              ],
            },
          ],
        },
      };
    }
    if (method === "thread/read") {
      return { thread: { id: this.#threadId, turns: [] } };
    }
    if (method === "thread/start" || method === "thread/resume") {
      const requested = stringField(params, "threadId");
      if (requested) this.#threadId = requested;
      return {
        thread: { id: this.#threadId },
        instructionSources: ["/tmp/workspace/AGENTS.md"],
      };
    }
    if (method === "turn/start") {
      this.#turnId = `turn-${this.#turnSequence++}`;
      if (this.#mode === "activity") {
        queueMicrotask(() => {
          const emit = (method: string, params: Record<string, unknown>) =>
            this.#controller.enqueue({
              kind: "notification",
              method,
              params: { threadId: this.#threadId, turnId: this.#turnId, ...params },
            });
          emit("turn/plan/updated", {
            explanation: "Implement and verify the focused change.",
            plan: [
              { step: "Update the counter", status: "completed" },
              { step: "Run the focused check", status: "inProgress" },
            ],
          });
          emit("item/completed", {
            item: {
              type: "userMessage",
              id: "user-1",
              content: [{ type: "text", text: "Implement the focused change." }],
            },
          });
          emit("item/started", {
            item: {
              type: "commandExecution",
              id: "command-1",
              command: "pnpm check",
              cwd: "/tmp/workspace",
              status: "inProgress",
            },
          });
          emit("item/completed", {
            item: {
              type: "commandExecution",
              id: "command-1",
              command: "pnpm check",
              cwd: "/tmp/workspace",
              status: "completed",
              aggregatedOutput: "all checks passed",
              exitCode: 0,
              durationMs: 1200,
            },
          });
          emit("item/completed", {
            item: {
              type: "fileChange",
              id: "file-1",
              status: "completed",
              changes: [
                { path: "src/counter.ts", kind: "update", diff: "+export const reset = () => 0" },
              ],
            },
          });
          emit("item/completed", {
            item: {
              type: "mcpToolCall",
              id: "tool-1",
              server: "github",
              tool: "get_issue",
              status: "completed",
              arguments: { issue_number: 14 },
              result: { content: [{ type: "text", text: "Issue loaded" }] },
              error: null,
              durationMs: 40,
            },
          });
          emit("item/completed", {
            item: {
              type: "agentMessage",
              id: "message-1",
              text: "Implemented the focused change and verified it.",
              phase: "final_answer",
            },
          });
          this.#complete("completed");
        });
      } else if (this.#mode === "failed") queueMicrotask(() => this.#complete("failed"));
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
            params: {
              threadId: this.#threadId,
              turnId: this.#turnId,
              command:
                "curl --token=secret-value -H Authorization: Bearer supersecret https://alice:supersecret@example.test/download?sig=url-secret&signature=other-secret AWS_SECRET_ACCESS_KEY='super secret' Cookie: theme=dark; sessionid=cookie-secret",
              cwd: "/tmp/workspace",
              reason: "Network access",
            },
          });
        });
      } else if (this.#mode === "file_change") {
        queueMicrotask(() => {
          this.#controller.enqueue({
            kind: "request",
            id: 42,
            method: "item/fileChange/requestApproval",
            params: {
              threadId: this.#threadId,
              turnId: this.#turnId,
              reason: "Write outside the workspace",
              grantRoot: "/tmp/other-root",
            },
          });
        });
      }
      return { turn: { id: this.#turnId } };
    }
    if (method === "turn/interrupt") {
      if (this.#mode !== "silent") queueMicrotask(() => this.#complete("interrupted"));
      return {};
    }
    if (method === "turn/steer") return { turnId: this.#turnId };
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
            questions: [
              {
                id: "scope",
                question: "Keep the change narrow?",
                options: [
                  { label: "Yes", description: "Keep the scope narrow." },
                  { label: "No", description: "Expand the scope." },
                ],
              },
              { id: "reason", question: "Why is this change needed?" },
            ],
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

  notifyItem(count: number): void {
    for (let index = 0; index < count; index += 1) {
      this.#controller.enqueue({
        kind: "notification",
        method: "item/updated",
        params: { threadId: this.#threadId, turnId: this.#turnId, index },
      });
    }
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

test("Codex adapter lists the models and reasoning efforts advertised by App Server", async () => {
  const transport = new FakeCodexTransport("thread-models", "manual");
  const models = await new CodexAppServerAdapter({
    transportFactory: async () => transport,
  }).listModels();

  assert.deepEqual(models, [
    {
      id: "gpt-5.6-codex",
      model: "gpt-5.6-codex",
      displayName: "GPT-5.6 Codex",
      description: "Frontier coding model",
      isDefault: true,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: [
        { reasoningEffort: "medium", description: "Balanced" },
        { reasoningEffort: "high", description: "Deeper reasoning" },
      ],
    },
  ]);
  assert.deepEqual(
    transport.requests.map(({ method }) => method),
    ["initialize", "model/list"],
  );
  assert.equal(transport.closeCalls, 1);
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
  assert.deepEqual(approval.details, {
    action: "command",
    command:
      "curl --token=<redacted> -H Authorization: <redacted> https://alice:<redacted>@example.test/download?sig=<redacted>&signature=<redacted> AWS_SECRET_ACCESS_KEY=<redacted> Cookie: <redacted>",
    cwd: "/tmp/workspace",
    reason: "Network access",
  });
  await handle.respondToIntervention(approval.requestRef, { decision: "approved" });

  const input = (await events.next()).value;
  assert.equal(input?.type, "intervention_requested");
  if (input?.type !== "intervention_requested") assert.fail("input event missing");
  assert.deepEqual(input.questionIds, ["scope", "reason"]);
  assert.deepEqual(input.questions, [
    {
      id: "scope",
      prompt: "Keep the change narrow?",
      options: [
        { label: "Yes", description: "Keep the scope narrow." },
        { label: "No", description: "Expand the scope." },
      ],
    },
    { id: "reason", prompt: "Why is this change needed?", options: [] },
  ]);
  await handle.respondToIntervention(input.requestRef, {
    decision: "answered",
    responses: { scope: ["Yes"], reason: ["No"] },
  });
  assert.deepEqual(await handle.completion, { outcome: "completed" });
  assert.deepEqual(transport.responses, [
    { id: 41, result: { decision: "accept" } },
    {
      id: "input-14",
      result: {
        answers: {
          scope: { answers: ["Yes"] },
          reason: { answers: ["No"] },
        },
      },
    },
  ]);
  assert.deepEqual(
    transport.requests.map(({ method }) => method),
    ["initialize", "thread/start", "turn/start"],
  );
  assert.equal(
    (
      transport.requests.find(({ method }) => method === "thread/start")?.params as {
        threadSource?: unknown;
      }
    )?.threadSource,
    "user",
  );
});

test("Codex adapter applies the selected model, permission, and reasoning effort", async () => {
  const transport = new FakeCodexTransport("thread-settings", "manual");
  const handle = await new CodexAppServerAdapter({
    transportFactory: async () => transport,
  }).startOrContinue({
    attemptId: "attempt-settings",
    task,
    workspace,
    prompt: "Implement with selected settings",
    continuation: false,
    model: "gpt-5.6-codex",
    sandbox: "read-only",
    effort: "high",
  });

  assert.equal(
    (
      transport.requests.find(({ method }) => method === "thread/start")?.params as {
        model?: unknown;
      }
    )?.model,
    "gpt-5.6-codex",
  );
  assert.equal(
    (
      transport.requests.find(({ method }) => method === "thread/start")?.params as {
        sandbox?: unknown;
      }
    )?.sandbox,
    "read-only",
  );
  const turnParams = transport.requests.find(({ method }) => method === "turn/start")?.params as {
    effort?: unknown;
    model?: unknown;
  };
  assert.equal(turnParams.effort, "high");
  assert.equal(turnParams.model, "gpt-5.6-codex");
  await handle.interrupt();
});

test("Codex adapter summarizes file-change approval details", async () => {
  const transport = new FakeCodexTransport("thread-file-change", "file_change");
  const handle = await new CodexAppServerAdapter({
    transportFactory: async () => transport,
  }).startOrContinue({
    attemptId: "attempt-file-change",
    task,
    workspace,
    prompt: "Change files",
    continuation: false,
  });
  const events = handle.events[Symbol.asyncIterator]();
  await events.next();
  const approval = (await events.next()).value;
  if (approval?.type !== "intervention_requested") assert.fail("approval event missing");
  assert.deepEqual(approval.details, {
    action: "file_change",
    reason: "Write outside the workspace",
    scope: "additional_root",
  });
  await handle.respondToIntervention(approval.requestRef, { decision: "approved" });
  assert.deepEqual(await handle.completion, { outcome: "completed" });
});

test("Codex adapter projects useful App Server items as bounded execution activities", async () => {
  const transport = new FakeCodexTransport("thread-activity", "activity");
  const handle = await new CodexAppServerAdapter({
    transportFactory: async () => transport,
    now: () => new Date("2026-08-09T09:00:00.000Z"),
  }).startOrContinue({
    attemptId: "attempt-activity",
    task,
    workspace,
    prompt: "Show useful execution activity",
    continuation: false,
  });
  const events = [];
  for await (const event of handle.events) events.push(event);
  assert.deepEqual(await handle.completion, { outcome: "completed" });

  const activities = events.filter((event) => event.type === "activity");
  assert.deepEqual(
    activities.map((event) => ({
      kind: "kind" in event ? event.kind : null,
      status: "status" in event ? event.status : null,
    })),
    [
      { kind: "plan", status: "running" },
      { kind: "message", status: "completed" },
      { kind: "command", status: "running" },
      { kind: "command", status: "completed" },
      { kind: "file_change", status: "completed" },
      { kind: "tool", status: "completed" },
      { kind: "message", status: "completed" },
    ],
  );
  const userMessage = activities.find(
    (event) => "details" in event && event.kind === "message" && event.details.role === "user",
  );
  assert.equal(
    "content" in (userMessage ?? {}) ? userMessage?.content : null,
    "Implement the focused change.",
  );
  const command = activities.find(
    (event) => "kind" in event && event.kind === "command" && event.status === "completed",
  );
  assert.deepEqual("details" in (command ?? {}) ? command?.details : null, {
    command: "pnpm check",
    cwd: "/tmp/workspace",
    output: "all checks passed",
    exitCode: 0,
    durationMs: 1200,
  });
});

test("Codex adapter persists bounded Thread history without raw Provider secrets", async () => {
  const transport = new FakeCodexTransport("thread-history", "history");
  const session = await new CodexAppServerAdapter({
    transportFactory: async () => transport,
  }).readSession("thread-history", "attempt-history", "2026-08-09T09:00:00.000Z");

  assert.equal(session?.threadId, "thread-history");
  assert.equal(session?.turns[0]?.id, "turn-history");
  assert.deepEqual(
    session?.turns[0]?.items.map(({ id, type }) => ({ id, type })),
    [
      { id: "user-history", type: "userMessage" },
      { id: "command-history", type: "commandExecution" },
      { id: "message-history", type: "agentMessage" },
    ],
  );
  assert.deepEqual(session?.turns[0]?.items[0]?.data, {
    activity: {
      kind: "message",
      status: "completed",
      title: "User message",
      content: "Implement the issue.",
      details: { role: "user" },
    },
  });
  const serialized = JSON.stringify(session);
  assert.doesNotMatch(serialized, /history-(?:command|output|environment)-secret/);
  assert.match(serialized, /<redacted>/);
  assert.deepEqual(
    transport.requests.map(({ method }) => method),
    ["initialize", "thread/read"],
  );
  assert.equal(transport.closeCalls, 1);
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
    sandbox: "danger-full-access",
    effort: "xhigh",
  });
  await handle.interrupt();
  assert.deepEqual(await handle.completion, { outcome: "interrupted" });
  assert.deepEqual(
    transport.requests.map(({ method }) => method),
    ["initialize", "thread/resume", "turn/start", "turn/interrupt"],
  );
  assert.equal(
    (
      transport.requests.find(({ method }) => method === "thread/resume")?.params as {
        sandbox?: unknown;
      }
    )?.sandbox,
    "danger-full-access",
  );
  assert.equal(
    (
      transport.requests.find(({ method }) => method === "turn/start")?.params as {
        effort?: unknown;
      }
    )?.effort,
    "xhigh",
  );
});

test("one Attempt Worker keeps one App Server and Thread across sequential Turns", async (t) => {
  const transport = new FakeCodexTransport("thread-worker", "manual");
  const runner = new CodexAppServerAdapter({ transportFactory: async () => transport });
  const worker = await runner.openWorker({
    attemptId: "attempt-worker",
    task,
    workspace,
  });
  t.after(() => worker.close());

  const first = await worker.startTurn({ prompt: "Start #14" });
  const firstSession = (await first.events[Symbol.asyncIterator]().next()).value;
  if (firstSession?.type !== "session_started") assert.fail("first session missing");
  transport.complete("completed");
  assert.deepEqual(await first.completion, { outcome: "completed" });
  assert.equal(transport.closeCalls, 0);

  const second = await worker.startTurn({
    prompt: "Continue #14",
    threadId: firstSession.threadId,
  });
  const secondSession = (await second.events[Symbol.asyncIterator]().next()).value;
  if (secondSession?.type !== "session_started") assert.fail("second session missing");
  transport.complete("completed");
  assert.deepEqual(await second.completion, { outcome: "completed" });

  assert.equal(firstSession.threadId, secondSession.threadId);
  assert.notEqual(firstSession.turnId, secondSession.turnId);
  assert.deepEqual(
    (await worker.readSession(firstSession.threadId, "2026-08-16T12:00:00.000Z"))
      ?.instructionSources,
    ["/tmp/workspace/AGENTS.md"],
  );
  assert.deepEqual(
    transport.requests.map(({ method }) => method),
    ["initialize", "thread/start", "turn/start", "turn/start", "thread/read"],
  );
  assert.equal(transport.closeCalls, 0);
  await worker.close();
  assert.equal(transport.closeCalls, 1);
});

test("Codex active Turns accept a small steering message", async () => {
  const transport = new FakeCodexTransport("thread-steer", "manual");
  const handle = await new CodexAppServerAdapter({
    transportFactory: async () => transport,
  }).startOrContinue({
    attemptId: "attempt-steer",
    task,
    workspace,
    prompt: "Start the change",
    continuation: false,
  });

  await handle.steer("Focus on the failing test first.");
  assert.deepEqual(transport.requests.at(-1), {
    method: "turn/steer",
    params: {
      threadId: "thread-steer",
      expectedTurnId: "turn-14",
      input: [{ type: "text", text: "Focus on the failing test first." }],
    },
  });
  transport.complete("completed");
  assert.deepEqual(await handle.completion, { outcome: "completed" });
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

test("Codex completion waits for the interrupted Provider process to stop", async () => {
  const stopped = Promise.withResolvers<void>();
  const transport = new FakeCodexTransport("thread-contained", "silent");
  const contained: CodexTransport = {
    ...transport,
    messages: transport.messages,
    closed: transport.closed,
    request: (method, params) => transport.request(method, params),
    notify: () => transport.notify(),
    respond: (id, result) => transport.respond(id, result),
    reject: () => transport.reject(),
    close: async () => {
      await stopped.promise;
      await transport.close();
    },
  };
  const handle = await new CodexAppServerAdapter({
    transportFactory: async () => contained,
    turnTimeoutMs: 20,
    stallTimeoutMs: 0,
  }).startOrContinue({
    attemptId: "attempt-contained",
    task,
    workspace,
    prompt: "Time out safely",
    continuation: false,
  });
  let completed = false;
  void handle.completion.then(() => {
    completed = true;
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 60));
  assert.equal(completed, false);

  stopped.resolve();
  assert.deepEqual(await handle.completion, { outcome: "failed", error: "turn_timed_out" });
  assert.equal(transport.closeCalls, 1);
});

test("Codex adapter suspends the stall timeout while waiting for intervention", async () => {
  const transport = new FakeCodexTransport("thread-intervention-stall");
  const handle = await new CodexAppServerAdapter({
    transportFactory: async () => transport,
    turnTimeoutMs: 1_000,
    stallTimeoutMs: 20,
  }).startOrContinue({
    attemptId: "attempt-intervention-stall",
    task,
    workspace,
    prompt: "Wait for approval",
    continuation: false,
  });
  const events = handle.events[Symbol.asyncIterator]();
  await events.next();
  const approval = (await events.next()).value;
  if (approval?.type !== "intervention_requested") assert.fail("approval event missing");
  let completed = false;
  void handle.completion.then(() => {
    completed = true;
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  assert.equal(completed, false);

  await handle.respondToIntervention(approval.requestRef, { decision: "approved" });
  const input = (await events.next()).value;
  if (input?.type !== "intervention_requested") assert.fail("input event missing");
  await handle.respondToIntervention(input.requestRef, {
    decision: "answered",
    responses: { scope: ["Yes"], reason: ["No"] },
  });
  assert.deepEqual(await handle.completion, { outcome: "completed" });
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

test("Codex bounds the event queue for a consumer that stops reading", async () => {
  const transport = new FakeCodexTransport("thread-slow-consumer", "manual");
  const handle = await new CodexAppServerAdapter({
    transportFactory: async () => transport,
  }).startOrContinue({
    attemptId: "attempt-slow-consumer",
    task,
    workspace,
    prompt: "Emit a long Turn",
    continuation: false,
  });
  transport.notifyItem(5_000);
  transport.complete("completed");
  assert.deepEqual(await handle.completion, { outcome: "completed" });

  const queued: string[] = [];
  for await (const event of handle.events) queued.push(event.type);
  assert.equal(queued[0], "session_started");
  assert.ok(queued.length < 1_000, `queued ${queued.length} events`);
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

test("Codex stdio transport exposes its PID and starts in the Workspace cwd", async (t) => {
  const cwd = await mkdtemp(resolve(tmpdir(), "symphoneer-codex-cwd-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const transport = await StdioCodexTransport.start({
    command: process.execPath,
    args: [
      "-e",
      "const readline=require('node:readline');readline.createInterface({input:process.stdin}).on('line',line=>{const request=JSON.parse(line);process.stdout.write(JSON.stringify({id:request.id,result:{cwd:process.cwd()}})+'\\n')})",
    ],
    cwd,
  });

  assert.ok((transport.processIdentity.pid ?? 0) > 0);
  assert.deepEqual(await transport.request("fixture/cwd", {}), { cwd: await realpath(cwd) });
  await transport.close();
});

test("Codex stdio transport does not expose Tracker credentials to App Server", async () => {
  const transport = await StdioCodexTransport.start({
    command: process.execPath,
    args: [
      "-e",
      "const readline=require('node:readline');readline.createInterface({input:process.stdin}).on('line',line=>{const request=JSON.parse(line);process.stdout.write(JSON.stringify({id:request.id,result:{safe:process.env.SYMPHONEER_SAFE_ENV??null,github:process.env.GITHUB_TOKEN??null,gh:process.env.GH_TOKEN??null}})+'\\n')})",
    ],
    env: {
      ...process.env,
      SYMPHONEER_SAFE_ENV: "visible",
      GITHUB_TOKEN: "tracker-secret",
      GH_TOKEN: "tracker-secret",
    },
  });

  assert.deepEqual(await transport.request("fixture/env", {}), {
    safe: "visible",
    github: null,
    gh: null,
  });
  await transport.close();
});

test("Codex stdio transport tolerates event consumer cancellation before process close", async () => {
  const transport = await StdioCodexTransport.start({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
  });
  const events = transport.messages[Symbol.asyncIterator]();
  await events.return?.();
  await transport.close();
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
