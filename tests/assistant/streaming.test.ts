import assert from "node:assert/strict";
import test from "node:test";

import type { AssistantEvent } from "../../src/assistant-client/index.ts";
import {
  createAssistantUiChatModelAdapter,
  toAssistantUiMessages,
} from "../../src/web/components/assistant/assistant-ui-adapter.ts";

test("normalized Assistant events project to cumulative assistant-ui text and tool parts", async () => {
  const events: AssistantEvent[] = [
    { type: "text_delta", delta: "Checking " },
    {
      type: "tool_started",
      toolCallId: "tool-1",
      toolName: "runtime_health",
      input: {},
    },
    {
      type: "approval_required",
      approvalId: "approval-1",
      toolCallId: "tool-1",
      toolName: "runtime_health",
      input: {},
    },
    {
      type: "tool_completed",
      toolCallId: "tool-1",
      toolName: "runtime_health",
      result: { status: "online" },
      isError: false,
    },
    { type: "text_delta", delta: "done" },
    { type: "completed" },
  ];
  const client = {
    abort: async () => {},
    run: async function* () {
      yield* events;
    },
  };
  const adapter = createAssistantUiChatModelAdapter(client, "session-1");
  const updates = [];
  const run = adapter.run({
    messages: [
      {
        id: "user-1",
        role: "user",
        content: [{ type: "text", text: "Check Runtime" }],
        createdAt: new Date(),
        attachments: [],
        metadata: {},
      },
    ],
    abortSignal: new AbortController().signal,
  } as never);
  for await (const update of run as AsyncIterable<{ content?: readonly unknown[] }>) {
    updates.push(update);
  }

  const approvalUpdate = updates.find((update) =>
    update.content?.some(
      (part) =>
        typeof part === "object" &&
        part !== null &&
        "approval" in part &&
        (part as { approval?: { id?: string } }).approval?.id === "approval-1",
    ),
  );
  assert.ok(approvalUpdate);
  assert.deepEqual(updates.at(-1)?.content, [
    { type: "text", text: "Checking done" },
    {
      type: "tool-call",
      toolCallId: "tool-1",
      toolName: "runtime_health",
      args: {},
      argsText: "{}",
      result: { status: "online" },
      isError: false,
    },
  ]);
});

test("assistant-ui cancellation calls the Assistant abort endpoint", async () => {
  const abortGate = Promise.withResolvers<void>();
  let abortCalls = 0;
  let runSignal: AbortSignal | undefined;
  const client = {
    abort: async () => {
      abortCalls += 1;
      abortGate.resolve();
    },
    run: async function* (_sessionId: string, _prompt: string, options?: { signal?: AbortSignal }) {
      runSignal = options?.signal;
      yield { type: "text_delta" as const, delta: "partial" };
      await Promise.race([abortGate.promise, new Promise((resolve) => setTimeout(resolve, 25))]);
      yield { type: abortCalls === 1 ? ("aborted" as const) : ("completed" as const) };
    },
  };
  const controller = new AbortController();
  const adapter = createAssistantUiChatModelAdapter(client, "session-1");
  const updates = [];
  for await (const update of adapter.run({
    messages: [
      {
        id: "user-1",
        role: "user",
        content: [{ type: "text", text: "Stop" }],
        createdAt: new Date(),
        attachments: [],
        metadata: {},
      },
    ],
    abortSignal: controller.signal,
  } as never) as AsyncIterable<{ status?: unknown }>) {
    updates.push(update);
    if (updates.length === 1) controller.abort();
  }

  assert.equal(abortCalls, 1);
  assert.equal(runSignal, controller.signal);
  assert.deepEqual(updates.at(-1)?.status, { type: "incomplete", reason: "cancelled" });
});

test("assistant-ui sends text attachment contents with the user prompt", async () => {
  let prompt = "";
  const client = {
    abort: async () => {},
    run: async function* (_sessionId: string, input: string) {
      prompt = input;
      yield { type: "completed" as const };
    },
  };
  const adapter = createAssistantUiChatModelAdapter(client, "session-1");

  for await (const _update of adapter.run({
    messages: [
      {
        id: "user-1",
        role: "user",
        content: [{ type: "text", text: "Summarize this file" }],
        createdAt: new Date(),
        attachments: [
          {
            id: "attachment-1",
            type: "document",
            name: "notes.md",
            contentType: "text/markdown",
            status: { type: "complete" },
            content: [
              {
                type: "text",
                text: "<attachment name=notes.md>\nIssue 45 is ready\n</attachment>",
              },
            ],
          },
        ],
        metadata: {},
      },
    ],
    abortSignal: new AbortController().signal,
  } as never) as AsyncIterable<unknown>) {
    // drain the run
  }

  assert.equal(
    prompt,
    "Summarize this file\n\n<attachment name=notes.md>\nIssue 45 is ready\n</attachment>",
  );
});

test("assistant-ui keeps provider failures visible", async () => {
  let reported = "";
  const client = {
    abort: async () => {},
    run: async function* () {
      yield { type: "error" as const, message: "Provider authentication failed" };
    },
  };
  const adapter = createAssistantUiChatModelAdapter(client, "session-1", undefined, (message) => {
    reported = message;
  });
  const updates = [];

  for await (const update of adapter.run({
    messages: [
      {
        id: "user-1",
        role: "user",
        content: [{ type: "text", text: "Check provider" }],
        createdAt: new Date(),
        attachments: [],
        metadata: {},
      },
    ],
    abortSignal: new AbortController().signal,
  } as never) as AsyncIterable<{ content?: readonly unknown[]; status?: unknown }>) {
    updates.push(update);
  }

  assert.equal(reported, "Provider authentication failed");
  assert.deepEqual(updates.at(-1), {
    content: [{ type: "text", text: "Provider authentication failed" }],
    status: {
      type: "incomplete",
      reason: "error",
      error: "Provider authentication failed",
    },
  });
});

test("persisted Assistant messages restore text and tool results without Pi types", () => {
  const messages = toAssistantUiMessages([
    {
      id: "user-1",
      role: "user",
      parts: [
        {
          type: "text",
          text: "Check\n\n<attachment name=notes.md>\nIssue 45 is ready\n</attachment>",
        },
      ],
      timestamp: 1,
    },
    {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "text", text: "Checking" },
        { type: "tool_call", toolCallId: "tool-1", toolName: "runtime_health", input: {} },
      ],
      timestamp: 2,
    },
    {
      id: "tool-1-result",
      role: "tool",
      parts: [
        {
          type: "tool_result",
          toolCallId: "tool-1",
          toolName: "runtime_health",
          result: { status: "online" },
          isError: false,
        },
      ],
      timestamp: 3,
    },
  ]);

  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0]?.content, [{ type: "text", text: "Check" }]);
  assert.equal(messages[0]?.attachments?.[0]?.name, "notes.md");
  assert.deepEqual(messages[1]?.content, [
    { type: "text", text: "Checking" },
    {
      type: "tool-call",
      toolCallId: "tool-1",
      toolName: "runtime_health",
      args: {},
      argsText: "{}",
      result: { status: "online" },
      isError: false,
    },
  ]);
});
