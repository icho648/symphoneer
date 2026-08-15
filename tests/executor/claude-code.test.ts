import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { CONTRACT_SCHEMA_VERSION, type TaskSummary } from "@symphoneer/contracts";
import { ClaudeCodeAdapter } from "../../src/runtime/executor/claude-code/runner.ts";
import {
  type ClaudeMessage,
  type ClaudeTransport,
  StdioClaudeTransport,
} from "../../src/runtime/executor/claude-code/transport.ts";
import { createWorkspaceReference } from "../../src/runtime/workspace/index.ts";

const task: TaskSummary = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  id: "task-50",
  identifier: "#50",
  source: {
    kind: "github",
    nativeId: "50",
    url: "https://github.com/icho648/symphoneer/issues/50",
  },
  title: "Add Claude Code",
  state: "open",
  labels: ["symphoneer:ready"],
  dispatchable: true,
  workflowStatus: "backlog",
  blocked: null,
};

const workspace = createWorkspaceReference({
  root: "/tmp/symphoneer-workspaces",
  taskId: task.id,
  identifier: task.identifier,
  attemptId: "attempt-50",
  repository: "icho648/symphoneer",
  branch: "codex/issue-50",
  host: "local",
});

test("Claude Worker keeps one process and Session across sequential Turns", async (t) => {
  const transport = new FakeClaudeTransport();
  const runner = new ClaudeCodeAdapter({
    transportFactory: async (options) => {
      assert.equal(options.cwd, workspace.path);
      assert.equal(options.permissionMode, "acceptEdits");
      return transport;
    },
    permissionMode: "acceptEdits",
    now: () => new Date("2026-08-14T12:00:00.000Z"),
  });
  const worker = await runner.openWorker({ attemptId: "attempt-50", task, workspace });
  t.after(() => worker.close());

  const first = await worker.startTurn({ prompt: "Create the fixture" });
  const firstEvents = collect(first.events);
  assert.equal(transport.sent[0]?.type, "user");
  transport.emit(init("session-50"));
  transport.emit(assistant("session-50", "assistant-1"));
  transport.emit(toolResult("session-50", "tool-1"));
  transport.emit(apiRetry("session-50"));
  transport.emit(result("session-50", "success"));
  assert.deepEqual(await first.completion, { outcome: "completed" });
  const observedFirst = await firstEvents;
  const started = observedFirst[0];
  assert.equal(started?.type, "session_started");
  if (started?.type !== "session_started") assert.fail("session event missing");
  assert.equal(started.threadId, "session-50");
  assert.equal(started.provider.name, "claude-code");
  assert.equal(started.provider.version, "2.1.218");
  assert.equal(started.provider.model, "claude-sonnet-4-6");
  assert.equal(started.provider.permissionMode, "acceptEdits");
  assert.deepEqual(
    observedFirst.filter((event) => event.type === "activity").map((event) => event.kind),
    ["message", "reasoning", "tool", "tool", "warning", "message"],
  );

  const second = await worker.startTurn({
    prompt: "Continue the fixture",
    threadId: "session-50",
  });
  const secondEvents = collect(second.events);
  transport.emit(assistant("session-50", "assistant-2", "Done"));
  transport.emit(result("session-50", "success"));
  assert.deepEqual(await second.completion, { outcome: "completed" });
  const secondStarted = (await secondEvents)[0];
  assert.equal(secondStarted?.type, "session_started");
  if (secondStarted?.type !== "session_started") assert.fail("second session event missing");
  assert.equal(secondStarted.threadId, started.threadId);
  assert.notEqual(secondStarted.turnId, started.turnId);
  assert.equal(transport.closeCalls, 0);

  const session = await worker.readSession("session-50", "2026-08-14T12:01:00.000Z");
  assert.equal(session?.provider, "claude-code");
  assert.equal(session?.turns.length, 2);
  assert.match(JSON.stringify(session), /totalCostUsd/);
  assert.doesNotMatch(JSON.stringify(session), /sk-ant-secret-value/);

  await worker.close();
  await worker.close();
  assert.equal(transport.closeCalls, 1);
});

