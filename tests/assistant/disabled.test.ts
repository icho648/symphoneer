import assert from "node:assert/strict";
import test from "node:test";

import { createAssistantAdapter, DisabledAssistantAdapter } from "../../src/runtime-tools/index.ts";

test("Assistant stays disabled without model config", async () => {
  const missing = createAssistantAdapter({});
  assert.deepEqual(missing.status(), { state: "disabled", reason: "missing_config" });

  const invalid = createAssistantAdapter({ SYMPHONEER_ASSISTANT_API_KEY: "invalid" });
  assert.deepEqual(invalid.status(), { state: "disabled", reason: "invalid_key" });

  const optedOut = createAssistantAdapter({ SYMPHONEER_ASSISTANT: "disabled" });
  assert.deepEqual(optedOut.status(), { state: "disabled", reason: "opt_out" });

  const session = await new DisabledAssistantAdapter().createOrResumeSession({ taskId: "t1" });
  assert.equal(session.status.state, "disabled");
  assert.match(session.summary, /disabled/i);
});
