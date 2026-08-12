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

test("persisted Assistant messages restore text and tool results without Pi types", () => {
  const messages = toAssistantUiMessages([
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Check" }],
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
