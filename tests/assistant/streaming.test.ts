import assert from "node:assert/strict";
import test from "node:test";

import type {
  AssistantAdapter,
  AssistantEvent,
  AssistantSession,
  AssistantSessionInput,
} from "../../src/runtime-tools/index.ts";

class StreamingAssistantAdapter implements AssistantAdapter {
  status() {
    return { state: "ready" as const, provider: "test" };
  }

  async createOrResumeSession(_input: AssistantSessionInput): Promise<AssistantSession> {
    return {
      id: "assistant:test",
      status: this.status(),
      summary: "test assistant",
      run: async function* ({ abortSignal }): AsyncIterable<AssistantEvent> {
        if (abortSignal.aborted) return;
        yield { type: "text_delta", delta: "hello" };
        yield { type: "text_delta", delta: " world" };
        yield { type: "completed" };
      },
    };
  }
}

test("AssistantAdapter exposes a renderer-independent streaming session", async () => {
  const adapter = new StreamingAssistantAdapter();
  const session = await adapter.createOrResumeSession({ taskId: "task-1" });
  const events = [];

  for await (const event of session.run({
    messages: [{ role: "user", text: "status?" }],
    abortSignal: new AbortController().signal,
  })) {
    events.push(event);
  }

  assert.deepEqual(events, [
    { type: "text_delta", delta: "hello" },
    { type: "text_delta", delta: " world" },
    { type: "completed" },
  ]);
});