test("Claude Worker resumes a saved Session and rejects identity drift", async () => {
  const resumedTransport = new FakeClaudeTransport();
  const runner = new ClaudeCodeAdapter({
    transportFactory: async (options) => {
      assert.equal(options.resumeSessionId, "session-50");
      return resumedTransport;
    },
    permissionMode: "bypassPermissions",
  });
  const worker = await runner.openWorker({
    attemptId: "attempt-resume",
    task,
    workspace,
    sessionId: "session-50",
  });
  const handle = await worker.startTurn({ prompt: "Resume", threadId: "session-50" });
  resumedTransport.emit(init("session-50", "bypassPermissions"));
  resumedTransport.emit(result("session-50", "success"));
  assert.deepEqual(await handle.completion, { outcome: "completed" });
  await worker.close();

  const driftTransport = new FakeClaudeTransport();
  const driftWorker = await new ClaudeCodeAdapter({
    transportFactory: async () => driftTransport,
    permissionMode: "acceptEdits",
  }).openWorker({
    attemptId: "attempt-drift",
    task,
    workspace,
    sessionId: "session-50",
  });
  const drift = await driftWorker.startTurn({ prompt: "Resume", threadId: "session-50" });
  driftTransport.emit(init("different-session"));
  assert.deepEqual(await drift.completion, {
    outcome: "failed",
    error: "claude_resume_session_mismatch",
  });
  await driftWorker.close();
});

test("Claude maps permission requests, queue steering, interrupt, timeout, and failures", async () => {
  const transport = new FakeClaudeTransport();
  const worker = await new ClaudeCodeAdapter({
    transportFactory: async () => transport,
    permissionMode: "manual",
    turnTimeoutMs: 100,
    stallTimeoutMs: 0,
  }).openWorker({ attemptId: "attempt-control", task, workspace });
  const handle = await worker.startTurn({ prompt: "Start" });
  const events = handle.events[Symbol.asyncIterator]();
  transport.emit(init("session-control", "manual"));
  await events.next();
  transport.emit({
    type: "control_request",
    request_id: "permission-1",
    request: {
      subtype: "can_use_tool",
      tool_name: "Bash",
      input: { command: "echo token=sk-ant-secret-value", cwd: "/tmp/workspace" },
      tool_use_id: "tool-1",
      decision_reason: "Run the command with Authorization: Bearer hidden-value",
    },
  });
  const approval = (await events.next()).value;
  assert.equal(approval?.type, "intervention_requested");
  if (approval?.type !== "intervention_requested") assert.fail("approval event missing");
  assert.doesNotMatch(JSON.stringify(approval), /sk-ant-secret-value|hidden-value/);
  await handle.respondToIntervention(approval.requestRef, { decision: "approved" });
  assert.equal(transport.sent.at(-1)?.type, "control_response");
  await handle.steer("Queue this next instruction");
  assert.equal(transport.sent.at(-1)?.type, "user");
  transport.emit(result("session-control", "success"));
  transport.emit(result("session-control", "success"));
  assert.deepEqual(await handle.completion, { outcome: "completed" });
  await worker.close();

  const interruptTransport = new FakeClaudeTransport();
  const interruptWorker = await new ClaudeCodeAdapter({
    transportFactory: async () => interruptTransport,
    permissionMode: "acceptEdits",
  }).openWorker({ attemptId: "attempt-interrupt", task, workspace });
  const interrupted = await interruptWorker.startTurn({ prompt: "Run" });
  const interruptedEvents = interrupted.events[Symbol.asyncIterator]();
  interruptTransport.emit(init("session-interrupt"));
  await interruptedEvents.next();
  await interrupted.interrupt();
  assert.equal(interruptTransport.requests.at(-1)?.request.subtype, "interrupt");
  interruptTransport.emit(result("session-interrupt", "error_during_execution", true));
  assert.deepEqual(await interrupted.completion, { outcome: "interrupted" });
  await interruptWorker.close();

  const oldTransport = new FakeClaudeTransport();
  const oldWorker = await new ClaudeCodeAdapter({
    transportFactory: async () => oldTransport,
    permissionMode: "acceptEdits",
  }).openWorker({ attemptId: "attempt-old", task, workspace });
  const old = await oldWorker.startTurn({ prompt: "Run" });
  oldTransport.emit(init("session-old", "acceptEdits", []));
  await old.interrupt();
  assert.equal(oldTransport.terminateCalls, 1);
  assert.deepEqual(await old.completion, { outcome: "interrupted" });
  await oldWorker.close();

  const timeoutTransport = new FakeClaudeTransport();
  const timeoutWorker = await new ClaudeCodeAdapter({
    transportFactory: async () => timeoutTransport,
    permissionMode: "acceptEdits",
    turnTimeoutMs: 10,
    stallTimeoutMs: 0,
  }).openWorker({ attemptId: "attempt-timeout", task, workspace });
  const timed = await timeoutWorker.startTurn({ prompt: "Wait" });
  assert.deepEqual(await timed.completion, { outcome: "failed", error: "claude_turn_timed_out" });
  await timeoutWorker.close();

  const exitTransport = new FakeClaudeTransport();
  const exitWorker = await new ClaudeCodeAdapter({
    transportFactory: async () => exitTransport,
    permissionMode: "acceptEdits",
  }).openWorker({ attemptId: "attempt-exit", task, workspace });
  const exited = await exitWorker.startTurn({ prompt: "Exit" });
  exitTransport.exit(1);
  assert.deepEqual(await exited.completion, { outcome: "failed", error: "claude_code_exited" });
  await exitWorker.close();
});

