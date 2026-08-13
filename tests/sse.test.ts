import assert from "node:assert/strict";
import test from "node:test";

import { readSseFrames } from "../src/sse.ts";

test("readSseFrames parses fragmented UTF-8, named events, comments, and multiline data", async () => {
  const source = [
    ": keepalive\n",
    "event: assistant\n",
    "data: 你\n",
    "data: 好\n\n",
    "data: done\n\n",
  ].join("");
  const bytes = new TextEncoder().encode(source);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 0; index < bytes.length; index += 2) {
        controller.enqueue(bytes.slice(index, index + 2));
      }
      controller.close();
    },
  });
  const frames = [];

  for await (const frame of readSseFrames(body)) frames.push(frame);

  assert.deepEqual(frames, [
    { event: "assistant", data: "你\n好" },
    { event: "message", data: "done" },
  ]);
});
