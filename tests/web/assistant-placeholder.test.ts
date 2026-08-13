import assert from "node:assert/strict";
import test from "node:test";

import type { AssistantMessage, AssistantSession } from "../../src/assistant-client/index.ts";
import { discardEmptyReplacedSession } from "../../src/web/components/assistant/assistant-ui-adapter.ts";

const session = (messages: AssistantMessage[]): AssistantSession => ({
  id: "session-1",
  createdAt: 1,
  updatedAt: 2,
  provider: "test",
  model: "test-model",
  thinkingLevel: "off",
  metadata: { createdBy: "web", schemaVersion: 1 },
  messages,
});

test("changing model after a completed run does not delete persisted history", async () => {
  const deleted: string[] = [];
  const client = {
    openSession: async () =>
      session([
        {
          id: "msg-1",
          role: "user" as const,
          parts: [{ type: "text" as const, text: "hello" }],
          timestamp: 1,
        },
      ]),
    deleteSession: async (id: string) => {
      deleted.push(id);
    },
  };

  await discardEmptyReplacedSession(client, "session-1");
  assert.deepEqual(deleted, []);
});

test("changing model still discards an unused empty placeholder session", async () => {
  const deleted: string[] = [];
  const client = {
    openSession: async () => session([]),
    deleteSession: async (id: string) => {
      deleted.push(id);
    },
  };

  await discardEmptyReplacedSession(client, "session-1");
  assert.deepEqual(deleted, ["session-1"]);
});