test("Claude STDIO transport fails closed on malformed JSONL and incompatible versions", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "symphoneer-claude-transport-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = resolve(directory, "claude-fixture");
  await writeFile(
    executable,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "2.1.218 (Claude Code)"
  exit 0
fi
echo "not-json"
sleep 1
`,
  );
  await chmod(executable, 0o755);
  const transport = await StdioClaudeTransport.start({
    command: executable,
    argv: [],
    cwd: directory,
    permissionMode: "acceptEdits",
  });
  await assert.rejects(async () => {
    for await (const _message of transport.messages) {
      // Invalid JSONL must fail before a message is exposed.
    }
  });
  await transport.closed;

  for (const version of ["2.1.217", "3.0.0"]) {
    await writeFile(executable, `#!/bin/sh\necho "${version} (Claude Code)"\n`);
    await assert.rejects(
      StdioClaudeTransport.start({
        command: executable,
        argv: [],
        cwd: directory,
        permissionMode: "acceptEdits",
      }),
      /version is missing or incompatible/,
    );
  }
});

function init(
  sessionId: string,
  permissionMode = "acceptEdits",
  capabilities = ["interrupt_receipt_v1"],
): ClaudeMessage {
  return {
    type: "system",
    subtype: "init",
    session_id: sessionId,
    uuid: `init-${sessionId}`,
    claude_code_version: "2.1.218",
    cwd: workspace.path,
    model: "claude-sonnet-4-6",
    permissionMode,
    capabilities,
  };
}

function assistant(sessionId: string, uuid: string, text = "Created"): ClaudeMessage {
  return {
    type: "assistant",
    session_id: sessionId,
    uuid,
    message: {
      content: [
        { type: "text", text },
        { type: "thinking", thinking: "Checked the boundary" },
        {
          type: "tool_use",
          id: "tool-1",
          name: "Bash",
          input: { command: "echo token=sk-ant-secret-value" },
        },
      ],
    },
  };
}

function toolResult(sessionId: string, toolUseId: string): ClaudeMessage {
  return {
    type: "user",
    session_id: sessionId,
    uuid: "tool-result-1",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: "Authorization: Bearer hidden-value",
          is_error: false,
        },
      ],
    },
  };
}

function apiRetry(sessionId: string): ClaudeMessage {
  return {
    type: "system",
    subtype: "api_retry",
    session_id: sessionId,
    uuid: "retry-1",
    attempt: 1,
    max_retries: 3,
    retry_delay_ms: 1000,
    error_status: 529,
    error: "overloaded",
  };
}

function result(
  sessionId: string,
  subtype: "success" | "error_during_execution",
  interrupted = false,
): ClaudeMessage {
  return {
    type: "result",
    subtype,
    session_id: sessionId,
    uuid: `result-${crypto.randomUUID()}`,
    is_error: subtype !== "success",
    result: subtype === "success" ? "Done" : undefined,
    errors: subtype === "success" ? undefined : [interrupted ? "Interrupted" : "Failed"],
    duration_ms: 100,
    duration_api_ms: 80,
    num_turns: 1,
    total_cost_usd: 0.01,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

class FakeClaudeTransport implements ClaudeTransport {
  readonly toolVersion = "2.1.218";
  readonly processIdentity = { pid: 5050 };
  readonly sent: Array<Record<string, unknown>> = [];
  readonly requests: Array<{ requestId: string; request: Record<string, unknown> }> = [];
  readonly messages: AsyncIterable<ClaudeMessage>;
  readonly closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  closeCalls = 0;
  terminateCalls = 0;
  #messageController!: ReadableStreamDefaultController<ClaudeMessage>;
  #closed = Promise.withResolvers<{ code: number | null; signal: NodeJS.Signals | null }>();

  constructor() {
    this.messages = new ReadableStream<ClaudeMessage>({
      start: (controller) => {
        this.#messageController = controller;
      },
    });
    this.closed = this.#closed.promise;
  }

  send(message: Record<string, unknown>): void {
    this.sent.push(structuredClone(message));
  }

  request(request: Record<string, unknown>): Promise<unknown> {
    const requestId = crypto.randomUUID();
    this.requests.push({ requestId, request: structuredClone(request) });
    return Promise.resolve({ still_queued: [] });
  }

  async terminate(): Promise<void> {
    this.terminateCalls += 1;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }

  emit(message: ClaudeMessage): void {
    this.#messageController.enqueue(structuredClone(message));
  }

  exit(code: number): void {
    this.#messageController.close();
    this.#closed.resolve({ code, signal: null });
  }
}
